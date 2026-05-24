// @ts-check
/**
 * Projection from gateway model records to GitHub Copilot SDK ModelInfo.
 *
 * The SDK must receive provider-local model IDs. The gateway keeps globally unique IDs as `provider:model`, but the
 * session bridge projects back to `providerModel` when advertising or creating provider-bound sessions.
 *
 * @module copilot/model-gateway/session/copilot-model-projection
 */

/**
 * @param {Record<string, any>} model
 * @returns {import('#copilot/sdk/types').ModelInfo}
 */
export function toCopilotModelInfo(model) {
    const providerModel =
        typeof model['providerModel'] === 'string' && model['providerModel'] ? model['providerModel'] : model['id'];
    const capabilities = model['capabilities'] ?? {};
    const limits = model['limits'] ?? {};
    return /** @type {import('#copilot/sdk/types').ModelInfo} */ ({
        id: providerModel,
        name: model['displayName'] ?? providerModel,
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
                `gateway:${model['id'] ?? providerModel}`,
                `confidence:${model['verification']?.confidence ?? 'unknown'}`,
            ].join(' '),
        },
        billing: { multiplier: 0 },
        byok: {
            gatewayId: model['id'] ?? null,
            provider: model['providerId'] ?? null,
            providerModel,
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
