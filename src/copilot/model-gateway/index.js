// @ts-check
/**
 * Canonical BYOK/model routing domain.
 *
 * This barrel intentionally exposes only stable contracts and projections. Runtime bridges should depend on this module,
 * while `src/copilot/sdk` remains the thin GitHub Copilot SDK boundary.
 *
 * @module copilot/model-gateway
 */

export {
    MODEL_GATEWAY_SCHEMA_VERSION,
    MODEL_GATEWAY_VERIFICATION_CONFIDENCE,
    buildProviderModelId,
    createModelRecord,
    createProviderRecord,
    normalizeCapabilityProfile,
    normalizeGatewayIdPart,
    normalizeModalities,
    normalizeVerification,
    optionalPositiveInteger,
    optionalString,
} from './contracts/records.js';
export { ModelGatewayRegistry } from './registry/model-registry.js';
export { importConfiguredByokFromEnv } from './registry/env-byok-compat-importer.js';
export { buildEnvByokModelGatewaySnapshot } from './registry/snapshot.js';
export { toCopilotModelInfo, toCopilotModelInfoList } from './session/copilot-model-projection.js';
export {
    MODEL_GATEWAY_EVENTS,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
    buildRegistrySnapshotEvent,
    projectModelGatewayMetrics,
} from './observability/events.js';

