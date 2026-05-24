// @ts-check
/**
 * Parameterized OpenAI-compatible provider-family adapters.
 *
 * These adapters move provider-specific identity out of `sdk/session/provider.js`: adding a new OpenAI-compatible BYOK
 * provider should be a gateway concern, with the SDK boundary receiving only the resulting `ProviderConfig`.
 *
 * @module copilot/model-gateway/providers/openai-provider-family-adapter
 */

import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';

/**
 * @typedef {object} OpenAIProviderFamilySpec
 * @property {string} id
 * @property {readonly string[]} providerIds
 * @property {readonly string[]} [baseUrls]
 * @property {string} defaultBaseUrl
 * @property {Record<string, string>} [headers]
 * @property {Record<string, unknown>} [gateway]
 */

/**
 * @param {Record<string, any>} provider
 * @returns {string[]}
 */
function providerIdentityParts(provider) {
    return [
        provider['id'],
        provider['provenance']?.['preset'],
        provider['provenance']?.['profile'],
    ]
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => String(item));
}

export class OpenAIProviderFamilyAdapter extends OpenAICompatibleAdapter {
    /** @type {OpenAIProviderFamilySpec} */
    spec;

    /**
     * @param {OpenAIProviderFamilySpec} spec
     */
    constructor(spec) {
        super();
        this.spec = spec;
        this.id = spec.id;
    }

    /**
     * @param {Record<string, any>} provider
     * @returns {boolean}
     */
    canHandle(provider) {
        const identities = providerIdentityParts(provider);
        if (identities.some((part) => this.spec.providerIds.includes(part))) return true;
        const baseUrl = String(provider['baseUrl'] ?? '');
        return Boolean(baseUrl && (this.spec.baseUrls ?? [this.spec.defaultBaseUrl]).some((candidate) => baseUrl === candidate));
    }

    /**
     * @param {{
     *     provider: Record<string, any>;
     *     model: Record<string, any>;
     *     secrets: import('../secrets/env-secret-registry.js').EnvSecretRegistry;
     * }} input
     * @returns {{ model: string; provider: Record<string, any>; modelCapabilities?: Record<string, any>; gateway?: Record<string, any> }}
     * @override
     */
    toCopilotSessionOverrides(input) {
        if (!this.canHandle(input.provider)) {
            throw new Error(`[model-gateway/${this.id}] provider record is not handled by this adapter`);
        }
        const overrides = super.toCopilotSessionOverrides({
            ...input,
            provider: {
                ...input.provider,
                providerType: 'openai',
                baseUrl: input.provider['baseUrl'] || this.spec.defaultBaseUrl,
            },
        });
        return {
            ...overrides,
            provider: {
                ...overrides.provider,
                ...(this.spec.headers
                    ? {
                          headers: {
                              ...this.spec.headers,
                              ...(overrides.provider['headers'] ?? {}),
                          },
                      }
                    : {}),
            },
            gateway: {
                providerFamily: this.id,
                openAiCompatibleEndpoint: true,
                ...(this.spec.gateway ?? {}),
            },
        };
    }
}

/** @type {readonly OpenAIProviderFamilySpec[]} */
export const OPENAI_PROVIDER_FAMILY_SPECS = Object.freeze([
    {
        id: 'openai',
        providerIds: Object.freeze(['openai', 'openai-compatible']),
        defaultBaseUrl: 'https://api.openai.com/v1',
    },
    {
        id: 'kilo',
        providerIds: Object.freeze(['kilo', 'kilo-code', 'kilo-gateway']),
        defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
    },
    {
        id: 'groq',
        providerIds: Object.freeze(['groq']),
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
    },
    {
        id: 'mistral',
        providerIds: Object.freeze(['mistral']),
        defaultBaseUrl: 'https://api.mistral.ai/v1',
    },
    {
        id: 'huggingface',
        providerIds: Object.freeze(['huggingface']),
        defaultBaseUrl: 'https://router.huggingface.co/v1',
        gateway: Object.freeze({ providerSelectionPolicySuffixes: Object.freeze([':fastest', ':cheapest', ':preferred']) }),
    },
    {
        id: 'cloudflare-workers-ai',
        providerIds: Object.freeze(['cloudflare-workers-ai']),
        defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
        gateway: Object.freeze({ requiresAccountId: true }),
    },
    {
        id: 'nvidia-nim',
        providerIds: Object.freeze(['nvidia-nim']),
        defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    },
    {
        id: 'cerebras',
        providerIds: Object.freeze(['cerebras']),
        defaultBaseUrl: 'https://api.cerebras.ai/v1',
    },
    {
        id: 'chutes',
        providerIds: Object.freeze(['chutes']),
        defaultBaseUrl: 'https://llm.chutes.ai/v1',
    },
    {
        id: 'zai',
        providerIds: Object.freeze(['zai']),
        defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
        headers: Object.freeze({ 'Accept-Language': 'en-US,en' }),
    },
]);

export const openAIProviderFamilyAdapters = Object.freeze(
    OPENAI_PROVIDER_FAMILY_SPECS.map((spec) => new OpenAIProviderFamilyAdapter(spec)),
);
