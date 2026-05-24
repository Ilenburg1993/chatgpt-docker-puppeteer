// @ts-check
/**
 * Model-gateway redaction barrel.
 *
 * The implementation lives in core/security so SDK boundary, terminal UX and model-gateway all share one policy without
 * importing each other.
 *
 * @module copilot/model-gateway/secrets/redaction
 */

export { redactSecretRecord, redactSecretText } from '../../core/security/redaction.js';
