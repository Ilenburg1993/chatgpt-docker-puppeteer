// @ts-check
/**
 * Anthropic provider adapter.
 *
 * Anthropic is a first-class SDK provider type rather than an OpenAI-compatible route. This adapter gives the gateway a
 * dedicated projection point while reusing the shared auth/capability mapping from the generic adapter.
 *
 * @module copilot/model-gateway/providers/anthropic-adapter
 */

import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * @param {Record<string, any>} provider
 * @returns {boolean}
 */
function isAnthropicProvider(provider) {
    return (
        provider['id'] === ANTHROPIC_PROVIDER_ID ||
        provider['id'] === 'claude' ||
        provider['providerType'] === 'anthropic' ||
        provider['provenance']?.['preset'] === ANTHROPIC_PROVIDER_ID ||
        provider['provenance']?.['preset'] === 'claude' ||
        String(provider['baseUrl'] ?? '').includes('anthropic.com')
    );
}

export class AnthropicAdapter extends OpenAICompatibleAdapter {
    /** @override */
    id = ANTHROPIC_PROVIDER_ID;

    /**
     * @param {Record<string, any>} provider
     * @returns {boolean}
     */
    canHandle(provider) {
        return isAnthropicProvider(provider);
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
        return {
            ...overrides,
            provider: {
                ...overrides.provider,
                type: 'anthropic',
            },
            gateway: {
                providerFamily: ANTHROPIC_PROVIDER_ID,
                openAiCompatibleEndpoint: false,
            },
        };
    }
}

export const anthropicAdapter = new AnthropicAdapter();
