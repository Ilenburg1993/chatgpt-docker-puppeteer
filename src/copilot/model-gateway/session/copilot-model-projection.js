// @ts-check
/**
 * Projection from gateway model records to GitHub Copilot SDK ModelInfo.
 *
 * The SDK must receive provider-local model IDs. The gateway keeps globally unique IDs as `provider:model`, but the
 * session bridge projects back to `providerModel` when advertising or creating provider-bound sessions.
 *
 * @module copilot/model-gateway/session/copilot-model-projection
 */

import { buildModelGatewayRouteCandidates } from '../routing/index.js';

/**
 * @typedef {object} ModelGatewayCopilotByokMetadata
 * @property {string} gatewayId
 * @property {string} routeCandidateId
 * @property {string | null} provider
 * @property {string} providerModel
 * @property {string} sdkModelId
 * @property {string | null} routeProfile
 * @property {string | null} profile
 * @property {boolean | null} freeTier
 * @property {boolean | null} profileFreeTier
 * @property {string | null} profileCostSource
 * @property {string | null} profileCostDetail
 * @property {string | null} routeOptionRef
 * @property {string[]} routeOptionRefs
 * @property {string | null} selectorKind
 * @property {string | null} selectorSyntax
 * @property {string | null} routeLayer
 * @property {string | null} wireApi
 * @property {boolean} autoSelection
 * @property {boolean} supportsFallback
 * @property {string} source
 * @property {string} confidence
 * @property {boolean} supportsReasoning
 * @property {string[]} inputModalities
 * @property {string[]} outputModalities
 * @property {Record<string, unknown>} capabilities
 * @property {Record<string, unknown>} limits
 * @property {{ maxRequestTokens: number | null; tokensPerMinute: number | null; requestsPerMinute: number | null; dailyRequests: number | null }} rateLimits
 * @property {{ prompt: number | null; completion: number | null; request: number | null }} pricing
 */

/** @typedef {import('#copilot/sdk/types').ModelInfo & { byok: ModelGatewayCopilotByokMetadata }} ModelGatewayCopilotModelInfo */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}


/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    return Array.isArray(value)
        ? value.map(optionalString).filter((item) => item !== null)
        : [];
}

/**
 * @param {Record<string, unknown>} model
 * @returns {string}
 */
function sdkModelId(model) {
    return optionalString(model['selectorSyntax']) ?? optionalString(model['providerModel']) ?? optionalString(model['id']) ?? 'unknown-model';
}

/**
 * @param {Record<string, unknown>} model
 * @returns {ModelGatewayCopilotModelInfo | null}
 */
