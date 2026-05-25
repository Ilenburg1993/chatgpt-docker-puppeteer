// @ts-check
/**
 * Universal catalog contracts and future import/store entrypoints.
 *
 * @module copilot/model-gateway/catalog
 */

export {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
    createCanonicalModelProjection,
    createCanonicalProviderProjection,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
    createProviderCatalogSource,
    createProviderMetadataEvidence,
} from './contracts.js';
export { createDefaultModelGatewayCatalogImporters } from './default-importers.js';
export {
    createCatalogImportRun,
    createSanitizedRawPayloadRef,
    diffCanonicalModelProjections,
    summarizeCanonicalModelProjectionDiff,
} from './import-runs.js';
export {
    ANTHROPIC_MODELS_API_VERSION,
    ANTHROPIC_MODELS_CATALOG_URL,
    CEREBRAS_PUBLIC_MODELS_CATALOG_URL,
    GEMINI_MODELS_API_VERSION,
    GEMINI_MODELS_CATALOG_URL,
    GEMINI_OPENAI_COMPATIBLE_BASE_URL,
    KILO_GATEWAY_MODELS_CATALOG_URL,
    KILO_GATEWAY_PROVIDERS_CATALOG_URL,
    MISTRAL_MODELS_CATALOG_URL,
    OLLAMA_LOCAL_API_BASE_URL,
    OLLAMA_LOCAL_OPENAI_BASE_URL,
    OLLAMA_LOCAL_SHOW_URL,
    OLLAMA_LOCAL_TAGS_URL,
    OPENAI_MODELS_CATALOG_URL,
    OPENROUTER_MODELS_CATALOG_URL,
    createAnthropicModelsImporter,
    createCerebrasPublicModelsImporter,
    createGeminiModelsImporter,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createMistralModelsImporter,
    createOllamaCatalogImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterModelsImporter,
} from './importers/index.js';
export { runCatalogImporters } from './importer-runner.js';
export {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    normalizeStoredCatalogSnapshot,
} from './json-catalog-store.js';
export { mergeModelMetadataEvidence, mergeProviderMetadataEvidence, rankCatalogEvidenceConfidence } from './merge.js';
export {
    OPENAI_MODEL_LIST_OBJECT,
    OPENAI_MODEL_OBJECT,
    toOpenAIModelCatalogEntry,
    toOpenAIModelCatalogList,
} from './openai-schema.js';
export {
    normalizeAccountOverlayControls,
    normalizeCatalogModalities,
    normalizeModelAliases,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
    parseModelModalityExpression,
} from './normalizers.js';
export { refreshModelGatewayCatalog } from './refresh.js';
