// @ts-check
/**
 * Model-gateway registry barrel.
 *
 * @module copilot/model-gateway/registry
 */

export { importConfiguredByokFromEnv } from './env-byok-compat-importer.js';
export {
    DEFAULT_MODEL_GATEWAY_REGISTRY_PATH,
    JsonModelGatewayRegistryStore,
    normalizeStoredRegistrySnapshot,
} from './json-registry-store.js';
export { ModelGatewayRegistry } from './model-registry.js';
export { buildModelGatewayEffectiveRouteProjection, buildModelGatewayOperatorProjection } from './projection.js';
export { buildEnvByokModelGatewaySnapshot, persistEnvByokModelGatewaySnapshot } from './snapshot.js';
