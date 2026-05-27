// @ts-check
/**
 * Pre-runtime eligibility layer.
 *
 * @module copilot/model-gateway/eligibility
 */

export {
    MODEL_GATEWAY_ELIGIBILITY_DISPOSITION,
    MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS,
    MODEL_GATEWAY_ELIGIBILITY_RUN_STATUS,
    MODEL_GATEWAY_ELIGIBILITY_SCHEMA_VERSION,
    MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS,
    createModelEligibilityDecision,
    createModelEligibilityRun,
} from './contracts.js';
export { evaluateModelGatewayEligibility } from './evaluator.js';
export { explainModelGatewayEligibilityDecision } from './explain.js';
export {
    MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET,
    getModelGatewayEligibilityPolicyPreset,
    listModelGatewayEligibilityPolicyPresets,
    resolveModelGatewayEligibilityPolicy,
} from './policy-presets.js';
export {
    applyModelGatewayEligibilityToSnapshot,
    evaluateModelGatewayCatalogEligibility,
    modelEligibilityDecisionKey,
} from './catalog-snapshot.js';
