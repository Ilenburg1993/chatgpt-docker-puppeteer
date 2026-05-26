// @ts-check
/**
 * Model-gateway secrets barrel.
 *
 * @module copilot/model-gateway/secrets
 */

export {
    DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS,
    EnvSecretRegistry,
    MODEL_GATEWAY_SECRET_SCOPE_PRECEDENCE,
    buildScopedSecretEnvKey,
    createEnvSecretRegistry,
} from './env-secret-registry.js';
export {
    MODEL_GATEWAY_PROVIDER_ENV_REQUIREMENTS,
    evaluateModelGatewayProviderEnvRequirements,
    summarizeModelGatewayProviderEnvRequirements,
} from './requirements.js';
export { redactSecretRecord, redactSecretText } from './redaction.js';
