// @ts-check
/**
 * Canonical BYOK/model routing domain.
 *
 * This barrel intentionally exposes only stable contracts and projections. Runtime bridges should depend on this module,
 * while `src/copilot/sdk` remains the thin GitHub Copilot SDK boundary.
 *
 * @module copilot/model-gateway
 */

export {
    MODEL_GATEWAY_SCHEMA_VERSION,
    MODEL_GATEWAY_VERIFICATION_CONFIDENCE,
    buildProviderModelId,
    createModelRecord,
    createProviderRecord,
    normalizeCapabilityProfile,
    normalizeGatewayIdPart,
    normalizeModalities,
    normalizeVerification,
    optionalPositiveInteger,
    optionalString,
} from './contracts/records.js';
export { ModelGatewayRegistry } from './registry/model-registry.js';
export { importConfiguredByokFromEnv } from './registry/env-byok-compat-importer.js';
export {
    DEFAULT_MODEL_GATEWAY_REGISTRY_PATH,
    JsonModelGatewayRegistryStore,
    normalizeStoredRegistrySnapshot,
} from './registry/json-registry-store.js';
export { buildModelGatewayOperatorProjection } from './registry/projection.js';
export { buildEnvByokModelGatewaySnapshot, persistEnvByokModelGatewaySnapshot } from './registry/snapshot.js';
export {
    DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS,
    EnvSecretRegistry,
    createEnvSecretRegistry,
} from './secrets/env-secret-registry.js';
export { redactSecretRecord, redactSecretText } from './secrets/redaction.js';
export {
    ANTHROPIC_BASE_URL,
    ANTHROPIC_PROVIDER_ID,
    AnthropicAdapter,
    GEMINI_OPENAI_BASE_URL,
    GEMINI_PROVIDER_ID,
    GeminiAdapter,
    OPENROUTER_BASE_URL,
    OPENROUTER_DEFAULT_HEADERS,
    OPENROUTER_PROVIDER_ID,
    OLLAMA_CLOUD_BASE_URL,
    OLLAMA_LOCAL_BASE_URL,
    OLLAMA_PROVIDER_IDS,
    OPENAI_PROVIDER_FAMILY_SPECS,
    OllamaAdapter,
    OpenAIProviderFamilyAdapter,
    ProviderAdapterRegistry,
    anthropicAdapter,
    createDefaultProviderAdapterRegistry,
    defaultProviderAdapterRegistry,
    geminiAdapter,
    OpenAICompatibleAdapter,
    OpenRouterAdapter,
    ollamaAdapter,
    openAICompatibleAdapter,
    openAIProviderFamilyAdapters,
    openRouterAdapter,
    resolveModelGatewayProviderAdapter,
} from './providers/index.js';
export { buildModelGatewayOnListModelsHandler } from './session/on-list-models.js';
export { toCopilotModelInfo, toCopilotModelInfoList } from './session/copilot-model-projection.js';
export {
    BYOK_AGENT_PROBE_ANSWER,
    BYOK_AGENT_PROBE_QUESTION,
    BYOK_AGENT_PROBE_READ_PATH,
    BYOK_AGENT_PROBE_READ_TOOL,
    BYOK_AGENT_PROBE_TOOL,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
} from './probes/index.js';
export {
    MODEL_GATEWAY_EVENTS,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
    buildRegistrySnapshotEvent,
    projectModelGatewayMetrics,
} from './observability/events.js';
