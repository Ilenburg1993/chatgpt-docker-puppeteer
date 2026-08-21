// @ts-check
/** @module copilot/infra/concurrency/locks */

export {
    acquireFileResourceLock,
    acquireLock,
    getFileResourceLockDir,
    getFileResourceLockPath,
    getFileResourceLockProfile,
    getFileResourceLockStats,
    hashFileResourceLockKey,
    isFileResourceLockEnabledByEnv,
    releaseLock,
    releaseLockAsync,
    shouldAcquireFileResourceLock,
} from './file/index.js';
export {
    acquireIoResourceLock,
    acquireIoResourceLocks,
    getIoLockStats,
    normalizeIoResourceKey,
    withIoResourceLock,
    withIoResourceLocks,
} from './local/index.js';
