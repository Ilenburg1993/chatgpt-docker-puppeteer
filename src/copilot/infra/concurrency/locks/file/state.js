// @ts-check
/** Metrics and active-lease projection for multiprocess resource locks. */

import { createHash } from 'node:crypto';
import { createBoundedLockWaitMetrics, sanitizeLockOperation } from '../metrics/index.js';
import { getFileResourceLockDir, getFileResourceLockProfile } from './policy.js';

/** @typedef {import('./types.js').FileResourceLockMetadata} FileResourceLockMetadata */
/** @typedef {import('./types.js').FileResourceLockProfile} FileResourceLockProfile */

/** @type {Map<string, {resourceHash:string; operation:string; acquiredAtMs:number; waitMs:number; staleRecovered:boolean}>} */
const activeFileLocks = new Map();
const fileLockWaitMetrics = createBoundedLockWaitMetrics();
const fileLockCounters = {
    attempts: 0,
    acquired: 0,
    contended: 0,
    timeouts: 0,
    aborts: 0,
    failures: 0,
    queuedWaiters: 0,
    queueDepthHighWater: 0,
};
const MAX_ACTIVE_LEASE_SAMPLE = 32;
let staleRecoveries = 0;
let heartbeatFailures = 0;

export function recordFileLockAttempt() {
    fileLockCounters.attempts += 1;
}
export function beginFileLockContention() {
    fileLockCounters.contended += 1;
    fileLockCounters.queuedWaiters += 1;
    fileLockCounters.queueDepthHighWater = Math.max(
        fileLockCounters.queueDepthHighWater,
        fileLockCounters.queuedWaiters,
    );
}
export function endFileLockContention() {
    fileLockCounters.queuedWaiters = Math.max(0, fileLockCounters.queuedWaiters - 1);
}
/** @param {string} lockPath @param {FileResourceLockMetadata} metadata @param {number} waitMs @param {boolean} staleRecovered @param {string|undefined} operation */
export function recordFileLockAcquired(lockPath, metadata, waitMs, staleRecovered, operation) {
    fileLockCounters.acquired += 1;
    fileLockWaitMetrics.record(waitMs, operation);
    activeFileLocks.set(lockPath, {
        resourceHash: metadata.resourceHash,
        operation: sanitizeLockOperation(operation),
        acquiredAtMs: Date.now(),
        waitMs,
        staleRecovered,
    });
}
/** @param {string} lockPath */
export function forgetActiveFileLock(lockPath) {
    activeFileLocks.delete(lockPath);
}
/** @param {string|null} code */
export function recordFileLockFailure(code) {
    if (code === 'ETIMEDOUT') fileLockCounters.timeouts += 1;
    else if (code === 'ABORT_ERR') fileLockCounters.aborts += 1;
    else fileLockCounters.failures += 1;
}
export function recordFileLockStaleRecovery() {
    staleRecoveries += 1;
}
export function recordFileLockHeartbeatFailure() {
    heartbeatFailures += 1;
}

export function getFileResourceLockStats() {
    const now = Date.now();
    /** @type {FileResourceLockProfile} */ let profile = 'off';
    let configurationValid = true;
    try {
        profile = getFileResourceLockProfile();
    } catch {
        configurationValid = false;
    }
    return {
        processDefaultEnabled: configurationValid && profile !== 'off',
        profile,
        configurationValid,
        activeLeases: activeFileLocks.size,
        queuedWaiters: fileLockCounters.queuedWaiters,
        queueDepthHighWater: fileLockCounters.queueDepthHighWater,
        lockDirHash: createHash('sha256').update(getFileResourceLockDir()).digest('hex'),
        attempts: fileLockCounters.attempts,
        acquired: fileLockCounters.acquired,
        contended: fileLockCounters.contended,
        timeouts: fileLockCounters.timeouts,
        aborts: fileLockCounters.aborts,
        failures: fileLockCounters.failures,
        staleRecoveries,
        heartbeatFailures,
        wait: fileLockWaitMetrics.snapshot(),
        activeLeaseSample: [...activeFileLocks.values()]
            .sort((a, b) => a.acquiredAtMs - b.acquiredAtMs)
            .slice(0, MAX_ACTIVE_LEASE_SAMPLE)
            .map((lease) => ({
                resourceHash: lease.resourceHash,
                operation: lease.operation,
                ageMs: Math.max(0, now - lease.acquiredAtMs),
                waitMs: lease.waitMs,
                staleRecovered: lease.staleRecovered,
            })),
    };
}
