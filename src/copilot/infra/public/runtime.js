// @ts-check
/**
 * Facade pública de runtime agentic de I/O.
 *
 * @module copilot/infra/public/runtime
 */

export {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    buildIoMutationAuditRecord,
    buildIoRollbackPlan,
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
    createIoRollbackToken,
    failIoChangeSet,
    failIoOperationEnvelope,
    getIoMutationAuditLogPath,
    parseIoRollbackToken,
    recordIoMutationAudit,
    rollbackIoChangeSet,
    serializeIoRollbackToken,
    verifyIoRollbackToken
} from '../runtime/index.js';
