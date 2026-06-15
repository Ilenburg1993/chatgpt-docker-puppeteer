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
    executeIoRollbackToken,
    failIoChangeSet,
    failIoOperationEnvelope,
    getIoMutationAuditLogPath,
    parseIoRollbackToken,
    recordIoMutationAudit,
    rollbackIoChangeSet,
    serializeIoRollbackToken,
    verifyIoRollbackToken,
} from '../runtime/index.js';
export { listRollbackSidecars } from '../io/fs/rollback-sidecar.js';
