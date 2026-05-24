// @ts-check
/**
 * Provider adapters exported by the model gateway.
 *
 * @module copilot/model-gateway/providers
 */

export { OpenAICompatibleAdapter, openAICompatibleAdapter } from './openai-compatible-adapter.js';
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
