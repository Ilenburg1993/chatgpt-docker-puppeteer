// @ts-check
/** @module copilot/infra/filesystem/transaction/rollback */

/** @typedef {import('./types.js').IoRollbackSidecar} IoRollbackSidecar */

export { listRollbackSidecars } from './inventory.js';
export { cleanupExpiredRollbackSidecars, cleanupRollbackSidecars } from './maintenance.js';
export {
    getIoRollbackPolicy,
    getRollbackSidecarDirectory,
    getRollbackSidecarMaxBytes,
    getRollbackSidecarMaxEntries,
    getRollbackSidecarTtlMs,
    isIoRollbackEnabled,
    shouldCaptureIoRollback,
} from './policy.js';
export { createRollbackSidecarWriter, persistRollbackSidecar, readVerifiedRollbackSidecar } from './storage.js';
