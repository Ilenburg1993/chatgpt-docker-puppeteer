// @ts-check
/**
 * Canonical event names emitted by the model gateway.
 *
 * @module copilot/events/model-gateway-events
 */

export const MODEL_GATEWAY_REGISTRY_SNAPSHOT = 'model_gateway:registry:snapshot';
export const MODEL_GATEWAY_PROVIDER_IMPORTED = 'model_gateway:provider:imported';
export const MODEL_GATEWAY_MODEL_IMPORTED = 'model_gateway:model:imported';
export const MODEL_GATEWAY_ROUTE_DECISION = 'model_gateway:route:decision';
export const MODEL_GATEWAY_PROBE_COMPLETED = 'model_gateway:probe:completed';
export const MODEL_GATEWAY_PROVIDER_FAILURE = 'model_gateway:provider:failure';

export const MODEL_GATEWAY_EVENTS = Object.freeze([
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_ROUTE_DECISION,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
]);

