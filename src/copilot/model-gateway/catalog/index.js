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
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
    createProviderCatalogSource,
} from './contracts.js';
export {
    createCatalogImportRun,
    createSanitizedRawPayloadRef,
    diffCanonicalModelProjections,
} from './import-runs.js';
export {
    OPENROUTER_MODELS_CATALOG_URL,
    createOpenRouterModelsImporter,
} from './importers/index.js';
export { runCatalogImporters } from './importer-runner.js';
export {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    normalizeStoredCatalogSnapshot,
} from './json-catalog-store.js';
export { mergeModelMetadataEvidence, rankCatalogEvidenceConfidence } from './merge.js';
