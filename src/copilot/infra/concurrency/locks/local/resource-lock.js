// @ts-check
/** Process-local resource lock queue with optional multiprocess lock composition. */

import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import { AsyncLocalStorage } from 'node:async_hooks';
import { acquireFileResourceLock, hashFileResourceLockKey, shouldAcquireFileResourceLock } from '../file/index.js';
import {
    beginIoLockContention,
    endIoLockContention,
    forgetIoLockLease,
    getIoLockStatsSnapshot,
    recordIoLockAcquired,
    recordIoLockAttempt,
    recordIoLockFailure,
    recordIoLockReentrant,
    recordIoLockWait,
} from './observability.js';
import { createResourceLockError, waitForPreviousResourceLock } from './wait.js';

/** @typedef {import('./types.js').IoResourceLockLease} IoResourceLockLease */
/** @typedef {import('./types.js').IoResourceLocksLease} IoResourceLocksLease */

/** @type {Map<string, Promise<void>>} */
const tails = new Map();
/** @type {AsyncLocalStorage<Set<string>>} */
const heldLocksStorage = new AsyncLocalStorage();

/**
 * @param {string} key
 * @returns {void}
 */
function scheduleTailCleanup(key) {
    const tail = tails.get(key);
    if (!tail) return;
    void tail.finally(() => {
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
    });
}

/**
 * Normaliza chaves de recursos de filesystem para reduzir bypass por path relativo/absoluto.
 *
 * @param {string} resourceKey
 * @returns {string}
 */
export function normalizeIoResourceKey(resourceKey) {
    return normalizePathResourceKey(resourceKey);
}

/**
 * Adquire lock exclusivo por recurso e retorna lease explicitamente liberável.
 *
 * Compatível com `await using` via `Symbol.asyncDispose`.
 *
 * @param {string} resourceKey
 * @param {{
 *     timeoutMs?: number;
 *     signal?: AbortSignal;
 *     fileLock?: boolean;
 *     fileLockDir?: string;
 *     fileLockStaleMs?: number;
 *     operation?: string;
 *     target?: string;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<IoResourceLockLease>}
 */
