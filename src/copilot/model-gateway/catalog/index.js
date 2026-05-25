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
} from './import-runs.js';
export {
    KILO_GATEWAY_MODELS_CATALOG_URL,
    KILO_GATEWAY_PROVIDERS_CATALOG_URL,
    OPENAI_MODELS_CATALOG_URL,
    OPENROUTER_MODELS_CATALOG_URL,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
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
