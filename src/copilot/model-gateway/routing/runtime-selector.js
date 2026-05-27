// @ts-check
/**
 * Final runtime selector planning.
 *
 * This layer turns a resolved selection policy or persisted decision trace into the exact route a runtime caller should
 * attempt first. It is deliberately non-executing: provider calls, probes and retries live above this boundary.
 */

import { buildRouteDecisionEvent } from '../observability/events.js';
import { recordModelGatewayRouteDecision } from '../observability/route-decision-ledger.js';
import { runConfiguredByokChatProbe } from '../probes/chat-probe.js';
import {
    flushByokProviderHealth,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
} from '../health/provider-health.js';
import { classifyByokProviderFailure } from '../health/provider-failure.js';
import { evaluateModelGatewayProviderEnvRequirements } from '../secrets/requirements.js';

const DEFAULT_MAX_RUNTIME_RETRY_DELAY_MS = 30_000;

const RUNTIME_ROUTE_ENV_RESET_KEYS = Object.freeze([
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_PROVIDER_TYPE',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_BYOK_WIRE_API',
    'COPILOT_BYOK_AZURE_API_VERSION',
    'COPILOT_BYOK_HEADERS_JSON',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_MODELS',
    'COPILOT_BYOK_MODELS_JSON',
    'COPILOT_BYOK_MODELS_ENDPOINT',
    'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
    'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
    'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_MAX_REQUEST_TOKENS',
    'COPILOT_BYOK_TOKENS_PER_MINUTE',
    'COPILOT_BYOK_REQUESTS_PER_MINUTE',
    'COPILOT_BYOK_DAILY_REQUESTS',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
]);

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
 * @param {number} delayMs
 * @returns {Promise<void>}
 */
function sleepMs(delayMs) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        setTimeout(resolve, Math.round(delayMs));
    });
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

/**
 * @param {number | null} retryAfterSeconds
 * @param {string | null} resetAt
 * @param {number} nowMs
 * @param {number} fallbackDelayMs
 * @returns {number}
 */
function resolveRuntimeRetryDelayMs(retryAfterSeconds, resetAt, nowMs, fallbackDelayMs) {
    if (retryAfterSeconds !== null && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds * 1000);
    const resetMs = dateMs(resetAt);
    if (resetMs !== null && resetMs > nowMs) return Math.ceil(resetMs - nowMs);
    return Math.max(0, Math.round(fallbackDelayMs));
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
 * Build an isolated BYOK env for the selected runtime route.
 *
 * The configured terminal BYOK provider is often just the operator's current default. Runtime selection needs to test
 * the selected route itself, so provider/model/baseUrl/auth overrides from that current default must not leak into a
 * route for a different provider.
 *
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string | undefined>}
 */