export function toCopilotModelInfo(model) {
    const providerModel = optionalString(model['providerModel']) ?? optionalString(model['id']) ?? 'unknown-model';
    const sdkId = sdkModelId(model);
    const gatewayId = optionalString(model['canonicalModelId']) ?? optionalString(model['id']) ?? providerModel;
    const routeCandidateId = optionalString(model['routeCandidateId']) ?? optionalString(model['id']) ?? gatewayId;
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    const limits = isRecord(model['limits']) ? model['limits'] : {};
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const verification = isRecord(model['verification']) ? model['verification'] : {};
    const provenance = isRecord(model['provenance']) ? model['provenance'] : {};
    const modalities = isRecord(model['modalities']) ? model['modalities'] : {};
    const pricing = isRecord(model['pricing']) ? model['pricing'] : {};
    const routeOptionRefs = stringList(model['routeOptionRefs']);
    const contextWindowTokens = optionalNumber(limits['contextWindowTokens']);
    if (contextWindowTokens === null || contextWindowTokens <= 0) return null;
    const promptPrice = optionalNumber(pricing['inputUsdPerMillion']);
    const completionPrice = optionalNumber(pricing['outputUsdPerMillion']);
    const requestPrice = optionalNumber(pricing['requestUsd']);
    const pricingKnown = promptPrice !== null || completionPrice !== null || requestPrice !== null;
    const freeTier = pricingKnown
        ? (promptPrice ?? 0) === 0 && (completionPrice ?? 0) === 0 && (requestPrice ?? 0) === 0
        : null;
    const routeProfile = optionalString(model['routeProfile']) ?? optionalString(provenance['profile']);
    const profileFreeTier = typeof provenance['profileFreeTier'] === 'boolean' ? provenance['profileFreeTier'] : null;
    /** @type {ModelGatewayCopilotModelInfo} */
    const info = {
        id: sdkId,
        name: optionalString(model['displayName']) ?? sdkId,
        capabilities: {
            supports: {
                vision: capabilities['vision'] === true,
                reasoningEffort: capabilities['reasoningEffort'] === true,
            },
            limits: {
                max_context_window_tokens: contextWindowTokens,
            },
        },
        policy: {
            state: model['enabled'] === false ? 'disabled' : 'enabled',
            terms: [
                `provider:${optionalString(model['providerId']) ?? 'unknown'}`,
                `gateway:${gatewayId}`,
                `route:${routeCandidateId}`,
                `selector:${optionalString(model['selectorKind']) ?? 'exact_model'}`,
                `confidence:${optionalString(verification['confidence']) ?? 'unknown'}`,
            ].join(' '),
        },
        billing: { multiplier: 0 },
        byok: {
            gatewayId,
            routeCandidateId,
            provider: optionalString(model['providerId']),
            providerModel,
            sdkModelId: sdkId,
            routeProfile,
            profile: routeProfile,
            freeTier,
            profileFreeTier,
            profileCostSource: optionalString(provenance['profileCostSource']),
            profileCostDetail: optionalString(provenance['profileCostDetail']),
            routeOptionRef: optionalString(model['routeOptionRef']),
            routeOptionRefs,
            selectorKind: optionalString(model['selectorKind']),
            selectorSyntax: optionalString(model['selectorSyntax']),
            routeLayer: optionalString(routing['routeLayer']),
            wireApi: optionalString(routing['wireApi']),
            autoSelection: routing['autoSelection'] === true,
            supportsFallback: routing['supportsFallback'] === true,
            source:
                optionalString(provenance['source']) ??
                stringList(verification['sources'])[0] ??
                'model-gateway',
            confidence: optionalString(verification['confidence']) ?? 'unknown',
            supportsReasoning: capabilities['reasoningEffort'] === true,
            inputModalities: stringList(modalities['input']).length > 0 ? stringList(modalities['input']) : ['text'],
            outputModalities: stringList(modalities['output']).length > 0 ? stringList(modalities['output']) : ['text'],
            capabilities: { ...capabilities },
            limits: { ...limits },
            rateLimits: {
                maxRequestTokens: optionalNumber(limits['maxRequestTokens']),
                tokensPerMinute: optionalNumber(limits['tokensPerMinute']),
                requestsPerMinute: optionalNumber(limits['requestsPerMinute']),
                dailyRequests: optionalNumber(limits['dailyRequests']),
            },
            pricing: {
                prompt: promptPrice,
                completion: completionPrice,
                request: requestPrice,
            },
        },
    };
    return info;
}

/**
 * @param {Record<string, unknown>[]} models
 * @returns {ModelGatewayCopilotModelInfo[]}
 */
export function toCopilotModelInfoList(models) {
    return models
        .filter((model) => model['enabled'] !== false)
        .map(toCopilotModelInfo)
        .filter((model) => model !== null);
}

/**
 * @param {object} input
 * @param {Record<string, unknown>[]} [input.projections]
 * @param {Record<string, unknown>[]} [input.routeOptions]
 * @param {boolean} [input.includeProjectionOnly]
 * @returns {ModelGatewayCopilotModelInfo[]}
 */
export function toCopilotRouteModelInfoList(input = {}) {
    return toCopilotModelInfoList(
        buildModelGatewayRouteCandidates({
            projections: Array.isArray(input.projections) ? input.projections : [],
            routeOptions: Array.isArray(input.routeOptions) ? input.routeOptions : [],
            ...(input.includeProjectionOnly !== undefined ? { includeProjectionOnly: input.includeProjectionOnly } : {}),
        }),
    );
}
