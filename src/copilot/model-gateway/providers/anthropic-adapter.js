// @ts-check
/**
 * Anthropic provider adapter.
 *
 * Anthropic is a first-class SDK provider type rather than an OpenAI-compatible route. This adapter gives the gateway a
 * dedicated projection point while reusing the shared auth/capability mapping from the generic adapter.
 *
 * @module copilot/model-gateway/providers/anthropic-adapter
 */

import { OpenAICompatibleAdapter, providerRecord } from './openai-compatible-adapter.js';

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * @param {Record<string, unknown>} provider
 * @returns {boolean}
 */
function isAnthropicProvider(provider) {
    const provenance = providerRecord(provider['provenance']);
    return (
        provider['id'] === ANTHROPIC_PROVIDER_ID ||
        provider['id'] === 'claude' ||
        provider['providerType'] === 'anthropic' ||
        provenance['preset'] === ANTHROPIC_PROVIDER_ID ||
        provenance['preset'] === 'claude' ||
        String(provider['baseUrl'] ?? '').includes('anthropic.com')
    );
}

export class AnthropicAdapter extends OpenAICompatibleAdapter {
    /** @override */
    id = ANTHROPIC_PROVIDER_ID;

    /**
     * @param {Record<string, unknown>} provider
     * @returns {boolean}
     * @override
     */
    canHandle(provider) {
        return isAnthropicProvider(provider);
    }

    /**
     * @param {import('./openai-compatible-adapter.js').ModelGatewayProviderAdapterInput} input
     * @override
     */
    toCopilotSessionOverrides(input) {
        if (!this.canHandle(input.provider)) {
            throw new Error('[model-gateway/anthropic] provider record is not Anthropic');
        }
        const overrides = super.toCopilotSessionOverrides({
            ...input,
            provider: {
                ...input.provider,
                providerType: 'anthropic',
                wireApi: undefined,
                baseUrl: input.provider['baseUrl'] || ANTHROPIC_BASE_URL,
            },
        });
        /** @type {import('#copilot/sdk/types').ProviderConfig} */
        const provider = {
            ...overrides.provider,
            type: 'anthropic',
        };
        return {
            ...overrides,
            provider,
            gateway: {
                providerFamily: ANTHROPIC_PROVIDER_ID,
                openAiCompatibleEndpoint: false,
            },
        };
    }
}

export const anthropicAdapter = new AnthropicAdapter();
