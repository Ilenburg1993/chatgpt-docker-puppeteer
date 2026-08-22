// @ts-check
/** @module copilot/infra/operations */

export { buildIoMutationAuditRecord, createIoMutationAuditRuntime } from './audit-log.js';
export { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';
export {
    buildIoRollbackPlan,
    createIoRollbackCapabilityRuntime,
    decodeIoRollbackToken,
    serializeIoRollbackToken,
} from './rollback/index.js';
export {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    failIoChangeSet,
    rollbackIoChangeSet,
} from './transaction.js';
