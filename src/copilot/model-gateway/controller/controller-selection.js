// @ts-check
/**
 * Controller Selection Plane for LLM-B/LLM-A hosts.
 *
 * Task-route selection answers “which model should execute this workload?”. Controller selection answers a different,
 * prior question: “which substrate/model is healthy enough to host the control brain that will make that decision?”.
 * Native Copilot SDK quota is therefore account/substrate health; BYOK is admitted only with a fresh agent proof.
 *
 * @module copilot/model-gateway/controller/controller-selection
 */

import { summarizeModelGatewaySdkQuotaSnapshots } from '../account-access/sdk-quota.js';
import { summarizeGatewayRuntimeProofFreshness } from '../routing/health-routing.js';

export const MODEL_GATEWAY_CONTROLLER_SUBSTRATES = Object.freeze({
    COPILOT: 'github_copilot',
    BYOK: 'byok',
});

export const MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS = Object.freeze({
    NATIVE_READY: 'native_ready',
    BYOK_FALLBACK_READY: 'byok_fallback_ready',
    COMPATIBILITY_AUTO: 'compatibility_auto',
    BLOCKED: 'blocked',
});

const DEFAULT_MIN_CONTEXT_WINDOW_TOKENS = 64_000;
const DEFAULT_AGENT_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} value */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {ReturnType<typeof summarizeModelGatewaySdkQuotaSnapshots>}
 */
function normalizeSdkQuota(value) {
    const input = record(value);
    if (Array.isArray(input['rows']) && record(input['summary'])['status']) {
        return /** @type {ReturnType<typeof summarizeModelGatewaySdkQuotaSnapshots>} */ (input);
    }
    return summarizeModelGatewaySdkQuotaSnapshots(value);
}

/**
 * @param {Record<string, unknown>} model
 * @param {{ minContextWindowTokens: number; quotaStatus: string; currentModelId: string | null }} context
 */
function evaluateNativeModel(model, context) {
    const id = text(model['id']);
    if (!id) return null;
    const policyState = text(record(model['policy'])['state']);
    const capabilities = record(model['capabilities']);
    const supports = record(capabilities['supports']);
    const limits = record(capabilities['limits']);
    const contextWindowTokens = finiteNumber(limits['max_context_window_tokens']);
    const reasoning = supports['reasoningEffort'] === true;
    const vision = supports['vision'] === true;
    const billingMultiplier = finiteNumber(record(model['billing'])['multiplier']);
    const supportedReasoningEfforts = Array.isArray(model['supportedReasoningEfforts'])
        ? model['supportedReasoningEfforts'].map(String)
        : [];
    const rejectedReasons = [];
    if (policyState && policyState !== 'enabled') rejectedReasons.push(`policy:${policyState}`);
    if (contextWindowTokens !== null && contextWindowTokens < context.minContextWindowTokens) {
        rejectedReasons.push(`context_below_${context.minContextWindowTokens}`);
    }
    let score = 1_000;
    if (reasoning) score += 140;
    if (vision) score += 20;
    if (supportedReasoningEfforts.includes('xhigh')) score += 35;
    else if (supportedReasoningEfforts.includes('high')) score += 20;
    if (contextWindowTokens !== null) score += Math.min(120, Math.round(contextWindowTokens / 8_000));
    if (context.currentModelId === id) score += 30;
    const quotaCostWeight = context.quotaStatus === 'critical' ? 70 : context.quotaStatus === 'warn' ? 35 : 8;
    if (billingMultiplier !== null) score -= Math.max(0, billingMultiplier) * quotaCostWeight;
    return {
        substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
        modelId: id,
        displayName: text(model['name']) ?? id,
        policyState: policyState ?? 'enabled_or_unspecified',
        contextWindowTokens,
        reasoning,
        vision,
        supportedReasoningEfforts,
        billingMultiplier,
        score,
        eligible: rejectedReasons.length === 0,
        rejectedReasons,
    };
}

/**
 * @param {Record<string, unknown>} route
 * @param {{ now?: string | number | Date; maxAgentProofAgeMs: number }} context
 */
function evaluateByokControllerRoute(route, context) {
    const selected = Object.keys(record(route['selected'])).length > 0 ? record(route['selected']) : route;
    const providerId = text(selected['providerId']) ?? text(route['providerId']);
    const providerModel = text(selected['providerModel']) ?? text(route['providerModel']);
    if (!providerId || !providerModel) return null;
    const runtimeHealth = record(route['runtimeHealth']);
    const health =
        Object.keys(record(runtimeHealth['health'])).length > 0
            ? record(runtimeHealth['health'])
            : Object.keys(record(route['health'])).length > 0
              ? record(route['health'])
              : runtimeHealth;
    const proof = summarizeGatewayRuntimeProofFreshness(health, {
        ...(context.now !== undefined ? { now: context.now } : {}),
        maxAgeMs: context.maxAgentProofAgeMs,
    });
    const eligible = proof.agentFresh === true;
    const routeScore = finiteNumber(selected['score']) ?? finiteNumber(route['score']) ?? 0;
    return {
        substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.BYOK,
        providerId,
        providerModel,
        routeProfile: text(selected['routeProfile']) ?? text(route['routeProfile']),
        score: 700 + routeScore,
        eligible,
        proof: {
            agentFresh: proof.agentFresh,
            ageMs: proof.ageMs,
            maxAgeMs: proof.maxAgeMs,
            stale: proof.stale,
        },
        rejectedReasons: eligible
            ? []
            : [proof.hasHistoricalProof ? 'agent_proof_stale_or_missing' : 'agent_proof_missing'],
    };
}

