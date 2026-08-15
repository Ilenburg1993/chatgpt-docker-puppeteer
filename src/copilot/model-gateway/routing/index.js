// @ts-check
/**
 * Routing helpers for model-gateway candidates.
 *
 * @module copilot/model-gateway/routing
 */

export { buildModelGatewayRouteCandidates } from './candidate-builder.js';
export { explainGatewayRouteDecision } from './explain.js';
export {
    DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_MAX_AGE_MS,
    MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS,
    MODEL_GATEWAY_PROVIDER_COOLDOWN_FAILURE_KINDS,
    createGatewayRuntimeHealthIndex,
    evaluateGatewayModelHealthRoute,
    evaluateGatewayProviderHealthCooldown,
    hasFreshGatewayRuntimeProof,
    isGatewayModelAgentProbeFreshlyVerified,
    isGatewayModelAgentProbeHealthActivelyFailed,
    isGatewayModelAgentProbeHealthFailed,
    isGatewayModelAgentProbeVerified,
    isGatewayModelChatHealthFailed,
    isGatewayModelProbeActivelyFailed,
    isGatewayModelProbeFailed,
    isGatewayModelProbeFreshlyVerified,
    isGatewayModelProbeVerified,
    listGatewayModelVerifiedProbeKinds,
    summarizeGatewayRuntimeProofFreshness,
    readGatewayModelHealth,
    readGatewayModelHealthFromIndex,
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
export {
    DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS,
    routeGatewayModels,
    routeModelGatewayCatalogSnapshot,
    scoreGatewayModelCandidate,
} from './policy-engine.js';
export {
    buildModelGatewayControlPlaneHostEnv,
    buildModelGatewayRuntimeSelectorProbeEnv,
    buildModelGatewayRuntimeSelectorProbeRun,
    buildModelGatewayRuntimeProofCommands,
    buildModelGatewayRuntimeStandbyPlan,
    buildModelGatewayRuntimeStandbyRoutes,
    buildModelGatewayRuntimeSelectorPlan,
    evaluateModelGatewayRuntimeSelectorRouteEnv,
    executeModelGatewayRuntimeSelectorPlan,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    resolveModelGatewayRuntimeRetryDecision,
    selectModelGatewayRuntimeRoute,
} from './runtime-selector.js';
export {
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    compareModelGatewaySelectionAudits,
    explainModelGatewaySelectionComparison,
    MODEL_GATEWAY_SELECTION_POLICY_MODE,
    resolveModelGatewaySelectionPolicy,
} from './selection-audit.js';
export {
    applyModelGatewaySelectionTraceRetention,
    buildModelGatewaySelectionDecisionTrace,
    compareModelGatewaySelectionDecisionTraces,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    listModelGatewaySelectionDecisionTraceFiles,
    persistModelGatewaySelectionDecisionTrace,
    readModelGatewaySelectionDecisionTrace,
} from './selection-trace.js';
