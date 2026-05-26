// @ts-check
/**
 * Deterministic policy scoring for model-gateway candidates.
 *
 * This is intentionally a pure, auditable first pass. Runtime probes remain the stronger evidence, but the policy
 * engine gives terminal/server code one shared explanation for "why this model" before any live call is attempted.
 *
 * @module copilot/model-gateway/routing/policy-engine
 */

import {
    evaluateGatewayModelHealthRoute,
    isGatewayModelAgentProbeVerified,
    isGatewayModelProbeFailed,
    isGatewayModelProbeVerified,
    listGatewayModelVerifiedProbeKinds,
} from './health-routing.js';
import { buildModelGatewayRouteCandidates } from './candidate-builder.js';
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

const CONFIDENCE_RANK = Object.freeze({
    unknown: 0,
    static_seed: 1,
    catalog: 2,
    manual: 3,
    probe_verified: 4,
    probe_failed: -1,
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
 * @param {Record<string, any>} model
 * @param {string} field
 * @returns {string}
 */
function routeMetadataText(model, field) {
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const routeProviderSpecific = isRecord(model['routeProviderSpecific']) ? model['routeProviderSpecific'] : {};
    const providerSpecific = isRecord(model['providerSpecific']) ? model['providerSpecific'] : {};
    return String(routing[field] ?? policy[field] ?? routeProviderSpecific[field] ?? providerSpecific[field] ?? '').trim();
}

/**
 * @param {Record<string, any>} model
 * @returns {Record<string, any>}
 */
function dataPolicy(model) {
    const normalizedPolicy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const routeProviderSpecific = isRecord(model['routeProviderSpecific']) ? model['routeProviderSpecific'] : {};
    const routePolicyData = isRecord(normalizedPolicy['dataPolicy']) ? normalizedPolicy['dataPolicy'] : {};
    const routeProviderData = isRecord(routeProviderSpecific['dataPolicy']) ? routeProviderSpecific['dataPolicy'] : {};
    const modelPolicyData = isRecord(model['dataPolicy']) ? model['dataPolicy'] : {};
    return { ...modelPolicyData, ...routeProviderData, ...routePolicyData };
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @returns {boolean}
 */
function policyValueMatches(actual, expected) {
    if (typeof expected === 'boolean') return actual === expected;
    if (typeof expected === 'string') return String(actual ?? '').trim().toLowerCase() === expected.trim().toLowerCase();
    if (typeof expected === 'number') return actual === expected;
    return actual === expected;
}

/**
 * @param {Record<string, any>} model
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @param {number} baseScore
 * @param {string[]} reasons
 * @param {string[]} rejectedReasons
 * @returns {number}
 */
function applyDataPolicyScoring(model, options, baseScore, reasons, rejectedReasons) {
    let score = baseScore;
    const policy = dataPolicy(model);
    for (const [key, expected] of Object.entries(isRecord(options?.requiredDataPolicy) ? options.requiredDataPolicy : {})) {
        if (!(key in policy)) rejectedReasons.push(`data_policy_unknown:${key}`);
        else if (!policyValueMatches(policy[key], expected)) rejectedReasons.push(`data_policy_mismatch:${key}`);
        else {
            score += 12;
            reasons.push(`data_policy_match:${key}`);
        }
    }
    for (const [key, expected] of Object.entries(isRecord(options?.preferredDataPolicy) ? options.preferredDataPolicy : {})) {
        if (key in policy && policyValueMatches(policy[key], expected)) {
            score += 8;
            reasons.push(`preferred_data_policy:${key}`);
        } else if (!(key in policy)) {
            reasons.push(`data_policy_preference_unknown:${key}`);
        }
    }
    return score;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
 *     allowUpstreamProviders?: string[];
 *     blockUpstreamProviders?: string[];
 *     preferredUpstreamProviders?: string[];
 *     preferredSelectorKinds?: string[];
 *     blockSelectorKinds?: string[];
 *     requiredDataPolicy?: Record<string, unknown>;
 *     preferredDataPolicy?: Record<string, unknown>;
 *     maxPricePerMillion?: number;
 *     preferredMaxPricePerMillion?: number;
 *     minimumConfidence?: string;
 *     preferredProbeKinds?: string[];
 *     requiredProbeKinds?: string[];
 *     blockFailedProbeKinds?: string[];
 *     requireRuntimeProof?: boolean;
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
    const allowUpstreamProviders = stringSet(options.allowUpstreamProviders);
    const blockUpstreamProviders = stringSet(options.blockUpstreamProviders);
    const preferredUpstreamProviders = stringSet(options.preferredUpstreamProviders);
    const preferredSelectorKinds = stringSet(options.preferredSelectorKinds);
    const blockSelectorKinds = stringSet(options.blockSelectorKinds);
    const preferredProbeKinds = new Set([...profileProbeKinds(profile), ...stringSet(options.preferredProbeKinds)]);
    const requiredProbeKinds = stringSet(options.requiredProbeKinds);
    const blockFailedProbeKinds = stringSet(options.blockFailedProbeKinds);
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
    const upstreamProvider = routeMetadataText(model, 'upstreamProvider');
    const selectorKind = String(model['selectorKind'] ?? routePolicyText(model, 'selectorKind')).trim();
    if (routeLayer && blockRouteLayers.has(routeLayer)) rejectedReasons.push(`route_layer_blocked:${routeLayer}`);
    if (wireApi && blockWireApis.has(wireApi)) rejectedReasons.push(`wire_api_blocked:${wireApi}`);
    if (upstreamProvider && allowUpstreamProviders.size > 0 && !allowUpstreamProviders.has(upstreamProvider)) {
        rejectedReasons.push(`upstream_provider_not_allowed:${upstreamProvider}`);
    }
    if (upstreamProvider && blockUpstreamProviders.has(upstreamProvider)) {
        rejectedReasons.push(`upstream_provider_blocked:${upstreamProvider}`);
    }
    if (selectorKind && blockSelectorKinds.has(selectorKind)) rejectedReasons.push(`selector_kind_blocked:${selectorKind}`);
    if (routeLayer && preferredRouteLayers.has(routeLayer)) {
        score += 20;
        reasons.push(`preferred_route_layer:${routeLayer}`);
    }
    if (wireApi && preferredWireApis.has(wireApi)) {
        score += 15;
        reasons.push(`preferred_wire_api:${wireApi}`);
    }
    if (upstreamProvider && preferredUpstreamProviders.has(upstreamProvider)) {
        score += 18;
        reasons.push(`preferred_upstream_provider:${upstreamProvider}`);
    }
    if (selectorKind && preferredSelectorKinds.has(selectorKind)) {
        score += 10;
        reasons.push(`preferred_selector_kind:${selectorKind}`);
    }
    score = applyDataPolicyScoring(model, options, score, reasons, rejectedReasons);

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
        for (const kind of listGatewayModelVerifiedProbeKinds(healthDecision.health)) {
            score += 10;
            reasons.push(`runtime_probe_verified:${kind}`);
        }
        for (const kind of preferredProbeKinds) {
            if (isGatewayModelProbeVerified(healthDecision.health, kind)) {
                score += 35;
                reasons.push(`preferred_probe_verified:${kind}`);
            }
        }
        for (const kind of blockFailedProbeKinds) {
            if (isGatewayModelProbeFailed(healthDecision.health, kind)) rejectedReasons.push(`runtime_probe_failed:${kind}`);
        }
    }
    for (const kind of requiredProbeKinds) {
        if (!isGatewayModelProbeVerified(healthDecision.health, kind)) rejectedReasons.push(`required_probe_missing:${kind}`);
    }
    if (options.requireRuntimeProof === true && !hasRuntimeProof(healthDecision.health)) {
        rejectedReasons.push('runtime_proof_missing');
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
    const minimumConfidence = String(options.minimumConfidence ?? '').trim();
    if (minimumConfidence) {
        const currentRank = CONFIDENCE_RANK[/** @type {keyof typeof CONFIDENCE_RANK} */ (confidence)] ?? 0;
        const requiredRank = CONFIDENCE_RANK[/** @type {keyof typeof CONFIDENCE_RANK} */ (minimumConfidence)] ?? 0;
        if (currentRank < requiredRank) rejectedReasons.push(`confidence_below_minimum:${confidence}<${minimumConfidence}`);
    }

    const price = pricePerMillion(model);
    const maxPrice = optionNumber(options.maxPricePerMillion);
    const preferredMaxPrice = optionNumber(options.preferredMaxPricePerMillion);
    if (price !== null) {
        if (maxPrice !== null && price > maxPrice) rejectedReasons.push(`price_above_limit:${price}>${maxPrice}`);
        if (preferredMaxPrice !== null && price <= preferredMaxPrice) {
            score += 20;
            reasons.push(`price_within_preference:${price}<=${preferredMaxPrice}`);
        }
        const pricePenalty = Math.min(60, Math.floor(price));
        score -= pricePenalty;
        reasons.push(`price_per_million:${price}`);
    } else if (maxPrice !== null) {
        reasons.push('price_unknown_for_limit');
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
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value) ? [...stringSet(value)] : [];
}

/**
 * @param {Record<string, any>} profile
 * @returns {string[]}
 */
function profileProbeKinds(profile) {
    const requires = stringArray(profile['requires']);
    const softRequires = stringArray(profile['softRequires']);
    const prefers = stringArray(profile['prefers']);
    const kinds = [];
    if (requires.includes('streaming')) kinds.push('streaming');
    if (requires.includes('tools') || prefers.includes('forcedToolChoice') || prefers.includes('parallelToolCalls')) kinds.push('agent');
    if (prefers.includes('structuredOutputs') || prefers.includes('jsonMode') || prefers.includes('jsonSchema')) kinds.push('json');
    if (softRequires.includes('vision') || prefers.includes('vision')) kinds.push('vision');
    return [...new Set(kinds)];
}

/**
 * @param {ReturnType<typeof evaluateGatewayModelHealthRoute>['health']} health
 * @returns {boolean}
 */
function hasRuntimeProof(health) {
    return (
        Boolean(health?.lastStatus === 'ok') ||
        Boolean(health && isGatewayModelAgentProbeVerified(health)) ||
        listGatewayModelVerifiedProbeKinds(health).length > 0
    );
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

/**
 * @param {Record<string, any>} snapshot
 * @param {string | Record<string, any>} profileInput
 * @param {Parameters<typeof routeGatewayModels>[2] & { includeProjectionOnly?: boolean }} [options]
 * @returns {ReturnType<typeof routeGatewayModels> & { snapshotContext: Record<string, number> }}
 */
export function routeModelGatewayCatalogSnapshot(snapshot, profileInput, options = {}) {
    const projections = Array.isArray(snapshot['projections']) ? snapshot['projections'].filter(isRecord) : [];
    const routeOptions = Array.isArray(snapshot['routeOptions']) ? snapshot['routeOptions'].filter(isRecord) : [];
    const accountOverlays = Array.isArray(snapshot['accountOverlays']) ? snapshot['accountOverlays'].filter(isRecord) : [];
    const eligibilityDecisions = Array.isArray(snapshot['modelEligibilityDecisions'])
        ? snapshot['modelEligibilityDecisions'].filter(isRecord)
        : [];
    const candidates = buildModelGatewayRouteCandidates({
        projections,
        routeOptions,
        includeProjectionOnly: options['includeProjectionOnly'] !== false,
    });
    const route = routeGatewayModels(candidates, profileInput, {
        ...options,
        routeOptions,
        accountOverlays,
        eligibilityDecisions,
    });
    return {
        ...route,
        snapshotContext: {
            projectionCount: projections.length,
            routeOptionCount: routeOptions.length,
            accountOverlayCount: accountOverlays.length,
            eligibilityDecisionCount: eligibilityDecisions.length,
            candidateCount: candidates.length,
        },
    };
}
