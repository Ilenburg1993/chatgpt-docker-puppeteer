// @ts-check
/**
 * Canonical event names emitted by the model gateway.
 *
 * @module copilot/events/model-gateway-events
 */

export const MODEL_GATEWAY_REGISTRY_SNAPSHOT = 'model_gateway:registry:snapshot';
export const MODEL_GATEWAY_PROVIDER_IMPORTED = 'model_gateway:provider:imported';
export const MODEL_GATEWAY_MODEL_IMPORTED = 'model_gateway:model:imported';
export const MODEL_GATEWAY_CATALOG_IMPORT_STARTED = 'model_gateway:catalog:import_started';
export const MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED = 'model_gateway:catalog:import_completed';
export const MODEL_GATEWAY_CATALOG_MODEL_ADDED = 'model_gateway:catalog:model_added';
export const MODEL_GATEWAY_CATALOG_MODEL_CHANGED = 'model_gateway:catalog:model_changed';
export const MODEL_GATEWAY_CATALOG_MODEL_REMOVED = 'model_gateway:catalog:model_removed';
export const MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED = 'model_gateway:catalog:conflict_detected';
export const MODEL_GATEWAY_ELIGIBILITY_EVALUATED = 'model_gateway:eligibility:evaluated';
export const MODEL_GATEWAY_ROUTE_DECISION = 'model_gateway:route:decision';
export const MODEL_GATEWAY_PROBE_COMPLETED = 'model_gateway:probe:completed';
export const MODEL_GATEWAY_PROVIDER_FAILURE = 'model_gateway:provider:failure';

export const MODEL_GATEWAY_EVENTS = Object.freeze([
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_CATALOG_IMPORT_STARTED,
    MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED,
    MODEL_GATEWAY_CATALOG_MODEL_ADDED,
    MODEL_GATEWAY_CATALOG_MODEL_CHANGED,
    MODEL_GATEWAY_CATALOG_MODEL_REMOVED,
    MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED,
    MODEL_GATEWAY_ELIGIBILITY_EVALUATED,
    MODEL_GATEWAY_ROUTE_DECISION,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
]);
