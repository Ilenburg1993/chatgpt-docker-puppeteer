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
 *     latencyMsByModelId?: Record<string, number>;
 * }} [options]
 * @returns {{
 *     model: Record<string, any>;
 *     include: boolean;
 *     score: number;
 *     reasons: string[];
 *     rejectedReasons: string[];
 *     health: ReturnType<typeof evaluateGatewayModelHealthRoute>['health'];
 * }}
 */
export function scoreGatewayModelCandidate(model, profile, options = {}) {
    const reasons = [];
    const rejectedReasons = [];
    const providerId = typeof model['providerId'] === 'string' ? model['providerId'] : '';
    const allowProviders = stringSet(options.allowProviders);
    const blockProviders = stringSet(options.blockProviders);
    let score = 100;

    if (model['enabled'] === false) rejectedReasons.push('model_disabled');
    if (allowProviders.size > 0 && !allowProviders.has(providerId)) rejectedReasons.push('provider_not_allowed');
    if (blockProviders.has(providerId)) rejectedReasons.push('provider_blocked');

    for (const capability of profile['requires'] ?? []) {
        if (!hasCapability(model, capability)) rejectedReasons.push(`missing_capability:${capability}`);
        else score += 50;
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
        health: healthDecision.health,
    };
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
