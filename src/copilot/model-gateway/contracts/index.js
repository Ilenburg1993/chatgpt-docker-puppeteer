// @ts-check
/**
 * Model-gateway contract barrel.
 *
 * @module copilot/model-gateway/contracts
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
} from './records.js';
