// @ts-check
/**
 * Ollama provider adapter.
 *
 * Ollama local/cloud speaks an OpenAI-compatible chat surface in this project, but routing needs to know whether a model
 * is local/private or cloud-backed. This adapter preserves that identity while reusing the generic wire mapping.
 *
 * @module copilot/model-gateway/providers/ollama-adapter
 */

import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';

export const OLLAMA_PROVIDER_IDS = Object.freeze(['ollama-local', 'ollama-cloud']);
export const OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com/v1';

/**
 * @param {Record<string, any>} provider
 * @returns {boolean}
 */
function isOllamaProvider(provider) {
    return (
        OLLAMA_PROVIDER_IDS.includes(String(provider['id'] ?? '')) ||
        OLLAMA_PROVIDER_IDS.includes(String(provider['provenance']?.['preset'] ?? '')) ||
        provider['baseUrl'] === OLLAMA_LOCAL_BASE_URL ||
        provider['baseUrl'] === OLLAMA_CLOUD_BASE_URL
    );
}

/**
 * @param {Record<string, any>} provider
 * @returns {'local' | 'cloud'}
 */
function resolveOllamaRuntimeKind(provider) {
    const id = String(provider['id'] ?? provider['provenance']?.['preset'] ?? '');
    const baseUrl = String(provider['baseUrl'] ?? '');
    return id === 'ollama-local' || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') ? 'local' : 'cloud';
}

export class OllamaAdapter extends OpenAICompatibleAdapter {
    /** @override */
    id = 'ollama';

    /**
     * @param {Record<string, any>} provider
     * @returns {boolean}
     */
    canHandle(provider) {
        return isOllamaProvider(provider);
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
            throw new Error('[model-gateway/ollama] provider record is not Ollama');
        }
        const runtimeKind = resolveOllamaRuntimeKind(input.provider);
        const overrides = super.toCopilotSessionOverrides({
            ...input,
            provider: {
                ...input.provider,
                providerType: 'openai',
                baseUrl:
                    input.provider['baseUrl'] ||
                    (runtimeKind === 'local' ? OLLAMA_LOCAL_BASE_URL : OLLAMA_CLOUD_BASE_URL),
            },
        });
        return {
            ...overrides,
            gateway: {
                providerFamily: 'ollama',
                runtimeKind,
                localPrivate: runtimeKind === 'local',
            },
        };
    }
}

export const ollamaAdapter = new OllamaAdapter();
