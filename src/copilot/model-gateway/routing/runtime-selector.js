// @ts-check
/**
 * Final runtime selector planning.
 *
 * This layer turns a resolved selection policy or persisted decision trace into the exact route a runtime caller should
 * attempt first. It is deliberately non-executing: provider calls, probes and retries live above this boundary.
 */

import { buildRouteDecisionEvent } from '../observability/events.js';
import { runConfiguredByokChatProbe } from '../probes/chat-probe.js';
import {
    flushByokProviderHealth,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
} from '../health/provider-health.js';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {Record<string, unknown> | null} route
 * @returns {string | null}
 */
function routeKey(route) {
    if (!route) return null;
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']);
    if (!providerId || !providerModel) return null;
    return `${providerId}:${providerModel}`;
}

/**
 * @param {Record<string, unknown> | null} route
 * @returns {Record<string, unknown> | null}
 */
function runtimeRoute(route) {
    if (!route) return null;
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']);
    if (!providerId || !providerModel) return null;
    return {
        id: `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        routeProfile: optionalString(route['routeProfile']),
        selectorKind: optionalString(route['selectorKind']),
        score: optionalNumber(route['score']),
        eligibilityDisposition: optionalString(route['eligibilityDisposition']),
        hasRuntimeProof: route['hasRuntimeProof'] === true,
        runtimeHealth: optionalRecord(route['runtimeHealth']),
    };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown> | null}
 */
function selectedFromPolicyRow(row) {
    return optionalRecord(row['selected']);
}

/**
 * @param {Record<string, unknown>} input
 * @returns {{ mode: string; rows: Record<string, unknown>[]; sourceSchema: string | null; traceId: string | null }}
 */
function readRowsFromInput(input) {
    const traceRows = Array.isArray(input['rows']) && input['schema'] === 'model-gateway-selection-decision-trace';
    const policy = optionalRecord(input['policy']);
    return {
        mode: optionalString(input['mode']) ?? optionalString(policy?.['mode']) ?? 'metadata_first',
        rows: Array.isArray(input['rows']) ? input['rows'].map((row) => optionalRecord(row) ?? {}) : [],
        sourceSchema: optionalString(input['schema']),
        traceId: traceRows ? optionalString(input['traceId']) : null,
    };
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
function selectionReasons(selected, row) {
    const reasons = [`selection_source:${optionalString(row['source']) ?? 'unknown'}`];
    if (row['hasRuntimeProof'] === true || selected?.['hasRuntimeProof'] === true) reasons.push('runtime_proof:present');
    else reasons.push('runtime_proof:absent');
    if (row['changedFromPreRuntime'] === true) reasons.push('changed_from_pre_runtime');
    return reasons;
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, unknown>} row
 * @param {{ sessionId?: string | null; source?: string; mode?: string }} options
 * @returns {ReturnType<typeof buildRouteDecisionEvent>}
 */
function buildSelectorDecisionEvent(selected, row, options) {
    const route = runtimeRoute(selected);
    return buildRouteDecisionEvent({
        taskProfile: optionalString(row['profileId']) ?? 'unknown',
        routeProfile: optionalString(route?.['routeProfile']) ?? optionalString(row['profileId']),
        mode: options.mode ?? 'metadata_first',
        source: options.source ?? 'model-gateway-runtime-selector',
        sessionId: options.sessionId ?? null,
        route: {
            selected: route
                ? {
                      score: optionalNumber(route['score']),
                      reasons: selectionReasons(selected, row),
                      model: {
                          id: route['id'],
                          providerId: route['providerId'],
                          providerModel: route['providerModel'],
                      },
                  }
                : null,
            candidates: route ? [route] : [],
            rejected: route ? [] : [{ reason: 'runtime_selector_unselected' }],
            fallbackChain: routeKey(selected) ? [String(routeKey(selected))] : [],
        },
        failure: route ? null : 'runtime_selector_unselected',
    });
}

/**
 * @param {Record<string, unknown>} selectionPolicyOrTrace
 * @param {{ sessionId?: string | null; source?: string; requireRuntimeProof?: boolean }} [options]
 * @returns {{
 *   schema: 'model-gateway-runtime-selector-plan';
 *   ok: boolean;
 *   ready: boolean;
 *   mode: string;
 *   sourceSchema: string | null;
 *   traceId: string | null;
 *   summary: {
 *     profileCount: number;
 *     selectedProfileCount: number;
 *     blockedProfileCount: number;
 *     runtimeProofSelectedCount: number;
 *   };
 *   routes: Array<{
 *     profileId: string;
 *     status: 'selected' | 'blocked';
 *     source: string;
 *     selected: Record<string, unknown> | null;
 *     selectedRouteKey: string | null;
 *     hasRuntimeProof: boolean;
 *     reasons: string[];
 *     nextActions: string[];
 *     decisionEvent: ReturnType<typeof buildRouteDecisionEvent>;
 *   }>;
 * }}
 */
export function buildModelGatewayRuntimeSelectorPlan(selectionPolicyOrTrace, options = {}) {
    const input = optionalRecord(selectionPolicyOrTrace) ?? {};
    const { mode, rows, sourceSchema, traceId } = readRowsFromInput(input);
    const requireRuntimeProof = options.requireRuntimeProof === true || mode === 'require_runtime_proof';
    const routes = rows.map((row) => {
        const profileId = optionalString(row['profileId']) ?? 'unknown';
        const selected = runtimeRoute(selectedFromPolicyRow(row));
        const hasRuntimeProof = row['hasRuntimeProof'] === true || selected?.['hasRuntimeProof'] === true;
        const blocked = !selected || (requireRuntimeProof && !hasRuntimeProof);
        /** @type {'selected' | 'blocked'} */
        const status = blocked ? 'blocked' : 'selected';
        const reasons = selectionReasons(selected, row);
        if (blocked && !selected) reasons.push('blocked:no_selected_route');
        if (blocked && selected && requireRuntimeProof) reasons.push('blocked:runtime_proof_required');
        const normalizedRow = {
            ...row,
            profileId,
            source: optionalString(row['source']) ?? 'unknown',
            hasRuntimeProof,
        };
        return {
            profileId,
            status,
            source: String(normalizedRow['source']),
            selected: blocked ? null : selected,
            selectedRouteKey: blocked ? null : routeKey(selected),
            hasRuntimeProof,
            reasons,
            nextActions: blocked
                ? ['run_runtime_probe_for_profile', 'relax_selection_policy_or_choose_fallback']
                : ['attempt_selected_route', 'record_runtime_result'],
            decisionEvent: buildSelectorDecisionEvent(blocked ? null : selected, normalizedRow, {
                mode,
                ...(options.source ? { source: options.source } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
            }),
        };
    });
    return {
        schema: 'model-gateway-runtime-selector-plan',
        ok: routes.every((route) => route.status === 'selected'),
        ready: routes.some((route) => route.status === 'selected'),
        mode,
        sourceSchema,
        traceId,
        summary: {
            profileCount: routes.length,
            selectedProfileCount: routes.filter((route) => route.status === 'selected').length,
            blockedProfileCount: routes.filter((route) => route.status === 'blocked').length,
            runtimeProofSelectedCount: routes.filter((route) => route.status === 'selected' && route.hasRuntimeProof).length,
        },
        routes,
    };
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>} plan
 * @param {string} profileId
 * @returns {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>['routes'][number] | null}
 */
export function selectModelGatewayRuntimeRoute(plan, profileId) {
    return plan.routes.find((route) => route.profileId === profileId && route.status === 'selected') ?? null;
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>} plan
 * @param {{
 *   profileId?: string;
 *   timeoutMs?: number;
 *   prompt?: string;
 *   recordHealth?: boolean;
 *   deps?: {
 *     runChatProbe?: typeof runConfiguredByokChatProbe;
 *     recordSuccess?: typeof recordByokProviderModelCallSuccess;
 *     recordFailure?: typeof recordByokProviderModelCallFailure;
 *     flushHealth?: typeof flushByokProviderHealth;
 *   };
 * }} [options]
 * @returns {Promise<{
 *   schema: 'model-gateway-runtime-selector-execution-result';
 *   ok: boolean;
 *   status: 'ok' | 'blocked' | 'failed';
 *   profileId: string | null;
 *   route: ReturnType<typeof selectModelGatewayRuntimeRoute> | null;
 *   probe: Awaited<ReturnType<typeof runConfiguredByokChatProbe>> | null;
 *   healthRecorded: boolean;
 *   error: string | null;
 * }>}
 */
export async function executeModelGatewayRuntimeSelectorPlan(plan, options = {}) {
    const requestedProfile = optionalString(options.profileId);
    const route =
        requestedProfile !== null
            ? selectModelGatewayRuntimeRoute(plan, requestedProfile)
            : (plan.routes.find((candidate) => candidate.status === 'selected') ?? null);
    if (!route?.selected) {
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: false,
            status: 'blocked',
            profileId: requestedProfile,
            route: null,
            probe: null,
            healthRecorded: false,
            error: 'runtime_selector_route_unavailable',
        };
    }
    const selected = route.selected;
    const runChatProbe = options.deps?.runChatProbe ?? runConfiguredByokChatProbe;
    const recordSuccess = options.deps?.recordSuccess ?? recordByokProviderModelCallSuccess;
    const recordFailure = options.deps?.recordFailure ?? recordByokProviderModelCallFailure;
    const flushHealth = options.deps?.flushHealth ?? flushByokProviderHealth;
    const recordHealth = options.recordHealth !== false;
    const providerModel = optionalString(selected['providerModel']);
    try {
        const probe = await runChatProbe({
            ...(providerModel ? { model: providerModel } : {}),
            ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.prompt ? { prompt: options.prompt } : {}),
        });
        let healthRecorded = false;
        const identity = {
            routeProfile: route.profileId,
            providerId: optionalString(selected['providerId']),
            providerModel,
        };
        if (recordHealth && probe.ok) {
            recordSuccess({
                ...identity,
                successContext: 'runtime_selector_chat',
            });
            await flushHealth();
            healthRecorded = true;
        } else if (recordHealth && probe.status !== 'unavailable' && probe.status !== 'admission-blocked') {
            recordFailure({
                ...identity,
                message: probe.errors[0] ?? `runtime selector chat ${probe.status}`,
                errorContext: probe.providerFailure?.errorContext ?? 'runtime_selector_chat',
                failureKind: probe.providerFailure?.kind ?? null,
                failureStatusCode: probe.providerFailure?.statusCode ?? null,
                retryAfterSeconds: probe.providerFailure?.retryAfterSeconds ?? null,
                resetAt: probe.providerFailure?.resetAt ?? null,
            });
            await flushHealth();
            healthRecorded = true;
        }
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: probe.ok,
            status: probe.ok ? 'ok' : 'failed',
            profileId: route.profileId,
            route,
            probe,
            healthRecorded,
            error: probe.ok ? null : (probe.errors[0] ?? probe.status),
        };
    } catch (error) {
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: false,
            status: 'failed',
            profileId: route.profileId,
            route,
            probe: null,
            healthRecorded: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
