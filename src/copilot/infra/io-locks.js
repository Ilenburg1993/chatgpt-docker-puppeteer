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
import { normalizePathResourceKey } from './policy/path-resource.js';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

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
            timeout.unref?.();
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
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 */

/**
 * @typedef {object} IoResourceLocksLease
 * @property {string[]} keys
 * @property {number} waitMs
 * @property {<T>(operation: () => Promise<T>) => Promise<T>} run
 * @property {() => void} release
 */

/**
 * Adquire lock exclusivo por recurso e retorna lease explicitamente liberável.
 *
 * Compatível com `await using` via `Symbol.asyncDispose`.
 *
 * @param {string} resourceKey
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
 * @returns {Promise<IoResourceLockLease>}
 */
export async function acquireIoResourceLock(resourceKey, options = {}) {
    const key = normalizeIoResourceKey(resourceKey);
    const heldLocks = heldLocksStorage.getStore();
    if (heldLocks?.has(key)) {
        if (options.signal?.aborted) {
            throw createLockError('Abort', key);
        }
        return /** @type {IoResourceLockLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
            key,
            waitMs: 0,
            run: (operation) => operation(),
            release: () => {},
            [Symbol.asyncDispose]: async () => {},
        });
    }

    const startedWait = Date.now();
    const previous = tails.get(key) ?? Promise.resolve();
    const { promise: current, resolve: releaseCurrent } = Promise.withResolvers();
    const tail = previous
        .catch(() => undefined)
        .then(() => current)
        .catch(() => undefined);
    tails.set(key, tail);
    scheduleTailCleanup(key);

    try {
        await waitForPrevious(previous, key, options);
    } catch (error) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        throw error;
    }

    if (options.signal?.aborted) {
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        throw createLockError('Abort', key);
    }

    const nextHeldLocks = new Set(heldLocks ?? []);
    nextHeldLocks.add(key);

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        releaseCurrent(undefined);
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
    };

    return /** @type {IoResourceLockLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
        key,
        waitMs: Date.now() - startedWait,
        run: (operation) => heldLocksStorage.run(nextHeldLocks, () => operation()),
        release,
        [Symbol.asyncDispose]: async () => {
            release();
        },
    });
}

/**
 * Adquire locks exclusivos para múltiplos recursos em ordem estável e retorna lease liberável.
 *
 * Compatível com `await using` via `Symbol.asyncDispose`.
 *
 * @param {string[]} resourceKeys
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
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
            lease.release();
        }
        throw error;
    }

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        for (const lease of [...leases].reverse()) {
            lease.release();
        }
    };

    return /** @type {IoResourceLocksLease & { [Symbol.asyncDispose]: () => Promise<void> }} */ ({
        keys,
        waitMs: totalWaitMs,
        run: (operation) => heldLocksStorage.run(new Set([...(heldLocks ?? []), ...keys]), () => operation()),
        release,
        [Symbol.asyncDispose]: async () => {
            release();
        },
    });
}

/**
 * Executa uma operação em lock exclusivo por recurso.
 *
 * @template T
 * @param {string} resourceKey
 * @param {() => Promise<T>} operation
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
 * @returns {Promise<{ value: T; waitMs: number }>}
 */
export async function withIoResourceLock(resourceKey, operation, options = {}) {
    const lease = await acquireIoResourceLock(resourceKey, options);
    try {
        const value = await lease.run(operation);
        return { value, waitMs: lease.waitMs };
    } finally {
        lease.release();
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
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
 * @returns {Promise<{ value: T; waitMs: number }>}
 */
export async function withIoResourceLocks(resourceKeys, operation, options = {}) {
    const lease = await acquireIoResourceLocks(resourceKeys, options);
    try {
        const value = await lease.run(operation);
        return { value, waitMs: lease.waitMs };
    } finally {
        lease.release();
    }
}

/**
 * Snapshot leve para health/tests.
 *
 * @returns {{ pendingResources: number; resources: string[] }}
 */
export function getIoLockStats() {
    return { pendingResources: tails.size, resources: [...tails.keys()] };
}
