// @ts-check
/**
 * Deterministic policy scoring for model-gateway candidates.
 *
 * This is intentionally a pure, auditable first pass. Runtime probes remain the stronger evidence, but the policy
 * engine gives terminal/server code one shared explanation for "why this model" before any live call is attempted.
 *
 * @module copilot/model-gateway/routing/policy-engine
 */

import { evaluateGatewayModelHealthRoute, isGatewayModelAgentProbeVerified } from './health-routing.js';
import { resolveModelGatewayTaskProfile } from './task-profiles.js';
import { evaluateModelGatewayEligibility } from '../eligibility/index.js';

const CONFIDENCE_SCORE = Object.freeze({
    unknown: 0,
    static_seed: 5,
    catalog: 15,
    manual: 30,
    probe_verified: 60,
    probe_failed: -80,
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {Record<string, any>} model
 * @param {string} capability
 * @returns {boolean}
 */
function hasCapability(model, capability) {
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    if (capability === 'text') return capabilities['text'] !== false;
    if (capability === 'free') return model['routing']?.['tier'] === 'free' || model['pricing']?.['inputUsdPerMillion'] === 0;
    return capabilities[capability] === true;
}

/**
 * @param {Record<string, any>} model
 * @returns {number | null}
 */
function contextWindow(model) {
    return finiteNumber(model['limits']?.['contextWindowTokens']) ?? finiteNumber(model['limits']?.['maxContextWindowTokens']);
}

/**
 * @param {Record<string, any>} model
 * @returns {number | null}
 */
function pricePerMillion(model) {
    const input = finiteNumber(model['pricing']?.['inputUsdPerMillion']);
    const output = finiteNumber(model['pricing']?.['outputUsdPerMillion']);
    if (input === null && output === null) return null;
    return (input ?? 0) + (output ?? 0);
}

/**
 * @param {Record<string, any>} model
 * @param {string} field
 * @returns {string}
 */
function routePolicyText(model, field) {
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    return String(routing[field] ?? policy[field] ?? '').trim();
}

/**
 * @param {unknown} value
 * @returns {Set<string>}
 */
function stringSet(value) {
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean));
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>} profile
 * @param {{
 *     routeProfile?: string | null;
 *     excludeFailed?: boolean;
 *     requireAgentProbeOk?: boolean;
 *     allowProviders?: string[];
 *     blockProviders?: string[];
 *     preferredRouteLayers?: string[];
 *     blockRouteLayers?: string[];
 *     preferredWireApis?: string[];
 *     blockWireApis?: string[];
 *     preferredSelectorKinds?: string[];
 *     blockSelectorKinds?: string[];
 *     latencyMsByModelId?: Record<string, number>;
 *     eligibilityDecisions?: Record<string, any>[];
 *     evaluateEligibility?: boolean;
 *     routeOptions?: Record<string, any>[];
 *     accountOverlays?: Record<string, any>[];
 *     secretRegistry?: { has(ref: string): boolean };
 *     eligibilityPolicy?: Record<string, any>;
 * }} [options]
 * @returns {{
 *     model: Record<string, any>;
 *     include: boolean;
 *     score: number;
 *     reasons: string[];
 *     rejectedReasons: string[];
 *     eligibility: Record<string, any> | null;
 *     health: ReturnType<typeof evaluateGatewayModelHealthRoute>['health'];
 * }}
 */
