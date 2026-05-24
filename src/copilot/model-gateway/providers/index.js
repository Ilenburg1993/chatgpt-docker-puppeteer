// @ts-check
/**
 * Provider adapters exported by the model gateway.
 *
 * @module copilot/model-gateway/providers
 */

export { OpenAICompatibleAdapter, openAICompatibleAdapter } from './openai-compatible-adapter.js';
export { ANTHROPIC_BASE_URL, ANTHROPIC_PROVIDER_ID, AnthropicAdapter, anthropicAdapter } from './anthropic-adapter.js';
export { GEMINI_OPENAI_BASE_URL, GEMINI_PROVIDER_ID, GeminiAdapter, geminiAdapter } from './gemini-adapter.js';
export {
    OPENAI_PROVIDER_FAMILY_SPECS,
    OpenAIProviderFamilyAdapter,
    openAIProviderFamilyAdapters,
} from './openai-provider-family-adapter.js';
export {
    OLLAMA_CLOUD_BASE_URL,
    OLLAMA_LOCAL_BASE_URL,
    OLLAMA_PROVIDER_IDS,
    OllamaAdapter,
    ollamaAdapter,
} from './ollama-adapter.js';
export {
    OPENROUTER_BASE_URL,
    OPENROUTER_DEFAULT_HEADERS,
    OPENROUTER_PROVIDER_ID,
    OpenRouterAdapter,
    openRouterAdapter,
} from './openrouter-adapter.js';
export {
    ProviderAdapterRegistry,
    createDefaultProviderAdapterRegistry,
    defaultProviderAdapterRegistry,
    resolveModelGatewayProviderAdapter,
} from './provider-adapter-registry.js';
