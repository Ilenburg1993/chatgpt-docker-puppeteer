// @ts-check
/**
 * Barrel interno do domínio runtime de operações.
 *
 * @module copilot/infra/runtime
 */

export { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';
export { buildIoMutationAuditRecord, getIoMutationAuditLogPath, recordIoMutationAudit } from './audit-log.js';
