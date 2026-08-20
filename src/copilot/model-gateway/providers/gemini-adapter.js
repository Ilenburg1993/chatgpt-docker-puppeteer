// @ts-check
/**
 * Gemini provider adapter.
 *
 * The current BYOK bridge reaches Gemini through Google's OpenAI-compatible endpoint. Keeping a Gemini adapter lets the
 * gateway preserve provider identity, large context defaults and vision/reasoning expectations while still using the
 * generic wire mapper.
 *
 * @module copilot/model-gateway/providers/gemini-adapter
 */

import { OpenAICompatibleAdapter, providerRecord } from './openai-compatible-adapter.js';

export const GEMINI_PROVIDER_ID = 'gemini';
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * @param {Record<string, unknown>} provider
 * @returns {boolean}
 */
function isGeminiProvider(provider) {
    const provenance = providerRecord(provider['provenance']);
    return (
        provider['id'] === GEMINI_PROVIDER_ID ||
        provenance['preset'] === GEMINI_PROVIDER_ID ||
        String(provider['baseUrl'] ?? '').includes('generativelanguage.googleapis.com')
    );
}

export class GeminiAdapter extends OpenAICompatibleAdapter {
    /** @override */
    id = GEMINI_PROVIDER_ID;

    /**
     * @param {Record<string, unknown>} provider
     * @returns {boolean}
     * @override
     */
    canHandle(provider) {
        return isGeminiProvider(provider);
    }

    /**
     * @param {import('./openai-compatible-adapter.js').ModelGatewayProviderAdapterInput} input
     * @override
     */
    toCopilotSessionOverrides(input) {
        if (!this.canHandle(input.provider)) {
            throw new Error('[model-gateway/gemini] provider record is not Gemini');
        }
        const overrides = super.toCopilotSessionOverrides({
            ...input,
            provider: {
                ...input.provider,
                providerType: 'openai',
                baseUrl: input.provider['baseUrl'] || GEMINI_OPENAI_BASE_URL,
            },
        });
        return {
            ...overrides,
            gateway: {
                providerFamily: GEMINI_PROVIDER_ID,
                openAiCompatibleEndpoint: true,
            },
        };
    }
}

export const geminiAdapter = new GeminiAdapter();
