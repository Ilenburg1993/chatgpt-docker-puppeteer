// @ts-check
/**
 * Model-gateway secrets barrel.
 *
 * @module copilot/model-gateway/secrets
 */

export { diagnoseModelGatewayProviderSecretRefs } from './diagnostics.js';
export {
    DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS,
    EnvSecretRegistry,
    MODEL_GATEWAY_SECRET_SCOPE_PRECEDENCE,
    buildScopedSecretEnvKey,
    createEnvSecretRegistry,
} from './env-secret-registry.js';
export {
    auditModelGatewayValueRedaction,
    collectModelGatewaySecretAuditEnvValues,
    redactModelGatewayAuditedValue,
    summarizeModelGatewayRedactionAudits,
} from './redaction-audit.js';
export { redactSecretRecord, redactSecretText } from './redaction.js';
export {
    MODEL_GATEWAY_GENERIC_BYOK_SECRET_REFS,
    MODEL_GATEWAY_PROVIDER_ENV_REQUIREMENTS,
    evaluateModelGatewayProviderEnvRequirements,
    resolveModelGatewayProviderSecretRefs,
    summarizeModelGatewayProviderEnvRequirements,
} from './requirements.js';
