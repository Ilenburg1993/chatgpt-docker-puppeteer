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
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    normalizeStoredCatalogSnapshot,
} from './json-catalog-store.js';
export { mergeModelMetadataEvidence, rankCatalogEvidenceConfidence } from './merge.js';
