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
 * @param {Record<string, any>} model
 * @returns {string}
 */
function sdkModelId(model) {
    return optionalString(model['selectorSyntax']) ?? optionalString(model['providerModel']) ?? optionalString(model['id']) ?? 'unknown-model';
}

/**
 * @param {Record<string, any>} model
 * @returns {import('#copilot/sdk/types').ModelInfo}
 */
export function toCopilotModelInfo(model) {
    const providerModel = optionalString(model['providerModel']) ?? optionalString(model['id']) ?? 'unknown-model';
    const sdkId = sdkModelId(model);
    const gatewayId = optionalString(model['canonicalModelId']) ?? optionalString(model['id']) ?? providerModel;
    const routeCandidateId = optionalString(model['routeCandidateId']) ?? optionalString(model['id']) ?? gatewayId;
    const capabilities = model['capabilities'] ?? {};
    const limits = model['limits'] ?? {};
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    return /** @type {import('#copilot/sdk/types').ModelInfo} */ ({
        id: sdkId,
        name: model['displayName'] ?? sdkId,
        capabilities: {
            supports: {
                vision: Boolean(capabilities.vision),
                reasoningEffort: Boolean(capabilities.reasoningEffort),
            },
            limits: {
                max_context_window_tokens:
                    typeof limits['contextWindowTokens'] === 'number' ? limits['contextWindowTokens'] : undefined,
            },
        },
        policy: {
            state: model['enabled'] === false ? 'disabled' : 'enabled',
            terms: [
                `provider:${model['providerId'] ?? 'unknown'}`,
                `gateway:${gatewayId}`,
                `route:${routeCandidateId}`,
                `selector:${model['selectorKind'] ?? 'exact_model'}`,
                `confidence:${model['verification']?.confidence ?? 'unknown'}`,
            ].join(' '),
        },
        billing: { multiplier: 0 },
        byok: {
            gatewayId,
            routeCandidateId,
            provider: model['providerId'] ?? null,
            providerModel,
            sdkModelId: sdkId,
            routeProfile: model['routeProfile'] ?? null,
            routeOptionRef: model['routeOptionRef'] ?? null,
            routeOptionRefs: Array.isArray(model['routeOptionRefs']) ? model['routeOptionRefs'] : [],
            selectorKind: model['selectorKind'] ?? null,
            selectorSyntax: model['selectorSyntax'] ?? null,
            routeLayer: routing['routeLayer'] ?? null,
            wireApi: routing['wireApi'] ?? null,
            autoSelection: routing['autoSelection'] === true,
            supportsFallback: routing['supportsFallback'] === true,
            source: model['provenance']?.source ?? model['verification']?.sources?.[0] ?? 'model-gateway',
            confidence: model['verification']?.confidence ?? 'unknown',
            supportsReasoning: Boolean(capabilities.reasoningEffort),
            inputModalities: Array.isArray(model['modalities']?.input) ? model['modalities'].input : ['text'],
            outputModalities: Array.isArray(model['modalities']?.output) ? model['modalities'].output : ['text'],
            capabilities: model['capabilities'] ?? {},
            limits,
            rateLimits: {
                maxRequestTokens: limits['maxRequestTokens'] ?? null,
                tokensPerMinute: limits['tokensPerMinute'] ?? null,
                requestsPerMinute: limits['requestsPerMinute'] ?? null,
                dailyRequests: limits['dailyRequests'] ?? null,
            },
            pricing: {
                prompt: model['pricing']?.inputUsdPerMillion ?? null,
                completion: model['pricing']?.outputUsdPerMillion ?? null,
                request: model['pricing']?.requestUsd ?? null,
            },
        },
    });
}

/**
 * @param {Record<string, any>[]} models
 * @returns {import('#copilot/sdk/types').ModelInfo[]}
 */
export function toCopilotModelInfoList(models) {
    return models.filter((model) => model?.['enabled'] !== false).map(toCopilotModelInfo);
}

/**
 * @param {object} input
 * @param {Record<string, any>[]} [input.projections]
 * @param {Record<string, any>[]} [input.routeOptions]
 * @param {boolean} [input.includeProjectionOnly]
 * @returns {import('#copilot/sdk/types').ModelInfo[]}
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