export function scoreGatewayModelCandidate(model, profile, options = {}) {
    const reasons = [];
    const rejectedReasons = [];
    const providerId = typeof model['providerId'] === 'string' ? model['providerId'] : '';
    const allowProviders = stringSet(options.allowProviders);
    const blockProviders = stringSet(options.blockProviders);
    const preferredRouteLayers = stringSet(options.preferredRouteLayers);
    const blockRouteLayers = stringSet(options.blockRouteLayers);
    const preferredWireApis = stringSet(options.preferredWireApis);
    const blockWireApis = stringSet(options.blockWireApis);
    const preferredSelectorKinds = stringSet(options.preferredSelectorKinds);
    const blockSelectorKinds = stringSet(options.blockSelectorKinds);
    const eligibility = resolveCandidateEligibility(model, profile, options);
    let score = 100;

    if (eligibility) {
        reasons.push(`eligibility:${eligibility['disposition'] ?? 'unknown'}`);
        if (eligibility['include'] === false) {
            for (const reason of Array.isArray(eligibility['hardExclusions']) ? eligibility['hardExclusions'] : []) {
                rejectedReasons.push(`eligibility:${reason}`);
            }
        }
        const softPenalties = Array.isArray(eligibility['softPenalties']) ? eligibility['softPenalties'] : [];
        score -= Math.min(40, softPenalties.length * 5);
    }

    if (model['enabled'] === false) rejectedReasons.push('model_disabled');
    if (allowProviders.size > 0 && !allowProviders.has(providerId)) rejectedReasons.push('provider_not_allowed');
    if (blockProviders.has(providerId)) rejectedReasons.push('provider_blocked');
    const routeLayer = routePolicyText(model, 'routeLayer');
    const wireApi = routePolicyText(model, 'wireApi');
    const selectorKind = String(model['selectorKind'] ?? routePolicyText(model, 'selectorKind')).trim();
    if (routeLayer && blockRouteLayers.has(routeLayer)) rejectedReasons.push(`route_layer_blocked:${routeLayer}`);
    if (wireApi && blockWireApis.has(wireApi)) rejectedReasons.push(`wire_api_blocked:${wireApi}`);
    if (selectorKind && blockSelectorKinds.has(selectorKind)) rejectedReasons.push(`selector_kind_blocked:${selectorKind}`);
    if (routeLayer && preferredRouteLayers.has(routeLayer)) {
        score += 20;
        reasons.push(`preferred_route_layer:${routeLayer}`);
    }
    if (wireApi && preferredWireApis.has(wireApi)) {
        score += 15;
        reasons.push(`preferred_wire_api:${wireApi}`);
    }
    if (selectorKind && preferredSelectorKinds.has(selectorKind)) {
        score += 10;
        reasons.push(`preferred_selector_kind:${selectorKind}`);
    }

    for (const capability of profile['requires'] ?? []) {
        if (!hasCapability(model, capability)) rejectedReasons.push(`missing_capability:${capability}`);
        else score += 50;
    }

    for (const capability of profile['softRequires'] ?? []) {
        if (hasCapability(model, capability)) {
            score += 25;
            reasons.push(`soft_capability:${capability}`);
        } else {
            score -= 5;
            reasons.push(`missing_soft_capability:${capability}`);
        }
    }

    const minContext = finiteNumber(profile['minContextWindowTokens']);
    const context = contextWindow(model);
    if (minContext !== null) {
        if (context !== null && context < minContext) rejectedReasons.push(`context_too_small:${context}<${minContext}`);
        else if (context !== null) {
            const contextBonus = Math.min(40, Math.floor((context - minContext) / 16_000));
            if (contextBonus > 0) {
                score += contextBonus;
                reasons.push(`context_bonus:${context}`);
            }
        }
    }

    const healthDecision = evaluateGatewayModelHealthRoute(model, {
        routeProfile: options.routeProfile ?? null,
        ...(options.excludeFailed !== undefined ? { excludeFailed: options.excludeFailed } : {}),
        requireAgentProbeOk: options.requireAgentProbeOk ?? profile['requireAgentProbeOk'] === true,
    });
    if (!healthDecision.include) rejectedReasons.push(healthDecision.reason);
    if (healthDecision.health) {
        if (healthDecision.health.lastStatus === 'ok') {
            score += 25;
            reasons.push('chat_health_ok');
        }
        if (isGatewayModelAgentProbeVerified(healthDecision.health)) {
            score += 80;
            reasons.push('agent_probe_verified');
        }
    }

    for (const preference of profile['prefers'] ?? []) {
        if (hasCapability(model, preference)) {
            score += 10;
            reasons.push(`preferred:${preference}`);
        }
        if (preference === 'large_context' && context !== null && context >= 128_000) {
            score += 20;
            reasons.push('preferred:large_context');
        }
        if (preference === 'runtime_proved' && healthDecision.health && isGatewayModelAgentProbeVerified(healthDecision.health)) {
            score += 20;
            reasons.push('preferred:runtime_proved');
        }
        if ((preference === 'low_cost' || preference === 'free') && pricePerMillion(model) === 0) {
            score += 30;
            reasons.push('preferred:free');
        }
    }

    const confidence = typeof model['verification']?.['confidence'] === 'string' ? model['verification']['confidence'] : 'unknown';
    score += CONFIDENCE_SCORE[/** @type {keyof typeof CONFIDENCE_SCORE} */ (confidence)] ?? 0;
    reasons.push(`confidence:${confidence}`);

    const price = pricePerMillion(model);
    if (price !== null) {
        const pricePenalty = Math.min(60, Math.floor(price));
        score -= pricePenalty;
        reasons.push(`price_per_million:${price}`);
    }

    const latency = finiteNumber(options.latencyMsByModelId?.[String(model['id'] ?? '')]);
    if (latency !== null) {
        const latencyPenalty = Math.min(50, Math.floor(latency / 1_000));
        score -= latencyPenalty;
        reasons.push(`latency_ms:${latency}`);
    }

    return {
        model,
        include: rejectedReasons.length === 0,
        score,
        reasons,
        rejectedReasons,
        eligibility,
        health: healthDecision.health,
    };
}

