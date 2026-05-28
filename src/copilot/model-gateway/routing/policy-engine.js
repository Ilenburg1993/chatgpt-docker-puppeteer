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
    MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS,
    createGatewayRuntimeHealthIndex,
    evaluateGatewayProviderHealthCooldown,
    evaluateGatewayModelHealthRoute,
    isGatewayModelAgentProbeVerified,
    isGatewayModelProbeFailed,
    isGatewayModelProbeVerified,
    listGatewayModelVerifiedProbeKinds,
} from './health-routing.js';
import { buildModelGatewayRouteCandidates } from './candidate-builder.js';
import { MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON } from './local-provider-opt-in.js';
import { resolveModelGatewayTaskProfile } from './task-profiles.js';
import { evaluateModelGatewayEligibility } from '../eligibility/index.js';
import { isModelGatewayRuntimeEligibilityOverlayDecision } from '../eligibility/runtime-overlay-decisions.js';

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

const PREFERRED_PROBE_VERIFIED_SCORE = 240;
const PREFERRED_LIVE_PROTOCOL_PROBE_VERIFIED_SCORE = 420;
const PREFERRED_PROBE_FAILED_PENALTY = 120;
const PREFERRED_LIVE_PROTOCOL_PROBE_FAILED_PENALTY = 260;

const NON_CONVERSATIONAL_CAPABILITY_KINDS = Object.freeze({
    embedding: 'embedding',
    embeddings: 'embedding',
    rerank: 'rerank',
    reranker: 'rerank',
    asr: 'asr',
    stt: 'asr',
    transcription: 'asr',
    tts: 'tts',
    imageGeneration: 'image-generation',
    image_generation: 'image-generation',
});

const NON_CONVERSATIONAL_MODALITIES = Object.freeze(['embedding', 'rerank', 'asr', 'tts', 'image-generation']);