export async function acquireIoResourceLock(resourceKey, options = {}) {
    const key = normalizeIoResourceKey(resourceKey);
    recordIoLockAttempt();
    const heldLocks = heldLocksStorage.getStore();
    if (heldLocks?.has(key)) {
        if (options.signal?.aborted) {
            const error = createResourceLockError('Abort', key);
            recordIoLockFailure(error);
            throw error;
        }
        recordIoLockReentrant();
        return /** @type {IoResourceLockLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
            key,
            waitMs: 0,
            fileLockEnabled: false,
            fileLockPath: null,
            staleFileLockRecovered: false,
            run: (operation) => operation(),
            release: () => {},
            releaseAsync: async () => {},
            [Symbol.asyncDispose]: async () => {},
        });
    }

    const startedWait = Date.now();
    const wasContended = tails.has(key);
    if (wasContended) {
        beginIoLockContention();
    }
    const previous = tails.get(key) ?? Promise.resolve();
    const { promise: current, resolve: releaseCurrent } = Promise.withResolvers();
    const tail = previous
        .catch(() => undefined)
        .then(() => current)
        .catch(() => undefined);
    tails.set(key, tail);
    scheduleTailCleanup(key);

    /** @type {number} */
    let l0WaitMs;
    try {
        await waitForPreviousResourceLock(previous, key, options);
        l0WaitMs = Date.now() - startedWait;
        recordIoLockWait(l0WaitMs, options.operation);
    } catch (error) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        recordIoLockFailure(error);
        throw error;
    } finally {
        if (wasContended) endIoLockContention();
    }

    if (options.signal?.aborted) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        const error = createResourceLockError('Abort', key);
        recordIoLockFailure(error);
        throw error;
    }

    /** @type {Awaited<ReturnType<typeof acquireFileResourceLock>> | null} */
    let fileLockLease = null;
    const shouldAcquireFileLock = shouldAcquireFileResourceLock({
        ...(options.fileLock === undefined ? {} : { explicit: options.fileLock }),
        ...(options.riskClass === undefined ? {} : { riskClass: options.riskClass }),
    });
    if (shouldAcquireFileLock) {
        try {
            fileLockLease = await acquireFileResourceLock(key, {
                ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
                ...(options.fileLockDir === undefined ? {} : { lockDir: options.fileLockDir }),
                ...(options.fileLockStaleMs === undefined ? {} : { staleMs: options.fileLockStaleMs }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
                ...(options.operation === undefined ? {} : { operation: options.operation }),
                target: options.target ?? key,
            });
        } catch (error) {
            releaseCurrent(undefined);
            if (tails.get(key) === tail) {
                tails.delete(key);
            }
            recordIoLockFailure(error);
            throw error;
        }
    }

    const nextHeldLocks = new Set(heldLocks ?? []);
    nextHeldLocks.add(key);
    const waitMs = Date.now() - startedWait;
    recordIoLockAcquired(key, {
        resourceHash: hashFileResourceLockKey(key),
        ...(options.operation === undefined ? {} : { operation: options.operation }),
        waitMs,
        l0WaitMs,
        fileLockEnabled: Boolean(fileLockLease),
    });

    let releasePromise = /** @type {Promise<void> | null} */ (null);
    const releaseAsync = () => {
        if (releasePromise) return releasePromise;
        const fileLock = fileLockLease;
        fileLockLease = null;
        releasePromise = (async () => {
            try {
                if (fileLock) await fileLock.release();
            } finally {
                forgetIoLockLease(key);
                releaseCurrent(undefined);
                if (tails.get(key) === tail) {
                    tails.delete(key);
                }
            }
        })();
        return releasePromise;
    };
    const release = () => {
        void releaseAsync().catch(() => undefined);
    };

    return /** @type {IoResourceLockLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
        key,
        waitMs,
        fileLockEnabled: Boolean(fileLockLease),
        fileLockPath: fileLockLease?.lockPath ?? null,
        staleFileLockRecovered: Boolean(fileLockLease?.staleRecovered),
        run: (operation) => heldLocksStorage.run(nextHeldLocks, () => operation()),
        release,
        releaseAsync,
        [Symbol.asyncDispose]: releaseAsync,
    });
}

/**
 * Adquire locks exclusivos para múltiplos recursos em ordem estável e retorna lease liberável.
 *
 * Compatível com `await using` via `Symbol.asyncDispose`.
 *
 * @param {string[]} resourceKeys
 * @param {{
 *     timeoutMs?: number;
 *     signal?: AbortSignal;
 *     fileLock?: boolean;
 *     fileLockDir?: string;
 *     fileLockStaleMs?: number;
 *     operation?: string;
 *     target?: string;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<IoResourceLocksLease>}
 */
export async function acquireIoResourceLocks(resourceKeys, options = {}) {
    const keys = [...new Set(resourceKeys.map((key) => normalizeIoResourceKey(key)))].sort((a, b) =>
        a.localeCompare(b),
    );
    const heldLocks = heldLocksStorage.getStore();
    if (keys.length === 0) {
        return /** @type {IoResourceLocksLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
            keys: [],
            waitMs: 0,
            run: (operation) => operation(),
            release: () => {},
            releaseAsync: async () => {},
            [Symbol.asyncDispose]: async () => {},
        });
    }

    /** @type {IoResourceLockLease[]} */
    const leases = [];
    let totalWaitMs = 0;

    try {
        for (const key of keys) {
            const lease = await acquireIoResourceLock(key, options);
            leases.push(lease);
            totalWaitMs += lease.waitMs;
        }
    } catch (error) {
        for (const lease of leases.reverse()) {
            await lease.releaseAsync();
        }
        throw error;
    }

    let releasePromise = /** @type {Promise<void> | null} */ (null);
    const releaseAsync = () => {
        if (releasePromise) return releasePromise;
        releasePromise = (async () => {
            for (const lease of [...leases].reverse()) {
                await lease.releaseAsync();
            }
        })();
        return releasePromise;
    };
    const release = () => {
        void releaseAsync().catch(() => undefined);
    };

    return /** @type {IoResourceLocksLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
        keys,
        waitMs: totalWaitMs,
        run: (operation) => heldLocksStorage.run(new Set([...(heldLocks ?? []), ...keys]), () => operation()),
        release,
        releaseAsync,
        [Symbol.asyncDispose]: releaseAsync,
    });
}

/**
 * Executa uma operação em lock exclusivo por recurso.
 *
 * @template T
 * @param {string} resourceKey
 * @param {() => Promise<T>} operation
 * @param {{
 *     timeoutMs?: number;
 *     signal?: AbortSignal;
 *     fileLock?: boolean;
 *     fileLockDir?: string;
 *     fileLockStaleMs?: number;
 *     operation?: string;
 *     target?: string;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<{ value: T; waitMs: number }>}
 */
export async function withIoResourceLock(resourceKey, operation, options = {}) {
    const lease = await acquireIoResourceLock(resourceKey, options);
    try {
        const value = await lease.run(operation);
        return { value, waitMs: lease.waitMs };
    } finally {
        await lease.releaseAsync();
    }
}

/**
 * Executa uma operação segurando locks exclusivos para múltiplos recursos em ordem estável.
 *
 * A ordem lexicográfica evita deadlocks quando duas operações concorrentes precisam dos mesmos recursos em ordem
 * invertida, por exemplo `move(a,b)` versus `move(b,a)`.
 *
 * @template T
 * @param {string[]} resourceKeys
 * @param {() => Promise<T>} operation
 * @param {{
 *     timeoutMs?: number;
 *     signal?: AbortSignal;
 *     fileLock?: boolean;
 *     fileLockDir?: string;
 *     fileLockStaleMs?: number;
 *     operation?: string;
 *     target?: string;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<{ value: T; waitMs: number }>}
 */
export async function withIoResourceLocks(resourceKeys, operation, options = {}) {
    const lease = await acquireIoResourceLocks(resourceKeys, options);
    try {
        const value = await lease.run(operation);
        return { value, waitMs: lease.waitMs };
    } finally {
        await lease.releaseAsync();
    }
}

/**
 * Snapshot leve para health/tests. `emitStaleEvents:false` makes the projection observational only.
 * @param {{nowMs?:number;emitStaleEvents?:boolean}} [options]
 */
export function getIoLockStats(options = {}) {
    return getIoLockStatsSnapshot(tails.size, options);
}
