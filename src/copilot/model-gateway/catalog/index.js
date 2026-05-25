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
export { mergeModelMetadataEvidence, rankCatalogEvidenceConfidence } from './merge.js';