const NON_CONVERSATIONAL_WIRE_APIS = Object.freeze({
    openai_embeddings: 'embedding',
    embeddings: 'embedding',
    rerank: 'rerank',
    audio: 'audio',
    image_generation: 'image-generation',
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
 * @param {Record<string, any>} profile
 * @returns {boolean}
 */
function profileRequiresConversationalRoute(profile) {
    const requires = stringArray(profile['requires']);
    const prefers = stringArray(profile['prefers']);
    const explicitNonConversational = new Set(['embedding', 'embeddings', 'rerank', 'asr', 'tts', 'image-generation']);
    return (
        (requires.includes('text') ||
            requires.includes('streaming') ||
            requires.includes('tools') ||
            prefers.includes('forcedToolChoice') ||
            prefers.includes('parallelToolCalls') ||
            prefers.includes('structuredOutputs') ||
            prefers.includes('jsonMode') ||
            prefers.includes('jsonSchema')) &&
        !requires.some((capability) => explicitNonConversational.has(capability))
    );
}

/**
 * @param {Record<string, any>} model
 * @returns {string[]}
 */
function collectModelGatewayFamilyHints(model) {
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    const modalities = isRecord(model['modalities']) ? model['modalities'] : {};
    const providerMetadata = isRecord(model['providerMetadata']) ? model['providerMetadata'] : {};
    const modelTraits = isRecord(providerMetadata['modelTraits']) ? providerMetadata['modelTraits'] : {};
    const routeTraits = isRecord(model['routeTraits']) ? model['routeTraits'] : {};
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const hints = [
        ...stringArray(modalities['input']),
        ...stringArray(modalities['output']),
        ...stringArray(modelTraits['modalityHints']),
        ...stringArray(routeTraits['modalityHints']),
        ...stringArray(routing['modalityHints']),
        ...stringArray(policy['modalityHints']),
        ...stringArray(modelTraits['capabilityFamilies']),
        ...stringArray(routeTraits['capabilityFamilies']),
    ];
    for (const [capability, kind] of Object.entries(NON_CONVERSATIONAL_CAPABILITY_KINDS)) {
        if (capabilities[capability] === true || routeTraits[capability] === true) hints.push(kind);
    }
    const wireApi = routeMetadataText(model, 'wireApi').toLowerCase().replace(/[-\s]+/gu, '_');
    if (wireApi && NON_CONVERSATIONAL_WIRE_APIS[/** @type {keyof typeof NON_CONVERSATIONAL_WIRE_APIS} */ (wireApi)]) {
        hints.push(NON_CONVERSATIONAL_WIRE_APIS[/** @type {keyof typeof NON_CONVERSATIONAL_WIRE_APIS} */ (wireApi)]);
    }
    return [...new Set(hints.map((hint) => String(hint).toLowerCase().replace(/[_\s]+/gu, '-')))];
}

/**
 * @param {Record<string, any>} model
 * @returns {string | null}
 */
function inferNonConversationalModelFamily(model) {
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    const hints = collectModelGatewayFamilyHints(model);
    const explicitHint = NON_CONVERSATIONAL_MODALITIES.find((kind) => hints.includes(kind));
    if (explicitHint) return explicitHint;
    const outputModalities = isRecord(model['modalities']) ? stringArray(model['modalities']['output']) : [];
    if (outputModalities.length > 0 && !outputModalities.includes('text')) return outputModalities[0] ?? 'non-text-output';
    const text = [
        model['providerModel'],
        model['id'],
        model['displayName'],
        model['canonicalSlug'],
        isRecord(model['aliases']) ? model['aliases']['providerModel'] : null,
    ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ')
        .replace(/[^a-z0-9]+/gu, '-');
    if (/(?:^|-)(?:embed|embedding|embeddings|bge|e5|gte|nv-embedqa|nvolveqa|snowflake-arctic-embed|jina-embeddings?)(?:-|$)/u.test(text)) {
        return 'embedding';
    }
    if (/(?:^|-)(?:rerank|reranker)(?:-|$)/u.test(text)) return 'rerank';
    if (/(?:^|-)(?:whisper|parakeet|asr|stt|transcription|tts|speech)(?:-|$)/u.test(text)) return 'audio';
    if (/(?:^|-)(?:text-to-image|image-generation|sdxl|flux)(?:-|$)/u.test(text)) return 'image-generation';
    if (capabilities['chat'] === false) return 'chat-disabled';
    return null;
}

/**
 * @param {Record<string, any>} model
 * @returns {boolean}
 */
function isLocalPrivateCandidate(model) {
    const providerId = String(model['providerId'] ?? '').trim();
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const routeTraits = isRecord(model['routeTraits']) ? model['routeTraits'] : {};
    return (
        providerId === 'ollama-local' ||
        policy['localPrivate'] === true ||
        routeTraits['localPrivate'] === true ||
        routing['routeLayer'] === 'local_daemon' ||
        policy['runtimeKind'] === 'local'
    );
}

/**
 * @param {string} providerId
 * @param {Set<string>} allowProviders
 * @returns {boolean}
 */
function providerExplicitlyAllowsLocal(providerId, allowProviders) {
    return allowProviders.has(providerId) || (providerId === 'ollama-local' && allowProviders.has('ollama'));
}

/**
 * @param {string} providerId
 * @param {Set<string>} allowProviders
 * @returns {boolean}
 */
function providerAllowedByAllowList(providerId, allowProviders) {
    return allowProviders.has(providerId) || (providerId === 'ollama-local' && allowProviders.has('ollama'));
}

/**
 * @param {string} selectorKind
 * @param {string} selectorSyntax
 * @returns {boolean}
 */
function isAutoSelector(selectorKind, selectorSyntax) {
    return /(?:auto|fastest|cheapest|best|router|policy)/iu.test(selectorKind) || /:(?:auto|fastest|cheapest|best)$/iu.test(selectorSyntax);
}

/**
 * @param {string} selectorKind
 * @param {string} routeLayer
 * @returns {boolean}
 */
function isGatewayFallbackSelector(selectorKind, routeLayer) {
    return /fallback/iu.test(selectorKind) || routeLayer === 'gateway_fallback';
}

/**
 * @param {Record<string, any>} profile
 * @param {boolean | undefined} option
 * @returns {boolean}
 */
function localProviderSelectionAllowed(profile, option) {
    if (option !== undefined) return option === true;
    return profile['localProviderOptIn'] === true;
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
 * @param {Record<string, any>} model
 * @returns {boolean}
 */
function privacyStrictSatisfied(model) {
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    const policy = dataPolicy(model);
    const noTraining = policy['training'] === false || policy['trainsOnPrompts'] === false;
    const noRetention = policy['retainsPrompts'] === false || policy['retention'] === false;
    return capabilities['privacy'] === true || (noTraining && noRetention);
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
 * @param {string} reason
 * @returns {string}
 */
function reasonGroup(reason) {
    const [prefix] = reason.split(':');
    if (!prefix) return 'unknown';
    if (prefix.startsWith('preferred')) return 'preference';
    if (prefix.startsWith('runtime_probe') || prefix.includes('probe')) return 'runtime_probe';
    if (prefix.includes('health')) return 'runtime_health';
    if (prefix.includes('price') || prefix.includes('cost')) return 'cost';
    if (prefix.includes('capability')) return 'capability';
    if (prefix.includes('context')) return 'context';
    if (prefix.includes('confidence')) return 'confidence';
    if (prefix.includes('eligibility')) return 'eligibility';
    if (prefix.includes('data_policy')) return 'data_policy';
    if (prefix.includes('route') || prefix.includes('wire') || prefix.includes('upstream') || prefix.includes('selector')) return 'route_policy';
    return prefix;
}

/**
 * @param {string[]} reasons
 * @param {string[]} rejectedReasons
 * @param {number} baseScore
 * @param {number} finalScore
 * @returns {{ baseScore: number; finalScore: number; delta: number; hardGateCount: number; positiveSignals: string[]; negativeSignals: string[]; groups: Record<string, number>; rejectedGroups: Record<string, number> }}
 */
function buildScoreBreakdown(reasons, rejectedReasons, baseScore, finalScore) {
    /** @type {Record<string, number>} */
    const groups = {};
    /** @type {Record<string, number>} */
    const rejectedGroups = {};
    for (const reason of reasons) groups[reasonGroup(reason)] = (groups[reasonGroup(reason)] ?? 0) + 1;
    for (const reason of rejectedReasons) rejectedGroups[reasonGroup(reason)] = (rejectedGroups[reasonGroup(reason)] ?? 0) + 1;
    const negativeSignals = reasons.filter((reason) =>
        /(?:missing|failed|unknown_for_limit|price_per_million|latency_ms|penalty|below|too_small)/iu.test(reason),
    );
    return {
        baseScore,
        finalScore,
        delta: finalScore - baseScore,
        hardGateCount: rejectedReasons.length,
        positiveSignals: reasons.filter((reason) => !negativeSignals.includes(reason)).slice(0, 16),
        negativeSignals: [...negativeSignals, ...rejectedReasons].slice(0, 16),
        groups,
        rejectedGroups,
    };
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
 *     allowSelectorKinds?: string[];
 *     blockSelectorKinds?: string[];
 *     allowAutoSelectors?: boolean;
 *     allowGatewayFallbacks?: boolean;
 *     requireProviderDirect?: boolean;
 *     requiredDataPolicy?: Record<string, unknown>;
 *     preferredDataPolicy?: Record<string, unknown>;
 *     privacyStrict?: boolean;
 *     noPaidModels?: boolean;
 *     maxPricePerMillion?: number;
 *     maxEstimatedCostPerMillion?: number;
 *     preferredMaxPricePerMillion?: number;
 *     minimumConfidence?: string;
 *     preferredProbeKinds?: string[];
 *     requiredProbeKinds?: string[];
 *     blockFailedProbeKinds?: string[];
 *     allowLocalProviders?: boolean;
 *     excludeLocalProvidersByDefault?: boolean;
 *     requireRuntimeProof?: boolean;
 *     requireKnownEligibility?: boolean;
 *     ignoreRuntimeHealth?: boolean;
 *     runtimeHealthRecords?: Record<string, any>[];
 *     runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex>;
 *     now?: string | number | Date;
 *     temporaryFailureCooldownMs?: number;
 *     providerCooldownWindowMs?: number;
 *     providerCooldownMinFailedModels?: number;
 *     providerCooldownFailureKinds?: string[];
 *     latencyMsByModelId?: Record<string, number>;
 *     eligibilityDecisions?: Record<string, any>[];
 *     eligibilityDecisionIndex?: ReturnType<typeof createEligibilityDecisionIndex>;
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
 *     scoreBreakdown: ReturnType<typeof buildScoreBreakdown>;
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
    const allowSelectorKinds = stringSet(options.allowSelectorKinds);
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
    if (options.requireKnownEligibility === true) {
        const disposition = String(eligibility?.['disposition'] ?? 'missing_decision');
        if (!eligibility) rejectedReasons.push('eligibility:missing_decision');
        else if (eligibility['include'] !== true || disposition !== 'eligible') {
            rejectedReasons.push(`eligibility:not_known_access:${disposition}`);
        }
    }

    if (model['enabled'] === false) rejectedReasons.push('model_disabled');
    if (allowProviders.size > 0 && !providerAllowedByAllowList(providerId, allowProviders)) rejectedReasons.push('provider_not_allowed');
    if (blockProviders.has(providerId)) rejectedReasons.push('provider_blocked');
    const routeLayer = routePolicyText(model, 'routeLayer');
    const wireApi = routePolicyText(model, 'wireApi');
    const upstreamProvider = routeMetadataText(model, 'upstreamProvider');
    const selectorKind = String(model['selectorKind'] ?? routePolicyText(model, 'selectorKind')).trim();
    const selectorSyntax = String(model['selectorSyntax'] ?? routePolicyText(model, 'selectorSyntax') ?? model['providerModel'] ?? '').trim();
    const excludeLocalProvidersByDefault = options.excludeLocalProvidersByDefault !== false;
    if (
        isLocalPrivateCandidate(model) &&
        excludeLocalProvidersByDefault &&
        !localProviderSelectionAllowed(profile, options.allowLocalProviders) &&
        !providerExplicitlyAllowsLocal(providerId, allowProviders) &&
        !preferredRouteLayers.has('local_daemon')
    ) {
        rejectedReasons.push(MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON);
    }
    if (routeLayer && blockRouteLayers.has(routeLayer)) rejectedReasons.push(`route_layer_blocked:${routeLayer}`);
    if (wireApi && blockWireApis.has(wireApi)) rejectedReasons.push(`wire_api_blocked:${wireApi}`);
    if (upstreamProvider && allowUpstreamProviders.size > 0 && !allowUpstreamProviders.has(upstreamProvider)) {
        rejectedReasons.push(`upstream_provider_not_allowed:${upstreamProvider}`);
    }
    if (upstreamProvider && blockUpstreamProviders.has(upstreamProvider)) {
        rejectedReasons.push(`upstream_provider_blocked:${upstreamProvider}`);
    }
    if (selectorKind && allowSelectorKinds.size > 0 && !allowSelectorKinds.has(selectorKind)) {
        rejectedReasons.push(`selector_kind_not_allowed:${selectorKind}`);
    }
    if (selectorKind && blockSelectorKinds.has(selectorKind)) rejectedReasons.push(`selector_kind_blocked:${selectorKind}`);
    if (options.allowAutoSelectors === false && isAutoSelector(selectorKind, selectorSyntax)) {
        rejectedReasons.push(`auto_selector_blocked:${selectorKind || selectorSyntax}`);
    }
    if (options.allowGatewayFallbacks === false && isGatewayFallbackSelector(selectorKind, routeLayer)) {
        rejectedReasons.push(`gateway_fallback_blocked:${selectorKind || routeLayer}`);
    }
    if (options.requireProviderDirect === true && routeLayer && routeLayer !== 'direct_provider') {
        rejectedReasons.push(`provider_direct_required:${routeLayer}`);
    }
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
    if (options.privacyStrict === true) {
        if (privacyStrictSatisfied(model)) {
            score += 18;
            reasons.push('privacy_strict_satisfied');
        } else {
            rejectedReasons.push('privacy_strict_not_satisfied');
        }
    }

    const nonConversationalFamily = profileRequiresConversationalRoute(profile) ? inferNonConversationalModelFamily(model) : null;
    if (nonConversationalFamily) rejectedReasons.push(`non_chat_model_family:${nonConversationalFamily}`);

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

    const healthDecision =
        options.ignoreRuntimeHealth === true
            ? { include: true, reason: 'runtime_health_ignored', health: null }
            : evaluateGatewayModelHealthRoute(model, {
                  routeProfile: options.routeProfile ?? null,
                  ...(options.excludeFailed !== undefined ? { excludeFailed: options.excludeFailed } : {}),
                  ...(Array.isArray(options.runtimeHealthRecords) ? { runtimeHealthRecords: options.runtimeHealthRecords } : {}),
                  ...(options.runtimeHealthIndex ? { runtimeHealthIndex: options.runtimeHealthIndex } : {}),
                  ...(options.now !== undefined ? { now: options.now } : {}),
                  ...(typeof options.temporaryFailureCooldownMs === 'number'
                      ? { temporaryFailureCooldownMs: options.temporaryFailureCooldownMs }
                      : {}),
                  requireAgentProbeOk: options.requireAgentProbeOk ?? profile['requireAgentProbeOk'] === true,
              });
    const runtimeHealthSource =
        options.runtimeHealthIndex ?? (Array.isArray(options.runtimeHealthRecords) ? options.runtimeHealthRecords : null);
    const providerCooldownDecision =
        options.ignoreRuntimeHealth === true || !runtimeHealthSource
            ? null
            : evaluateGatewayProviderHealthCooldown(model, runtimeHealthSource, {
                  ...(typeof options.providerCooldownWindowMs === 'number' ? { windowMs: options.providerCooldownWindowMs } : {}),
                  ...(typeof options.providerCooldownMinFailedModels === 'number'
                      ? { minFailedModels: options.providerCooldownMinFailedModels }
                      : {}),
                  ...(Array.isArray(options.providerCooldownFailureKinds)
                      ? { failureKinds: options.providerCooldownFailureKinds }
                      : {}),
              });
    if (!healthDecision.include) rejectedReasons.push(healthDecision.reason);
    if (providerCooldownDecision?.include === false) {
        rejectedReasons.push(`provider_health_cooldown:${providerCooldownDecision.failureKinds.join('+') || 'temporary'}`);
    }
    if (healthDecision.health) {
        if (healthDecision.health.lastStatus === 'ok') {
            score += 140;
            reasons.push('chat_health_ok');
        }
        if (isGatewayModelAgentProbeVerified(healthDecision.health)) {
            score += 140;
            reasons.push('agent_probe_verified');
        }
        for (const kind of listGatewayModelVerifiedProbeKinds(healthDecision.health)) {
            score += 35;
            reasons.push(`runtime_probe_verified:${kind}`);
        }
        for (const kind of preferredProbeKinds) {
            if (isGatewayModelProbeVerified(healthDecision.health, kind)) {
                score += MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS.includes(kind)
                    ? PREFERRED_LIVE_PROTOCOL_PROBE_VERIFIED_SCORE
                    : PREFERRED_PROBE_VERIFIED_SCORE;
                reasons.push(`preferred_probe_verified:${kind}`);
            } else if (isGatewayModelProbeFailed(healthDecision.health, kind)) {
                score -= MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS.includes(kind)
                    ? PREFERRED_LIVE_PROTOCOL_PROBE_FAILED_PENALTY
                    : PREFERRED_PROBE_FAILED_PENALTY;
                reasons.push(`preferred_probe_failed:${kind}`);
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
        if (preference === 'runtime_proved' && hasRuntimeProof(healthDecision.health)) {
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
    const maxPrice = optionNumber(options.maxPricePerMillion) ?? optionNumber(options.maxEstimatedCostPerMillion);
    const preferredMaxPrice = optionNumber(options.preferredMaxPricePerMillion);
    if (price !== null) {
        if (options.noPaidModels === true && price > 0) rejectedReasons.push(`paid_model_blocked:${price}`);
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
        if (options.noPaidModels === true) rejectedReasons.push('price_unknown_for_no_paid_models');
    } else if (options.noPaidModels === true) {
        rejectedReasons.push('price_unknown_for_no_paid_models');
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
        scoreBreakdown: buildScoreBreakdown(reasons, rejectedReasons, 100, score),
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
    if (requires.includes('tools') || prefers.includes('forcedToolChoice') || prefers.includes('parallelToolCalls')) {
        kinds.push('agent', ...MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS);
    }
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
        String(model['selectorKind'] ?? 'exact_model'),
        String(model['selectorSyntax'] ?? model['providerModel'] ?? model['id'] ?? 'unknown-model'),
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
        String(route['selectorKind'] ?? 'exact_model'),
        String(route['selectorSyntax'] ?? route['providerModel'] ?? 'unknown-model'),
    ].join(':');
}

/**
 * @param {Record<string, any>} record
 * @returns {string | null}
 */
function providerModelEligibilityKey(record) {
    const providerId = String(record['providerId'] ?? '').trim();
    const providerModel = String(record['providerModel'] ?? record['id'] ?? '').trim();
    return providerId && providerModel ? `${providerId}:${providerModel}` : null;
}

/**
 * @param {Record<string, any>} record
 * @returns {string}
 */
function modelRouteBaseKey(record) {
    return [
        String(record['providerId'] ?? 'unknown-provider'),
        String(record['providerModel'] ?? record['id'] ?? 'unknown-model'),
        String(record['routeProfile'] ?? 'default'),
    ].join(':');
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>[]} routes
 * @returns {Record<string, any> | null}
 */
function findRouteOptionForModel(model, routes) {
    const key = modelEligibilityKey(model);
    const exact = routes.find((route) => routeEligibilityKey(route) === key);
    if (exact) return exact;
    return routes.find((route) => modelRouteBaseKey(route) === modelRouteBaseKey(model)) ?? null;
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>} profile
 * @param {Record<string, any>[]} decisions
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @returns {Record<string, any> | null}
 */
function findEligibilityDecisionForModel(model, profile, decisions, options = {}) {
    const key = modelEligibilityKey(model);
    const scopedDecisions = decisions.filter((decision) => eligibilityDecisionMatchesSelectionScope(decision, profile, options));
    return (
        scopedDecisions.find((decision) => eligibilityDecisionMatchesRoute(decision, key) && isModelGatewayRuntimeEligibilityOverlayDecision(decision)) ??
        scopedDecisions.find(
            (decision) =>
                eligibilityDecisionMatchesProviderModel(model, decision) &&
                isModelGatewayRuntimeEligibilityOverlayDecision(decision),
        ) ??
        scopedDecisions.find((decision) => eligibilityDecisionMatchesRoute(decision, key)) ??
        null
    );
}

/**
 * @param {Record<string, any>} decision
 * @param {string} key
 * @returns {boolean}
 */
function eligibilityDecisionMatchesRoute(decision, key) {
    return (
        [
            String(decision['providerId'] ?? 'unknown-provider'),
            String(decision['providerModel'] ?? 'unknown-model'),
            String(decision['routeProfile'] ?? 'default'),
            String(decision['selectorKind'] ?? 'exact_model'),
            String(decision['selectorSyntax'] ?? decision['providerModel'] ?? 'unknown-model'),
        ].join(':') === key
    );
}

/**
 * Runtime/account overlays are sometimes generated at provider-model scope before a route-specific selector candidate
 * is rebuilt. A concrete runtime blocker for the same provider/model/account must override older eligible decisions so
 * the selector does not keep retrying a route that has already reported exhausted credits, disabled keys or rate caps.
 *
 * @param {Record<string, any>} model
 * @param {Record<string, any>} decision
 * @returns {boolean}
 */
function eligibilityDecisionMatchesProviderModel(model, decision) {
    return providerModelEligibilityKey(model) !== null && providerModelEligibilityKey(model) === providerModelEligibilityKey(decision);
}

/**
 * @param {Record<string, any>} decision
 * @param {Record<string, any>} profile
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @returns {boolean}
 */
function eligibilityDecisionMatchesSelectionScope(decision, profile, options = {}) {
    const policy = isRecord(options.eligibilityPolicy) ? options.eligibilityPolicy : {};
    const desiredAccountScope = String(policy['accountScope'] ?? 'default');
    const decisionAccountScope = String(decision['accountScope'] ?? 'default');
    if (decisionAccountScope !== desiredAccountScope) return false;

    const desiredPolicyProfile = typeof policy['policyProfile'] === 'string' && policy['policyProfile'] ? policy['policyProfile'] : null;
    const decisionPolicyProfile =
        typeof decision['policyProfile'] === 'string' && decision['policyProfile'] ? decision['policyProfile'] : null;
    if (desiredPolicyProfile && decisionPolicyProfile && decisionPolicyProfile !== 'default' && decisionPolicyProfile !== desiredPolicyProfile) {
        return false;
    }

    const desiredTaskProfile =
        (typeof policy['taskProfile'] === 'string' && policy['taskProfile']) ||
        (typeof profile['id'] === 'string' && profile['id']) ||
        null;
    const decisionTaskProfile = typeof decision['taskProfile'] === 'string' && decision['taskProfile'] ? decision['taskProfile'] : null;
    if (desiredTaskProfile && decisionTaskProfile && decisionTaskProfile !== 'default' && decisionTaskProfile !== desiredTaskProfile) {
        return false;
    }

    return true;
}

/**
 * @param {Record<string, any>[]} decisions
 * @param {Record<string, any>} profile
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @returns {{
 *   schema: 'model-gateway-eligibility-decision-index';
 *   byRouteRuntimeOverlay: Map<string, Record<string, any>>;
 *   byProviderModelRuntimeOverlay: Map<string, Record<string, any>>;
 *   byRoute: Map<string, Record<string, any>>;
 * }}
 */
function createEligibilityDecisionIndex(decisions, profile, options = {}) {
    const byRouteRuntimeOverlay = new Map();
    const byProviderModelRuntimeOverlay = new Map();
    const byRoute = new Map();

    for (const decision of decisions) {
        if (!isRecord(decision) || !eligibilityDecisionMatchesSelectionScope(decision, profile, options)) continue;
        const routeKey = routeEligibilityKey(decision);
        const providerModelKey = providerModelEligibilityKey(decision);
        const runtimeOverlay = isModelGatewayRuntimeEligibilityOverlayDecision(decision);
        if (runtimeOverlay && !byRouteRuntimeOverlay.has(routeKey)) byRouteRuntimeOverlay.set(routeKey, decision);
        if (runtimeOverlay && providerModelKey && !byProviderModelRuntimeOverlay.has(providerModelKey)) {
            byProviderModelRuntimeOverlay.set(providerModelKey, decision);
        }
        if (!byRoute.has(routeKey)) byRoute.set(routeKey, decision);
    }

    return {
        schema: 'model-gateway-eligibility-decision-index',
        byRouteRuntimeOverlay,
        byProviderModelRuntimeOverlay,
        byRoute,
    };
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<typeof createEligibilityDecisionIndex>}
 */
function isEligibilityDecisionIndex(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return (
        candidate['schema'] === 'model-gateway-eligibility-decision-index' &&
        candidate['byRouteRuntimeOverlay'] instanceof Map &&
        candidate['byProviderModelRuntimeOverlay'] instanceof Map &&
        candidate['byRoute'] instanceof Map
    );
}

/**
 * @param {Record<string, any>} model
 * @param {ReturnType<typeof createEligibilityDecisionIndex>} index
 * @returns {Record<string, any> | null}
 */
function findEligibilityDecisionForModelInIndex(model, index) {
    const routeKey = modelEligibilityKey(model);
    const providerModelKey = providerModelEligibilityKey(model);
    return (
        index.byRouteRuntimeOverlay.get(routeKey) ??
        (providerModelKey ? index.byProviderModelRuntimeOverlay.get(providerModelKey) : null) ??
        index.byRoute.get(routeKey) ??
        null
    );
}

/**
 * @param {Record<string, any>} model
 * @param {Record<string, any>} profile
 * @param {Parameters<typeof scoreGatewayModelCandidate>[2]} options
 * @returns {Record<string, any> | null}
 */
function resolveCandidateEligibility(model, profile, options = {}) {
    if (isEligibilityDecisionIndex(options.eligibilityDecisionIndex)) {
        const indexed = findEligibilityDecisionForModelInIndex(model, options.eligibilityDecisionIndex);
        if (indexed) return indexed;
    }
    const precomputed = findEligibilityDecisionForModel(
        model,
        profile,
        Array.isArray(options.eligibilityDecisions) ? options.eligibilityDecisions : [],
        options,
    );
    if (precomputed) return precomputed;
    if (options.evaluateEligibility !== true) return null;
    return evaluateModelGatewayEligibility({
        projection: model,
        routeOption: findRouteOptionForModel(model, Array.isArray(options.routeOptions) ? options.routeOptions : []) ?? model,
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

    let scoringOptions = options;
    if (
        (options.ignoreRuntimeHealth !== true && Array.isArray(options.runtimeHealthRecords) && !options.runtimeHealthIndex) ||
        (Array.isArray(options.eligibilityDecisions) && !options.eligibilityDecisionIndex)
    ) {
        scoringOptions = { ...options };
        if (options.ignoreRuntimeHealth !== true && Array.isArray(options.runtimeHealthRecords) && !options.runtimeHealthIndex) {
            scoringOptions.runtimeHealthIndex = createGatewayRuntimeHealthIndex(options.runtimeHealthRecords);
        }
        if (Array.isArray(options.eligibilityDecisions) && !options.eligibilityDecisionIndex) {
            scoringOptions.eligibilityDecisionIndex = createEligibilityDecisionIndex(options.eligibilityDecisions, profile, options);
        }
    }
    const scored = models.map((model) => scoreGatewayModelCandidate(model, profile, scoringOptions));
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
