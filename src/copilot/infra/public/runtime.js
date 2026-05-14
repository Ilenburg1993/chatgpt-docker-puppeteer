// @ts-check
/**
 * Facade pública de runtime agentic de I/O.
 *
 * @module copilot/infra/public/runtime
 */

export {
    buildIoMutationAuditRecord,
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
    failIoOperationEnvelope,
    getIoMutationAuditLogPath,
    recordIoMutationAudit,
} from '../runtime/index.js';