/**
 * @param {Record<string, any>} model
 * @returns {string}
 */
function modelEligibilityKey(model) {
    return [
        String(model['providerId'] ?? 'unknown-provider'),
        String(model['providerModel'] ?? model['id'] ?? 'unknown-model'),
        String(model['routeProfile'] ?? 'default'),
    ].join(':');
}

/**
 * @param {Record<string, any>} route
 * @returns {string}
 */
function routeEligibilityKey(route) {
    return [
        String(route['providerId'] ?? 'unknown-provider'),
        String(route['providerModel'] ?? 'unknown-model'),
        String(route['routeProfile'] ?? 'default'),
    ].join(':');
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>[]} routes
 * @returns {Record<string, any> | null}
 */
function findRouteOptionForModel(model, routes) {
    const key = modelEligibilityKey(model);
    return routes.find((route) => routeEligibilityKey(route) === key) ?? null;
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>[]} decisions
 * @returns {Record<string, any> | null}
 */
function findEligibilityDecisionForModel(model, decisions) {
    const key = modelEligibilityKey(model);
    return (
        decisions.find(
            (decision) =>
                [
                    String(decision['providerId'] ?? 'unknown-provider'),
                    String(decision['providerModel'] ?? 'unknown-model'),
                    String(decision['routeProfile'] ?? 'default'),
                ].join(':') === key,
        ) ?? null
    );
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>} profile
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @returns {Record<string, any> | null}
 */
function resolveCandidateEligibility(model, profile, options = {}) {
    const precomputed = findEligibilityDecisionForModel(
        model,
        Array.isArray(options.eligibilityDecisions) ? options.eligibilityDecisions : [],
    );
    if (precomputed) return precomputed;
    if (options.evaluateEligibility !== true) return null;
    return evaluateModelGatewayEligibility({
        projection: model,
        routeOption: findRouteOptionForModel(model, Array.isArray(options.routeOptions) ? options.routeOptions : []) ?? undefined,
        accountOverlays: Array.isArray(options.accountOverlays) ? options.accountOverlays : [],
        secretRegistry: options.secretRegistry,
        policy: {
            ...(isRecord(options.eligibilityPolicy) ? options.eligibilityPolicy : {}),
            taskProfile: typeof profile['id'] === 'string' ? profile['id'] : undefined,
        },
    });
}

/**
 * @param {Record<string, any>[]} models
 * @param {string | Record<string, any>} profileInput
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} [options]
 * @returns {{
 *     profile: Record<string, any>;
 *     selected: ReturnType<typeof scoreGatewayModelCandidate> | null;
 *     candidates: ReturnType<typeof scoreGatewayModelCandidate>[];
 *     rejected: ReturnType<typeof scoreGatewayModelCandidate>[];
 *     fallbackChain: string[];
 * }}
 */
export function routeGatewayModels(models, profileInput, options = {}) {
    const profile =
        typeof profileInput === 'string'
            ? resolveModelGatewayTaskProfile(profileInput)
            : isRecord(profileInput)
              ? profileInput
              : null;
    if (!profile) throw new Error(`[model-gateway/policy] perfil de tarefa desconhecido: ${String(profileInput)}`);

    const scored = models.map((model) => scoreGatewayModelCandidate(model, profile, options));
    const candidates = scored
        .filter((candidate) => candidate.include)
        .sort((a, b) => b.score - a.score || String(a.model['id']).localeCompare(String(b.model['id'])));
    const rejected = scored.filter((candidate) => !candidate.include);
    return {
        profile,
        selected: candidates[0] ?? null,
        candidates,
        rejected,
        fallbackChain: candidates.map((candidate) => String(candidate.model['id'] ?? candidate.model['providerModel'] ?? 'unknown')),
    };
}
