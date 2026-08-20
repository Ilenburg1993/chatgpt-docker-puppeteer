// @ts-check
/**
 * Lock assíncrono por recurso lógico para operações de I/O.
 *
 * Implementação deliberadamente simples: uma fila Promise por chave. Serve como fundação estável para serializar
 * mutações no mesmo path sem depender de APIs experimentais de Node.
 *
 * @module copilot/infra/io-locks
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { publishIoLifecycleEvent } from './io-observability.js';
import {
    acquireFileResourceLock,
    getFileResourceLockStats,
    hashFileResourceLockKey,
    shouldAcquireFileResourceLock,
} from './locks/file-resource-lock.js';
import { createBoundedLockWaitMetrics, sanitizeLockOperation } from './locks/lock-observability.js';
import { normalizePathResourceKey } from './policy/path-resource.js';
import { readEnvPositiveInt } from './shared/env.js';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/** @type {Map<string, Promise<void>>} */
const tails = new Map();
/** @type {AsyncLocalStorage<Set<string>>} */
const heldLocksStorage = new AsyncLocalStorage();
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
/**
 * @type {Map<
 *     string,
 *     {
 *         resourceHash: string;
 *         operation: string;
 *         acquiredAtMs: number;
 *         waitMs: number;
 *         l0WaitMs: number;
 *         fileLockEnabled: boolean;
 *     }
 * >}
 */
const activeLeases = new Map();
const warnedLeaseKeys = new Set();
const MAX_ACTIVE_LEASE_SAMPLE = 32;
const ACTIVE_LEASE_WARN_MS = readEnvPositiveInt('IO_LOCK_ACTIVE_LEASE_WARN_MS', 60_000);

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
 * @param {'LockTimeout' | 'Abort'} kind
 * @param {string} resourceKey
 * @returns {Error & { code?: string }}
 */
function createLockError(kind, resourceKey) {
    const error = /** @type {Error & { code?: string }} */ (
        new Error(
            kind === 'Abort'
                ? `Lock abortado antes de adquirir recurso: ${resourceKey}`
                : `Timeout ao aguardar lock do recurso: ${resourceKey}`,
        )
    );
    error.name = kind === 'Abort' ? 'AbortError' : 'TimeoutError';
    error.code = kind === 'Abort' ? 'ABORT_ERR' : 'ETIMEDOUT';
    return error;
}

/**
 * @param {unknown} error
 * @returns {Error}
 */
function asError(error) {
    return isError(error) ? /** @type {Error} */ (error) : new Error(String(error));
}

/**
 * @param {unknown} error
 * @returns {void}
 */
function recordLockFailure(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (code === 'ETIMEDOUT') {
        lockCounters.timeouts += 1;
    } else if (code === 'ABORT_ERR') {
        lockCounters.aborts += 1;
    } else {
        lockCounters.failures += 1;
    }
}

/**
 * Aguarda uma promise respeitando timeout/abort sem executar a operação protegida.
 *
 * @param {Promise<void>} previous
 * @param {string} key
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} options
 */
function waitForPrevious(previous, key, options) {
    if (options.signal?.aborted) {
        return Promise.reject(createLockError('Abort', key));
    }
    if (options.timeoutMs === undefined && !options.signal) {
        return previous.catch(() => undefined);
    }

    return new Promise((resolve, reject) => {
        /** @type {NodeJS.Timeout | null} */
        let timeout = null;
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(createLockError('Abort', key));
        };

        if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.timeoutMs !== undefined) {
            timeout = setTimeout(
                () => {
                    cleanup();
                    reject(createLockError('LockTimeout', key));
                },
                Math.max(0, options.timeoutMs),
            );
        }

        previous
            .catch(() => undefined)
            .then(
                () => {
                    cleanup();
                    resolve(undefined);
                },
                (error) => {
                    cleanup();
                    reject(asError(error));
                },
            );
    });
}

/**
 * @typedef {object} IoResourceLockLease
 * @property {string} key
 * @property {number} waitMs
 * @property {boolean} fileLockEnabled
 * @property {string | null} fileLockPath
 * @property {boolean} staleFileLockRecovered
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 * @property {() => Promise<void>} releaseAsync
 */

/**
 * @typedef {object} IoResourceLocksLease
 * @property {string[]} keys
 * @property {number} waitMs
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 * @property {() => Promise<void>} releaseAsync
 */

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
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<IoResourceLockLease>}
 */
export async function acquireIoResourceLock(resourceKey, options = {}) {
    const key = normalizeIoResourceKey(resourceKey);
    lockCounters.attempts += 1;
    const heldLocks = heldLocksStorage.getStore();
    if (heldLocks?.has(key)) {
        if (options.signal?.aborted) {
            const error = createLockError('Abort', key);
            recordLockFailure(error);
            throw error;
        }
        lockCounters.reentrant += 1;
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
        lockCounters.contended += 1;
        lockCounters.queuedWaiters += 1;
        lockCounters.queueDepthHighWater = Math.max(lockCounters.queueDepthHighWater, lockCounters.queuedWaiters);
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
        await waitForPrevious(previous, key, options);
        l0WaitMs = Date.now() - startedWait;
        lockWaitMetrics.record(l0WaitMs, options.operation);
    } catch (error) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        recordLockFailure(error);
        throw error;
    } finally {
        if (wasContended) lockCounters.queuedWaiters = Math.max(0, lockCounters.queuedWaiters - 1);
    }

    if (options.signal?.aborted) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        const error = createLockError('Abort', key);
        recordLockFailure(error);
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
            recordLockFailure(error);
            throw error;
        }
    }

    const nextHeldLocks = new Set(heldLocks ?? []);
    nextHeldLocks.add(key);
    const waitMs = Date.now() - startedWait;
    lockCounters.acquired += 1;
    activeLeases.set(key, {
        resourceHash: hashFileResourceLockKey(key),
        operation: sanitizeLockOperation(options.operation),
        acquiredAtMs: Date.now(),
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
                activeLeases.delete(key);
                warnedLeaseKeys.delete(key);
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
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
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
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
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
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
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
 * Snapshot leve para health/tests.
 *
 * @param {{ nowMs?: number }} [options]
 * @returns {{
 *     pendingResources: number;
 *     activeLeases: number;
 *     queuedWaiters: number;
 *     queueDepthHighWater: number;
 *     attempts: number;
 *     acquired: number;
 *     contended: number;
 *     reentrant: number;
 *     timeouts: number;
 *     aborts: number;
 *     failures: number;
 *     activeLeaseWarnMs: number;
 *     staleActiveLeases: number;
 *     oldestActiveLeaseAgeMs: number;
 *     wait: ReturnType<ReturnType<typeof createBoundedLockWaitMetrics>['snapshot']>;
 *     activeLeaseSample: {
 *         resourceHash: string;
 *         operation: string;
 *         ageMs: number;
 *         waitMs: number;
 *         l0WaitMs: number;
 *         fileLockEnabled: boolean;
 *     }[];
 *     fileLocks: ReturnType<typeof getFileResourceLockStats>;
 * }}
 */
export function getIoLockStats(options = {}) {
    const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const leasesByAge = [...activeLeases.entries()].sort(
        ([, left], [, right]) => left.acquiredAtMs - right.acquiredAtMs,
    );
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
        pendingResources: tails.size,
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
