// @ts-check
/**
 * OpenAI-compatible provider adapter.
 *
 * This adapter maps gateway provider/model records to a plain SDK-compatible ProviderConfig. It does not create
 * sessions; the SDK bridge remains responsible for validation and lifecycle.
 *
 * @module copilot/model-gateway/providers/openai-compatible-adapter
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value) ? value.map(optionalString).filter((item) => item !== null) : [];
}

/**
 * @param {Record<string, any>} provider
 * @param {import('../secrets/env-secret-registry.js').EnvSecretRegistry} secrets
 * @returns {{ apiKey?: string; bearerToken?: string }}
 */
function resolveProviderAuth(provider, secrets) {
    const auth = provider['auth'] ?? {};
    const bearerRefs = stringArray(auth['bearerTokenRefs']);
    const apiKeyRefs = stringArray(auth['apiKeyRefs']);
    for (const ref of bearerRefs) {
        const token = secrets.get(ref);
        if (token) return { bearerToken: token };
    }
    for (const ref of apiKeyRefs) {
        const apiKey = secrets.get(ref);
        if (apiKey) return { apiKey };
    }
    return {};
}

export class OpenAICompatibleAdapter {
    id = 'openai-compatible';

    /**
     * @param {{
     *     provider: Record<string, any>;
     *     model: Record<string, any>;
     *     secrets: import('../secrets/env-secret-registry.js').EnvSecretRegistry;
     * }} input
     * @returns {{ model: string; provider: Record<string, any>; modelCapabilities?: Record<string, any> }}
     */
    toCopilotSessionOverrides(input) {
        const baseUrl = optionalString(input.provider['baseUrl']);
        const providerModel = optionalString(input.model['providerModel']);
        if (!baseUrl) throw new Error('[model-gateway/openai-compatible] provider.baseUrl is required');
        if (!providerModel) throw new Error('[model-gateway/openai-compatible] model.providerModel is required');
        const capabilities = input.model['capabilities'] ?? {};
        const limits = input.model['limits'] ?? {};
        return {
            model: providerModel,
            provider: {
                type: input.provider['providerType'] ?? 'openai',
                baseUrl,
                ...(input.provider['wireApi'] ? { wireApi: input.provider['wireApi'] } : {}),
                ...resolveProviderAuth(input.provider, input.secrets),
            },
            modelCapabilities: {
                supports: {
                    reasoningEffort: Boolean(capabilities['reasoningEffort']),
                    vision: Boolean(capabilities['vision']),
                },
                limits: {
                    max_context_window_tokens:
                        typeof limits['contextWindowTokens'] === 'number' ? limits['contextWindowTokens'] : undefined,
                },
            },
        };
    }
}

export const openAICompatibleAdapter = new OpenAICompatibleAdapter();

