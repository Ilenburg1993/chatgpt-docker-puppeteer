// @ts-check
/**
 * OpenAI-compatible provider adapter.
 *
 * This is the canonical SDK projection boundary for gateway provider/model records. Dynamic gateway records are
 * validated here; only a real SDK ProviderConfig plus a string model identifier crosses into session binding.
 *
 * @module copilot/model-gateway/providers/openai-compatible-adapter
 */

/**
 * @typedef {object} ModelGatewayProviderAdapterInput
 * @property {Record<string, unknown>} provider
 * @property {Record<string, unknown>} model
 * @property {import('../control-plane/ports.js').ModelGatewaySecretRegistryPort} secrets
 */

/**
 * @typedef {object} ModelGatewayProviderSessionOverrides
 * @property {string} model
 * @property {import('#copilot/sdk/types').ProviderConfig} provider
 * @property {{
 *   supports: { reasoningEffort: boolean; vision: boolean };
 *   limits: { max_context_window_tokens?: number };
 * }} modelCapabilities
 * @property {(Record<string, unknown> & {
 *   providerFamily: string;
 *   openAiCompatibleEndpoint?: boolean;
 *   runtimeKind?: string;
 *   localPrivate?: boolean;
 * }) | undefined} [gateway]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isProviderRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function providerRecord(value) {
    return isProviderRecord(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function optionalProviderString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value) ? value.map(optionalProviderString).filter((item) => item !== null) : [];
}

/**
 * @param {unknown} value
 * @returns {'openai' | 'azure' | 'anthropic'}
 */
function sdkProviderType(value) {
    return value === 'azure' || value === 'anthropic' ? value : 'openai';
}

/**
 * @param {unknown} value
 * @returns {'completions' | 'responses' | null}
 */
function sdkWireApi(value) {
    return value === 'completions' || value === 'responses' ? value : null;
}

/**
 * @param {Record<string, unknown>} provider
 * @param {import('../control-plane/ports.js').ModelGatewaySecretRegistryPort} secrets
 * @returns {{ apiKey?: string; bearerToken?: string }}
 */
function resolveProviderAuth(provider, secrets) {
    const auth = providerRecord(provider['auth']);
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
     * Fallback adapter accepts any canonical provider record; specialized adapters override this predicate.
     *
     * @param {Record<string, unknown>} _
     * @returns {boolean}
     */
    canHandle(_) {
        return true;
    }

    /**
     * @param {ModelGatewayProviderAdapterInput} input
     * @returns {ModelGatewayProviderSessionOverrides}
     */
    toCopilotSessionOverrides(input) {
        const baseUrl = optionalProviderString(input.provider['baseUrl']);
        const providerModel = optionalProviderString(input.model['providerModel']);
        if (!baseUrl) throw new Error('[model-gateway/openai-compatible] provider.baseUrl is required');
        if (!providerModel) throw new Error('[model-gateway/openai-compatible] model.providerModel is required');

        const capabilities = providerRecord(input.model['capabilities']);
        const limits = providerRecord(input.model['limits']);
        const wireApi = sdkWireApi(input.provider['wireApi']);
        const contextWindowTokens =
            typeof limits['contextWindowTokens'] === 'number' && Number.isFinite(limits['contextWindowTokens'])
                ? limits['contextWindowTokens']
                : null;
        /** @type {import('#copilot/sdk/types').ProviderConfig} */
        const provider = {
            type: sdkProviderType(input.provider['providerType']),
            baseUrl,
            ...(wireApi ? { wireApi } : {}),
            ...resolveProviderAuth(input.provider, input.secrets),
        };

        return {
            model: providerModel,
            provider,
            modelCapabilities: {
                supports: {
                    reasoningEffort: Boolean(capabilities['reasoningEffort']),
                    vision: Boolean(capabilities['vision']),
                },
                limits: {
                    ...(contextWindowTokens !== null ? { max_context_window_tokens: contextWindowTokens } : {}),
                },
            },
        };
    }
}

export const openAICompatibleAdapter = new OpenAICompatibleAdapter();
