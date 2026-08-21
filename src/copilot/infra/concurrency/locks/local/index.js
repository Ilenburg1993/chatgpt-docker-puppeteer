// @ts-check
/** @module copilot/infra/concurrency/locks/local */

export {
    acquireIoResourceLock,
    acquireIoResourceLocks,
    getIoLockStats,
    normalizeIoResourceKey,
    withIoResourceLock,
    withIoResourceLocks,
} from './resource-lock.js';
