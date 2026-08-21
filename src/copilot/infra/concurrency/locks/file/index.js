// @ts-check
/** @module copilot/infra/concurrency/locks/file */

export { acquireLock, releaseLock, releaseLockAsync } from './legacy.js';
export {
    getFileResourceLockDir,
    getFileResourceLockPath,
    getFileResourceLockProfile,
    hashFileResourceLockKey,
    isFileResourceLockEnabledByEnv,
    shouldAcquireFileResourceLock,
} from './policy.js';
export { acquireFileResourceLock } from './resource-lock.js';
export { getFileResourceLockStats } from './state.js';
