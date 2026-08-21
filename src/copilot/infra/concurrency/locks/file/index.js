// @ts-check
/** @module copilot/infra/concurrency/locks/file */

export {
    getFileResourceLockConfigurationError,
    getFileResourceLockDir,
    getFileResourceLockPath,
    getFileResourceLockProfile,
    hashFileResourceLockKey,
    isFileResourceLockEnabled,
    readFileResourceLockPolicy,
    shouldAcquireFileResourceLock,
} from './policy.js';
export { acquireFileResourceLock } from './resource-lock.js';
export { getFileResourceLockStats } from './state.js';