export function buildModelGatewayRuntimeSelectorProbeEnv(selected, baseEnv = process.env) {
    const env = { ...baseEnv };
    for (const key of RUNTIME_ROUTE_ENV_RESET_KEYS) delete env[key];
    const providerId = optionalString(selected?.['providerId']);
    const providerModel = optionalString(selected?.['providerModel']);
    env['COPILOT_BYOK_ENABLED'] = 'true';
    if (providerId) env['COPILOT_BYOK_PROVIDER_PRESET'] = providerId;
    if (providerModel) env['COPILOT_BYOK_MODEL'] = providerModel;
    return env;
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {{
 *   providerId: string | null;
 *   providerModel: string | null;
 *   providerPreset: string | null;
 *   model: string | null;
 *   status: 'ready' | 'missing' | 'partial';
 *   configuredKeys: string[];
 *   missingRequiredKeys: string[];
 *   missingRecommendedKeys: string[];
 * }}
 */
export function evaluateModelGatewayRuntimeSelectorRouteEnv(selected, baseEnv = process.env) {
    const env = buildModelGatewayRuntimeSelectorProbeEnv(selected, baseEnv);
    const providerId = optionalString(selected?.['providerId']);
    const requirement = providerId
        ? evaluateModelGatewayProviderEnvRequirements({ env, providerId })[0]
        : null;
    return {
        providerId,
        providerModel: optionalString(selected?.['providerModel']),
        providerPreset: optionalString(env['COPILOT_BYOK_PROVIDER_PRESET']),
        model: optionalString(env['COPILOT_BYOK_MODEL']),
        status: requirement?.status ?? 'missing',
        configuredKeys: requirement?.configuredKeys ?? [],
        missingRequiredKeys: requirement?.missingRequiredKeys ?? [],
        missingRecommendedKeys: requirement?.missingRecommendedKeys ?? [],
    };
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
        accountScope: optionalString(route['accountScope']) ?? 'default',
        policyProfile: optionalString(route['policyProfile']),
        taskProfile: optionalString(route['taskProfile']),
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
 * @param {{ sessionId?: string | null; source?: string; requireRuntimeProof?: boolean; requireRuntimeEnvReady?: boolean; env?: Record<string, string | undefined> }} [options]
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
 *     runtimeEnvReadyCount: number;
 *     runtimeEnvBlockedCount: number;
 *   };
 *   routes: Array<{
 *     profileId: string;
 *     status: 'selected' | 'blocked';
 *     source: string;
 *     selected: Record<string, unknown> | null;
 *     selectedRouteKey: string | null;
 *     hasRuntimeProof: boolean;
 *     runtimeEnv: ReturnType<typeof evaluateModelGatewayRuntimeSelectorRouteEnv> | null;
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
    const requireRuntimeEnvReady = options.requireRuntimeEnvReady === true;
    const routes = rows.map((row) => {
        const profileId = optionalString(row['profileId']) ?? 'unknown';
        const selected = runtimeRoute(selectedFromPolicyRow(row));
        const hasRuntimeProof = row['hasRuntimeProof'] === true || selected?.['hasRuntimeProof'] === true;
        const runtimeEnv = selected ? evaluateModelGatewayRuntimeSelectorRouteEnv(selected, options.env) : null;
        const runtimeEnvBlocked = requireRuntimeEnvReady && runtimeEnv?.status !== 'ready';
        const blocked = !selected || (requireRuntimeProof && !hasRuntimeProof) || runtimeEnvBlocked;
        /** @type {'selected' | 'blocked'} */
        const status = blocked ? 'blocked' : 'selected';
        const reasons = selectionReasons(selected, row);
        if (blocked && !selected) reasons.push('blocked:no_selected_route');
        if (blocked && selected && requireRuntimeProof) reasons.push('blocked:runtime_proof_required');
        if (blocked && selected && runtimeEnvBlocked) reasons.push('blocked:runtime_env_not_ready');
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
            runtimeEnv,
            reasons,
            nextActions: blocked
                ? [
                      ...(runtimeEnvBlocked ? ['configure_provider_env_for_selected_route'] : []),
                      'run_runtime_probe_for_profile',
                      'relax_selection_policy_or_choose_fallback',
                  ]
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
            runtimeEnvReadyCount: routes.filter((route) => route.runtimeEnv?.status === 'ready').length,
            runtimeEnvBlockedCount: routes.filter((route) => route.runtimeEnv !== null && route.runtimeEnv.status !== 'ready').length,
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
 *   env?: Record<string, string | undefined>;
 *   deps?: {
 *     runChatProbe?: typeof runConfiguredByokChatProbe;
 *     recordSuccess?: typeof recordByokProviderModelCallSuccess;
 *     recordFailure?: typeof recordByokProviderModelCallFailure;
 *     flushHealth?: typeof flushByokProviderHealth;
 *     classifyProviderFailure?: typeof classifyByokProviderFailure;
 *     recordRouteDecision?: typeof recordModelGatewayRouteDecision;
 *   };
 * }} [options]
 * @returns {Promise<{
 *   schema: 'model-gateway-runtime-selector-execution-result';
 *   ok: boolean;
 *   status: 'ok' | 'blocked' | 'failed';
 *   profileId: string | null;
 *   route: ReturnType<typeof selectModelGatewayRuntimeRoute> | null;
 *   probe: Awaited<ReturnType<typeof runConfiguredByokChatProbe>> | null;
 *   providerFailure: ReturnType<typeof classifyByokProviderFailure> | Awaited<ReturnType<typeof runConfiguredByokChatProbe>>['providerFailure'] | null;
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
            providerFailure: null,
            healthRecorded: false,
            error: 'runtime_selector_route_unavailable',
        };
    }
    const selected = route.selected;
    const runChatProbe = options.deps?.runChatProbe ?? runConfiguredByokChatProbe;
    const recordSuccess = options.deps?.recordSuccess ?? recordByokProviderModelCallSuccess;
    const recordFailure = options.deps?.recordFailure ?? recordByokProviderModelCallFailure;
    const flushHealth = options.deps?.flushHealth ?? flushByokProviderHealth;
    const classifyProviderFailure = options.deps?.classifyProviderFailure ?? classifyByokProviderFailure;
    const recordRouteDecision = options.deps?.recordRouteDecision ?? recordModelGatewayRouteDecision;
    const recordHealth = options.recordHealth !== false;
    const providerModel = optionalString(selected['providerModel']);
    const probeEnv = buildModelGatewayRuntimeSelectorProbeEnv(selected, options.env);
    const identity = {
        routeProfile: route.profileId,
        providerId: optionalString(selected['providerId']),
        providerModel,
    };
    try {
        try {
            recordRouteDecision(route.decisionEvent);
        } catch {
            // Runtime execution must not fail because an optional observer failed.
        }
        const probe = await runChatProbe({
            env: probeEnv,
            ...(providerModel ? { model: providerModel } : {}),
            ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.prompt ? { prompt: options.prompt } : {}),
            deps: { classifyProviderFailure },
        });
        let healthRecorded = false;
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
            providerFailure: probe.providerFailure ?? null,
            healthRecorded,
            error: probe.ok ? null : (probe.errors[0] ?? probe.status),
        };
    } catch (error) {
        const providerFailure = classifyProviderFailure(error);
        let healthRecorded = false;
        if (recordHealth) {
            recordFailure({
                ...identity,
                message: providerFailure.message,
                errorContext: providerFailure.errorContext,
                failureKind: providerFailure.kind,
                failureStatusCode: providerFailure.statusCode,
                retryAfterSeconds: providerFailure.retryAfterSeconds,
                resetAt: providerFailure.resetAt,
            });
            await flushHealth();
            healthRecorded = true;
        }
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: false,
            status: 'failed',
            profileId: route.profileId,
            route,
            probe: null,
            providerFailure,
            healthRecorded,
            error: providerFailure.message,
        };
    }
}

