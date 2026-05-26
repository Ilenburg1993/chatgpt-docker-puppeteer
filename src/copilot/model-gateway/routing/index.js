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
    readGatewayModelHealth,
} from './health-routing.js';
export {
    MODEL_GATEWAY_TASK_PROFILES,
    listModelGatewayTaskProfiles,
    resolveModelGatewayTaskProfile,
} from './task-profiles.js';
export { routeGatewayModels, scoreGatewayModelCandidate } from './policy-engine.js';
