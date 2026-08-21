// @ts-check
/**
 * Lightweight resource locking for configured control-plane filesystem IO.
 *
 * The general IO lock service also owns telemetry, health projections and workspace-facing diagnostics. Configured
 * control-plane state needs the same exclusion semantics without paying that observability graph during cold ESM load.
 * This module therefore keeps a minimal process-local queue and lazily composes the canonical multiprocess file lock
 * only when the process-wide file-lock policy requires it.
 *
 * @module copilot/infra/concurrency/locks/configured/service
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

/** @type {Map<string, Promise<void>>} */
const tails = new Map();
/** @type {AsyncLocalStorage<ReadonlySet<string>>} */
const heldStorage = new AsyncLocalStorage();

/** @param {string} resourceKey */
function normalizeConfiguredLockKey(resourceKey) {
    return path.resolve(String(resourceKey));
}

/** @param {string} key */
async function acquireLocalLock(key) {
    const previous = tails.get(key) ?? Promise.resolve();
    const { promise: current, resolve: releaseCurrent } = Promise.withResolvers();
    const tail = previous
        .catch(() => undefined)
        .then(() => current)
        .catch(() => undefined);
    tails.set(key, tail);
    void tail.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
    await previous.catch(() => undefined);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        releaseCurrent(undefined);
        if (tails.get(key) === tail) tails.delete(key);
    };
}

/**
 * Acquire the canonical multiprocess file lock only when current process policy requires it. Both modules are dynamic
 * so a process with file locks disabled (the normal development profile today) does not load file-lock metadata,
 * heartbeat or metrics code merely by importing ConfiguredFsIo.
 *
 * @param {string[]} keys
 * @param {{ operation?: string; riskClass?: 'low'|'medium'|'high'|'critical' }} options
 */
async function acquireConfiguredFileLocks(keys, options) {
    const fileLocks = await import('../file/index.js');
    if (!fileLocks.shouldAcquireFileResourceLock({ riskClass: options.riskClass ?? 'medium' })) return [];
    const leases = [];
    try {
        for (const key of keys) {
            leases.push(
                await fileLocks.acquireFileResourceLock(key, {
                    operation: options.operation ?? 'configured-fs',
                    target: key,
                }),
            );
        }
        return leases;
    } catch (error) {
        for (const lease of leases.reverse()) await lease.release().catch(() => undefined);
        throw error;
    }
}

/**
 * Execute one configured mutation under stable-order local locks and, when enabled, canonical multiprocess file locks.
 * Reentrant keys already held by the same async context are not reacquired.
 *
 * @template T
 * @param {readonly string[]} resourceKeys
 * @param {() => Promise<T>} operation
 * @param {{ operation?: string; riskClass?: 'low'|'medium'|'high'|'critical' }} [options]
 * @returns {Promise<T>}
 */
export async function withConfiguredResourceLocks(resourceKeys, operation, options = {}) {
    const keys = [...new Set(resourceKeys.map(normalizeConfiguredLockKey))].sort((left, right) =>
        left.localeCompare(right),
    );
    const inherited = heldStorage.getStore() ?? new Set();
    const missing = keys.filter((key) => !inherited.has(key));
    if (missing.length === 0) return operation();

    /** @type {Array<() => void>} */
    const localReleases = [];
    /** @type {Awaited<ReturnType<typeof acquireConfiguredFileLocks>>} */
    let fileLeases = [];
    try {
        for (const key of missing) localReleases.push(await acquireLocalLock(key));
        fileLeases = await acquireConfiguredFileLocks(missing, options);
        const held = new Set([...inherited, ...missing]);
        return await heldStorage.run(held, operation);
    } finally {
        for (const lease of [...fileLeases].reverse()) await lease.release().catch(() => undefined);
        for (const release of localReleases.reverse()) release();
    }
}

/** @internal Lightweight state projection for focused tests/diagnostics. */
export function getConfiguredResourceLockState() {
    return Object.freeze({ pendingResources: tails.size });
}