/**
 * @param {Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>} execution
 * @param {{ retryDelayMs?: number; maxRetryDelayMs?: number; now?: string | number | Date }} [options]
 * @returns {{
 *   schema: 'model-gateway-runtime-selector-retry-decision';
 *   retryRoute: boolean;
 *   fallbackRoute: boolean;
 *   permanent: boolean;
 *   waitMs: number;
 *   reason: string;
 *   failureKind: string | null;
 *   retryAfterSeconds: number | null;
 *   resetAt: string | null;
 * }}
 */
export function resolveModelGatewayRuntimeRetryDecision(execution, options = {}) {
    if (execution.ok) {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: false,
            permanent: false,
            waitMs: 0,
            reason: 'runtime_route_succeeded',
            failureKind: null,
            retryAfterSeconds: null,
            resetAt: null,
        };
    }
    const providerFailure = optionalRecord(execution.providerFailure) ?? optionalRecord(execution.probe?.providerFailure);
    const failureKind = optionalString(providerFailure?.['kind']);
    const retryAfterSeconds = optionalNumber(providerFailure?.['retryAfterSeconds']);
    const resetAt = optionalString(providerFailure?.['resetAt']);
    const nowMs = dateMs(options.now) ?? Date.now();
    const fallbackDelayMs = positiveInteger(options.retryDelayMs) ?? 0;
    const maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs) ?? DEFAULT_MAX_RUNTIME_RETRY_DELAY_MS;
    if (execution.status === 'blocked') {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: false,
            waitMs: 0,
            reason: 'runtime_route_blocked',
            failureKind,
            retryAfterSeconds,
            resetAt,
        };
    }
    if (failureKind === 'auth' || failureKind === 'credits' || failureKind === 'model-or-route') {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: true,
            waitMs: 0,
            reason: `permanent_provider_failure:${failureKind}`,
            failureKind,
            retryAfterSeconds,
            resetAt,
        };
    }
    const waitMs = resolveRuntimeRetryDelayMs(retryAfterSeconds, resetAt, nowMs, fallbackDelayMs);
    if (failureKind === 'rate-limit' && waitMs > maxRetryDelayMs) {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: false,
            waitMs,
            reason: 'rate_limit_window_exceeds_runtime_retry_budget',
            failureKind,
            retryAfterSeconds,
            resetAt,
        };
    }
    return {
        schema: 'model-gateway-runtime-selector-retry-decision',
        retryRoute: true,
        fallbackRoute: true,
        permanent: false,
        waitMs,
        reason: failureKind ? `retryable_provider_failure:${failureKind}` : 'retryable_runtime_failure',
        failureKind,
        retryAfterSeconds,
        resetAt,
    };
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>} plan
 * @param {{
 *   profileId?: string;
 *   fallbackProfileIds?: string[];
 *   maxAttempts?: number;
 *   attemptsPerRoute?: number;
 *   retryDelayMs?: number;
 *   maxRetryDelayMs?: number;
 *   timeoutMs?: number;
 *   prompt?: string;
 *   recordHealth?: boolean;
 *   env?: Record<string, string | undefined>;
 *   deps?: {
 *     runChatProbe?: typeof runConfiguredByokChatProbe;
 *     recordSuccess?: typeof recordByokProviderModelCallSuccess;
 *     recordFailure?: typeof recordByokProviderModelCallFailure;
 *     flushHealth?: typeof flushByokProviderHealth;
 *     classifyProviderFailure?: typeof classifyByokProviderFailure;
 *     sleep?: typeof sleepMs;
 *   };
 * }} [options]
 * @returns {Promise<{
 *   schema: 'model-gateway-runtime-selector-fallback-execution-result';
 *   ok: boolean;
 *   status: 'ok' | 'blocked' | 'failed';
 *   attemptedCount: number;
 *   selectedProfileId: string | null;
 *   attempts: Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>;
 *   retryDecisions: Array<ReturnType<typeof resolveModelGatewayRuntimeRetryDecision>>;
 *   final: Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>> | null;
 *   error: string | null;
 * }>}
 */
