// @ts-check
/**
 * OpenRouter provider adapter.
 *
 * OpenRouter is OpenAI-compatible on the wire, but it has provider identity and public routing metadata that should not
 * be hidden behind the generic adapter. This adapter keeps auth resolution delegated to OpenAICompatibleAdapter while
 * adding deterministic provider validation and non-secret attribution headers.
 *
 * @module copilot/model-gateway/providers/openrouter-adapter
 */

import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';

export const OPENROUTER_PROVIDER_ID = 'openrouter';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_HEADERS = Object.freeze({
    'HTTP-Referer': 'https://github.com/Ilenburg1993/chatgpt-docker-puppeteer',
    'X-Title': 'Terminal LLM-B',
});

/**
 * @param {Record<string, any>} provider
 * @returns {boolean}
 */
function isOpenRouterProvider(provider) {
    return (
        provider['id'] === OPENROUTER_PROVIDER_ID ||
        provider['provenance']?.['preset'] === OPENROUTER_PROVIDER_ID ||
        provider['baseUrl'] === OPENROUTER_BASE_URL
    );
}

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
    /** @override */
    id = OPENROUTER_PROVIDER_ID;

    /**
     * @param {Record<string, any>} provider
     * @returns {boolean}
     */
    canHandle(provider) {
        return isOpenRouterProvider(provider);
    }

    /**
     * @param {{
     *     provider: Record<string, any>;
     *     model: Record<string, any>;
     *     secrets: import('../secrets/env-secret-registry.js').EnvSecretRegistry;
     * }} input
     * @returns {{ model: string; provider: Record<string, any>; modelCapabilities?: Record<string, any> }}
     * @override
     */
    toCopilotSessionOverrides(input) {
        if (!this.canHandle(input.provider)) {
            throw new Error('[model-gateway/openrouter] provider record is not OpenRouter');
        }
        const overrides = super.toCopilotSessionOverrides({
            ...input,
            provider: {
                ...input.provider,
                providerType: 'openai',
                baseUrl: input.provider['baseUrl'] || OPENROUTER_BASE_URL,
            },
        });
        return {
            ...overrides,
            provider: {
                ...overrides.provider,
                headers: {
                    ...OPENROUTER_DEFAULT_HEADERS,
                    ...(overrides.provider['headers'] ?? {}),
                },
            },
        };
    }
}

export const openRouterAdapter = new OpenRouterAdapter();