/**
 * Build a deterministic controller selection plan.
 *
 * @param {{
 *     sdkModels?: unknown[];
 *     sdkQuota?: unknown;
 *     byokRoutes?: unknown[];
 *     currentController?: {
 *         substrate?: string | null;
 *         modelId?: string | null;
 *         providerId?: string | null;
 *         providerModel?: string | null;
 *     } | null;
 *     now?: string | number | Date;
 *     minContextWindowTokens?: number;
 *     maxAgentProofAgeMs?: number;
 *     allowOpaqueSdkAutoFallback?: boolean;
 * }} [input]
 */
export function buildModelGatewayControllerSelectionPlan(input = {}) {
    const quota = normalizeSdkQuota(input.sdkQuota ?? {});
    const quotaSummary = quota.summary;
    const nativeBlockedByQuota = Number(quotaSummary.blocked ?? 0) > 0;
    const quotaStatus = text(quotaSummary.status) ?? 'unknown';
    const minContextWindowTokens = finiteNumber(input.minContextWindowTokens) ?? DEFAULT_MIN_CONTEXT_WINDOW_TOKENS;
    const maxAgentProofAgeMs = finiteNumber(input.maxAgentProofAgeMs) ?? DEFAULT_AGENT_PROOF_MAX_AGE_MS;
    const current = input.currentController ?? null;
    const currentModelId =
        current?.substrate === MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT ? text(current.modelId) : null;
    const nativeCandidates = (Array.isArray(input.sdkModels) ? input.sdkModels : [])
        .map((model) => evaluateNativeModel(record(model), { minContextWindowTokens, quotaStatus, currentModelId }))
        .filter((candidate) => candidate !== null)
        .sort(
            (left, right) =>
                Number(right.eligible) - Number(left.eligible) ||
                right.score - left.score ||
                left.modelId.localeCompare(right.modelId),
        );
    const nativeEligible = nativeBlockedByQuota ? [] : nativeCandidates.filter((candidate) => candidate.eligible);
    const byokCandidates = (Array.isArray(input.byokRoutes) ? input.byokRoutes : [])
        .map((route) =>
            evaluateByokControllerRoute(record(route), {
                ...(input.now !== undefined ? { now: input.now } : {}),
                maxAgentProofAgeMs,
            }),
        )
        .filter((candidate) => candidate !== null)
        .sort(
            (left, right) =>
                Number(right.eligible) - Number(left.eligible) ||
                right.score - left.score ||
                left.providerId.localeCompare(right.providerId) ||
                left.providerModel.localeCompare(right.providerModel),
        );
    const byokEligible = byokCandidates.filter((candidate) => candidate.eligible);

    if (nativeEligible[0]) {
        const selected = nativeEligible[0];
        return {
            schema: 'model-gateway-controller-selection-plan',
            status: MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.NATIVE_READY,
            ready: true,
            selected,
            requiresNewSession:
                Boolean(current?.substrate) &&
                (current?.substrate !== MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT ||
                    text(current?.modelId) !== selected.modelId),
            quota,
            nativeBlockedByQuota,
            nativeCandidates,
            byokCandidates,
            reasons: [
                'native_copilot_account_visible_model_selected',
                `sdk_quota:${quotaStatus}`,
                quotaStatus === 'critical' || quotaStatus === 'warn'
                    ? 'quota_pressure_cost_weight_increased'
                    : 'quality_reliability_first',
            ],
        };
    }

    if (byokEligible[0]) {
        const selected = byokEligible[0];
        return {
            schema: 'model-gateway-controller-selection-plan',
            status: MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BYOK_FALLBACK_READY,
            ready: true,
            selected,
            requiresNewSession:
                current?.substrate !== MODEL_GATEWAY_CONTROLLER_SUBSTRATES.BYOK ||
                text(current?.providerId) !== selected.providerId ||
                text(current?.providerModel) !== selected.providerModel,
            quota,
            nativeBlockedByQuota,
            nativeCandidates,
            byokCandidates,
            reasons: [
                nativeBlockedByQuota ? 'native_copilot_quota_blocked' : 'no_eligible_native_controller_model',
                'byok_fallback_requires_fresh_agent_proof',
            ],
        };
    }

    if (!nativeBlockedByQuota && input.allowOpaqueSdkAutoFallback === true) {
        return {
            schema: 'model-gateway-controller-selection-plan',
            status: MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.COMPATIBILITY_AUTO,
            ready: true,
            selected: {
                substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
                modelId: 'auto',
                opaque: true,
            },
            requiresNewSession: false,
            quota,
            nativeBlockedByQuota,
            nativeCandidates,
            byokCandidates,
            reasons: [
                'sdk_model_catalog_unavailable_or_empty',
                'opaque_auto_allowed_only_as_explicit_compatibility_fallback',
            ],
        };
    }

    return {
        schema: 'model-gateway-controller-selection-plan',
        status: MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BLOCKED,
        ready: false,
        selected: null,
        requiresNewSession: false,
        quota,
        nativeBlockedByQuota,
        nativeCandidates,
        byokCandidates,
        reasons: [
            nativeBlockedByQuota ? 'native_copilot_quota_blocked' : 'no_eligible_native_controller_model',
            byokCandidates.length > 0 ? 'no_byok_route_with_fresh_agent_proof' : 'no_byok_controller_candidates',
        ],
    };
}