export async function executeModelGatewayRuntimeSelectorPlanWithFallbacks(plan, options = {}) {
    const selectedRoutes = plan.routes.filter((route) => route.status === 'selected');
    const requestedProfile = optionalString(options.profileId);
    const fallbackProfileIds = Array.isArray(options.fallbackProfileIds)
        ? options.fallbackProfileIds.map(optionalString).filter((item) => item !== null)
        : [];
    const orderedProfileIds = [
        ...(requestedProfile ? [requestedProfile] : []),
        ...fallbackProfileIds,
        ...selectedRoutes.map((route) => route.profileId),
    ];
    const uniqueProfileIds = [...new Set(orderedProfileIds)].filter((profileId) =>
        selectedRoutes.some((route) => route.profileId === profileId),
    );
    const maxAttempts =
        typeof options.maxAttempts === 'number' && Number.isFinite(options.maxAttempts) && options.maxAttempts > 0
            ? Math.floor(options.maxAttempts)
            : uniqueProfileIds.length;
    const attemptsPerRoute =
        typeof options.attemptsPerRoute === 'number' && Number.isFinite(options.attemptsPerRoute) && options.attemptsPerRoute > 0
            ? Math.floor(options.attemptsPerRoute)
            : 1;
    const retryDelayMs =
        typeof options.retryDelayMs === 'number' && Number.isFinite(options.retryDelayMs) && options.retryDelayMs > 0
            ? Math.round(options.retryDelayMs)
            : 0;
    const wait = options.deps?.sleep ?? sleepMs;
    const attemptProfileIds = uniqueProfileIds.slice(0, maxAttempts);
    /** @type {Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>} */
    const attempts = [];
    /** @type {Array<ReturnType<typeof resolveModelGatewayRuntimeRetryDecision>>} */
    const retryDecisions = [];
    for (const profileId of attemptProfileIds) {
        for (let routeAttempt = 0; routeAttempt < attemptsPerRoute; routeAttempt += 1) {
            const attempt = await executeModelGatewayRuntimeSelectorPlan(plan, {
                profileId,
                ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
                ...(options.prompt ? { prompt: options.prompt } : {}),
                ...(options.recordHealth !== undefined ? { recordHealth: options.recordHealth } : {}),
                ...(options.env ? { env: options.env } : {}),
                ...(options.deps ? { deps: options.deps } : {}),
            });
            attempts.push(attempt);
            if (attempt.ok) {
                return {
                    schema: 'model-gateway-runtime-selector-fallback-execution-result',
                    ok: true,
                    status: 'ok',
                    attemptedCount: attempts.length,
                    selectedProfileId: attempt.profileId,
                    attempts,
                    retryDecisions,
                    final: attempt,
                    error: null,
                };
            }
            const retryDecision = resolveModelGatewayRuntimeRetryDecision(attempt, {
                retryDelayMs,
                ...(typeof options.maxRetryDelayMs === 'number' ? { maxRetryDelayMs: options.maxRetryDelayMs } : {}),
            });
            retryDecisions.push(retryDecision);
            if (routeAttempt + 1 >= attemptsPerRoute || !retryDecision.retryRoute) break;
            await wait(retryDecision.waitMs);
        }
    }
    const final = attempts.at(-1) ?? null;
    return {
        schema: 'model-gateway-runtime-selector-fallback-execution-result',
        ok: false,
        status: attempts.length === 0 ? 'blocked' : 'failed',
        attemptedCount: attempts.length,
        selectedProfileId: null,
        attempts,
        retryDecisions,
        final,
        error: final?.error ?? 'runtime_selector_no_available_attempts',
    };
}
