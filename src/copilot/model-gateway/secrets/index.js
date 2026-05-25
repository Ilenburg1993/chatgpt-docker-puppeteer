// @ts-check
/**
 * Model-gateway secrets barrel.
 *
 * @module copilot/model-gateway/secrets
 */

export {
    DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS,
    EnvSecretRegistry,
    createEnvSecretRegistry,
} from './env-secret-registry.js';
export { redactSecretRecord, redactSecretText } from './redaction.js';
