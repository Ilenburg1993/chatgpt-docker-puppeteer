// @ts-check
/**
 * Model-gateway redaction barrel.
 *
 * The implementation lives in Infra observability so SDK, terminal and model-gateway share one bounded policy without
 * importing each other.
 *
 * @module copilot/model-gateway/secrets/redaction
 */

export { redactSecretRecord, redactSecretText } from '#copilot/infra/public/observability/redaction';
