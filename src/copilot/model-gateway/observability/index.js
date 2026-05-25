// @ts-check
/**
 * Model-gateway observability barrel.
 *
 * @module copilot/model-gateway/observability
 */

export {
    MODEL_GATEWAY_EVENTS,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
    buildProbeCompletedEvent,
    buildRegistrySnapshotEvent,
    buildRouteDecisionEvent,
    buildRouteDecisionTraceAttributes,
    projectProbeCompletedMetrics,
    projectRouteDecisionMetrics,
    projectModelGatewayMetrics,
} from './events.js';
export {
    listModelGatewayRouteDecisions,
    recordModelGatewayRouteDecision,
    resetModelGatewayRouteDecisionLedgerForTests,
} from './route-decision-ledger.js';
