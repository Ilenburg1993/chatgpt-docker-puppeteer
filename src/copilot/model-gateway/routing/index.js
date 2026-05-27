// @ts-check
/**
 * Routing helpers for model-gateway candidates.
 *
 * @module copilot/model-gateway/routing
 */

export { buildModelGatewayRouteCandidates } from './candidate-builder.js';
export { explainGatewayRouteDecision } from './explain.js';
export {
    evaluateGatewayModelHealthRoute,
    isGatewayModelAgentProbeHealthFailed,
    isGatewayModelAgentProbeVerified,
    isGatewayModelChatHealthFailed,
    isGatewayModelProbeFailed,
    isGatewayModelProbeVerified,
    listGatewayModelVerifiedProbeKinds,
    readGatewayModelHealth,
    readGatewayModelHealthFromRecords,
    readGatewayModelProbeHealth,
} from './health-routing.js';
export {
    MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
    renderModelGatewayLocalProviderOptInGuidance,
    summarizeModelGatewayLocalProviderOptInBlocks,
} from './local-provider-opt-in.js';
export {
    MODEL_GATEWAY_TASK_PROFILES,
    listModelGatewayTaskProfiles,
    resolveModelGatewayTaskProfile,
} from './task-profiles.js';
export { routeGatewayModels, routeModelGatewayCatalogSnapshot, scoreGatewayModelCandidate } from './policy-engine.js';
export { auditModelGatewayPostRuntimeSelection, auditModelGatewayPreRuntimeSelection } from './selection-audit.js';
