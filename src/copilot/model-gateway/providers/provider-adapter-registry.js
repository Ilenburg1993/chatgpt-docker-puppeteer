// @ts-check
/**
 * Provider adapter registry.
 *
 * The registry is intentionally small and synchronous: it resolves a safe provider record into the adapter that can
 * project it to SDK session overrides. This is the migration point that prevents new BYOK providers from requiring
 * edits in `sdk/session/provider.js`.
 *
 * @module copilot/model-gateway/providers/provider-adapter-registry
 */

import { anthropicAdapter } from './anthropic-adapter.js';
import { geminiAdapter } from './gemini-adapter.js';
import { ollamaAdapter } from './ollama-adapter.js';
import { openAICompatibleAdapter } from './openai-compatible-adapter.js';
import { openAIProviderFamilyAdapters } from './openai-provider-family-adapter.js';
import { openRouterAdapter } from './openrouter-adapter.js';

/** @typedef {import('./openai-compatible-adapter.js').OpenAICompatibleAdapter} OpenAICompatibleAdapter */

export class ProviderAdapterRegistry {
    /** @type {OpenAICompatibleAdapter[]} */
    #adapters;

    /**
     * @param {OpenAICompatibleAdapter[]} adapters
     */
    constructor(adapters) {
        this.#adapters = [...adapters];
    }

    /**
     * @returns {OpenAICompatibleAdapter[]}
     */
    list() {
        return [...this.#adapters];
    }

    /**
     * @param {Record<string, unknown>} provider
     * @returns {OpenAICompatibleAdapter}
     */
    resolve(provider) {
        const adapter = this.#adapters.find((candidate) => candidate.canHandle(provider));
        return adapter ?? openAICompatibleAdapter;
    }
}

export function createDefaultProviderAdapterRegistry() {
    return new ProviderAdapterRegistry([
        openRouterAdapter,
        ollamaAdapter,
        geminiAdapter,
        anthropicAdapter,
        ...openAIProviderFamilyAdapters,
        openAICompatibleAdapter,
    ]);
}

export const defaultProviderAdapterRegistry = createDefaultProviderAdapterRegistry();

/**
 * @param {Record<string, unknown>} provider
 * @returns {OpenAICompatibleAdapter}
 */
export function resolveModelGatewayProviderAdapter(provider) {
    return defaultProviderAdapterRegistry.resolve(provider);
}
