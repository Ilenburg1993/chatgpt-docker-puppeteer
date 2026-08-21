// @ts-check
/** Metrics, active-lease registry and health projection for process-local resource locks. */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { getFileResourceLockStats } from '../file/index.js';
import { createBoundedLockWaitMetrics, sanitizeLockOperation } from '../metrics/index.js';

const lockWaitMetrics = createBoundedLockWaitMetrics();
const lockCounters = {
    attempts: 0,
    acquired: 0,
    contended: 0,
    reentrant: 0,
    timeouts: 0,
    aborts: 0,
    failures: 0,
    queuedWaiters: 0,
    queueDepthHighWater: 0,
};
/** @type {Map<string, {resourceHash:string; operation:string; acquiredAtMs:number; waitMs:number; l0WaitMs:number; fileLockEnabled:boolean}>} */
const activeLeases = new Map();
const warnedLeaseKeys = new Set();
const MAX_ACTIVE_LEASE_SAMPLE = 32;
const ACTIVE_LEASE_WARN_MS = readEnvPositiveInt('IO_LOCK_ACTIVE_LEASE_WARN_MS', 60_000);

export function recordIoLockAttempt() {
    lockCounters.attempts += 1;
}
export function recordIoLockReentrant() {
    lockCounters.reentrant += 1;
}
export function beginIoLockContention() {
    lockCounters.contended += 1;
    lockCounters.queuedWaiters += 1;
    lockCounters.queueDepthHighWater = Math.max(lockCounters.queueDepthHighWater, lockCounters.queuedWaiters);
}
export function endIoLockContention() {
    lockCounters.queuedWaiters = Math.max(0, lockCounters.queuedWaiters - 1);
}
/** @param {number} waitMs @param {string|undefined} operation */
export function recordIoLockWait(waitMs, operation) {
    lockWaitMetrics.record(waitMs, operation);
}
/** @param {unknown} error */
export function recordIoLockFailure(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (code === 'ETIMEDOUT') lockCounters.timeouts += 1;
    else if (code === 'ABORT_ERR') lockCounters.aborts += 1;
    else lockCounters.failures += 1;
}
/**
 * @param {string} key
 * @param {{ resourceHash:string; operation?:string; waitMs:number; l0WaitMs:number; fileLockEnabled:boolean }} lease
 */
export function recordIoLockAcquired(key, lease) {
    lockCounters.acquired += 1;
    activeLeases.set(key, {
        resourceHash: lease.resourceHash,
        operation: sanitizeLockOperation(lease.operation),
        acquiredAtMs: Date.now(),
        waitMs: lease.waitMs,
        l0WaitMs: lease.l0WaitMs,
        fileLockEnabled: lease.fileLockEnabled,
    });
}
/** @param {string} key */
export function forgetIoLockLease(key) {
    activeLeases.delete(key);
    warnedLeaseKeys.delete(key);
}

/** @param {number} pendingResources @param {{nowMs?:number}} [options] */
export function getIoLockStatsSnapshot(pendingResources, options = {}) {
    const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const leasesByAge = [...activeLeases.entries()].sort(([, a], [, b]) => a.acquiredAtMs - b.acquiredAtMs);
    const staleLeases = leasesByAge.filter(([, lease]) => now - lease.acquiredAtMs >= ACTIVE_LEASE_WARN_MS);
    for (const [key, lease] of staleLeases) {
        if (warnedLeaseKeys.has(key)) continue;
        warnedLeaseKeys.add(key);
        publishIoLifecycleEvent('lock', 'lease.stale', {
            resourceHash: lease.resourceHash,
            operation: lease.operation,
            ageMs: Math.max(0, now - lease.acquiredAtMs),
            thresholdMs: ACTIVE_LEASE_WARN_MS,
            fileLockEnabled: lease.fileLockEnabled,
        });
    }
    return {
        pendingResources,
        activeLeases: activeLeases.size,
        queuedWaiters: lockCounters.queuedWaiters,
        queueDepthHighWater: lockCounters.queueDepthHighWater,
        attempts: lockCounters.attempts,
        acquired: lockCounters.acquired,
        contended: lockCounters.contended,
        reentrant: lockCounters.reentrant,
        timeouts: lockCounters.timeouts,
        aborts: lockCounters.aborts,
        failures: lockCounters.failures,
        activeLeaseWarnMs: ACTIVE_LEASE_WARN_MS,
        staleActiveLeases: staleLeases.length,
        oldestActiveLeaseAgeMs:
            leasesByAge.length > 0 ? Math.max(0, now - Number(leasesByAge[0]?.[1].acquiredAtMs ?? now)) : 0,
        wait: lockWaitMetrics.snapshot(),
        activeLeaseSample: leasesByAge
            .map(([, lease]) => lease)
            .slice(0, MAX_ACTIVE_LEASE_SAMPLE)
            .map((lease) => ({
                resourceHash: lease.resourceHash,
                operation: lease.operation,
                ageMs: Math.max(0, now - lease.acquiredAtMs),
                waitMs: lease.waitMs,
                l0WaitMs: lease.l0WaitMs,
                fileLockEnabled: lease.fileLockEnabled,
            })),
        fileLocks: getFileResourceLockStats(),
    };
}
