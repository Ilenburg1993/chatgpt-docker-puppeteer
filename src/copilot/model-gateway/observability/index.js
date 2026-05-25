// @ts-check
/**
 * Model-gateway observability barrel.
 *
 * @module copilot/model-gateway/observability
 */

export {
    MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED,
    MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED,
    MODEL_GATEWAY_CATALOG_IMPORT_STARTED,
    MODEL_GATEWAY_CATALOG_MODEL_ADDED,
    MODEL_GATEWAY_CATALOG_MODEL_CHANGED,
    MODEL_GATEWAY_CATALOG_MODEL_REMOVED,
    MODEL_GATEWAY_EVENTS,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
    buildCatalogConflictDetectedEvents,
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshCompletedEvent,
    buildCatalogRefreshModelEvents,
    buildCatalogRefreshStartedEvent,
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    buildRouteDecisionTraceAttributes,
    projectCatalogRefreshCompletedMetrics,
    projectProbeCompletedMetrics,
    projectRouteDecisionMetrics,
    projectModelGatewayMetrics,
} from './events.js';
export {
    listModelGatewayRouteDecisions,
    recordModelGatewayRouteDecision,
    resetModelGatewayRouteDecisionLedgerForTests,
} from './route-decision-ledger.js';
