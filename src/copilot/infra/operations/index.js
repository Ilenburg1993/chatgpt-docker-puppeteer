// @ts-check
/** @module copilot/infra/operations */

export {
    cleanupRollbackSidecars,
    getIoRollbackPolicy,
    isIoRollbackEnabled,
    listRollbackSidecars,
    shouldCaptureIoRollback,
} from '#copilot/infra/internal/filesystem/transaction';
export { buildIoMutationAuditRecord, getIoMutationAuditLogPath, recordIoMutationAudit } from './audit-log.js';
export { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';
export {
    buildIoRollbackPlan,
    createIoRollbackToken,
    executeIoRollbackToken,
    parseIoRollbackToken,
    serializeIoRollbackToken,
    verifyIoRollbackToken,
} from './rollback/index.js';
export {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    failIoChangeSet,
    rollbackIoChangeSet,
} from './transaction.js';
