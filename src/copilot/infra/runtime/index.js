// @ts-check
/**
 * Barrel interno do domínio runtime de operações.
 *
 * @module copilot/infra/runtime
 */

export { buildIoMutationAuditRecord, getIoMutationAuditLogPath, recordIoMutationAudit } from './audit-log.js';
export { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';
export {
    buildIoRollbackPlan,
    createIoRollbackToken,
    parseIoRollbackToken,
    serializeIoRollbackToken,
    verifyIoRollbackToken,
} from './rollback.js';
export {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    failIoChangeSet,
    rollbackIoChangeSet,
} from './transaction.js';
