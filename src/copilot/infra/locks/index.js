// @ts-check
/**
 * Barrel interno do domínio locks.
 *
 * @module copilot/infra/locks
 */

export { getIoLockStats, normalizeIoResourceKey, withIoResourceLock, withIoResourceLocks } from './async-resource-lock.js';
export { acquireLock, releaseLock } from './file-lock.js';
