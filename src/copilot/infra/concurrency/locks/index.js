// @ts-check
/** @module copilot/infra/concurrency/locks */

export {
    acquireFileResourceLock,
    getFileResourceLockConfigurationError,
    getFileResourceLockDir,
    getFileResourceLockPath,
    getFileResourceLockProfile,
    getFileResourceLockStats,
    hashFileResourceLockKey,
    isFileResourceLockEnabled,
    readFileResourceLockPolicy,
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
