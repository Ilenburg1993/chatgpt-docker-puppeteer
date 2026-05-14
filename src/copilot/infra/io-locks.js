// @ts-check
/**
 * Lock assíncrono por recurso lógico para operações de I/O.
 *
 * Implementação deliberadamente simples: uma fila Promise por chave. Serve como fundação estável para serializar
 * mutações no mesmo path sem depender de APIs experimentais de Node.
 *
 * @module copilot/infra/io-locks
 */

import { normalizePathResourceKey } from './policy/path-resource.js';

/** @type {Map<string, Promise<void>>} */
const tails = new Map();

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
    return error instanceof Error ? error : new Error(String(error));
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
 * Executa uma operação em lock exclusivo por recurso.
 *
 * @template T
 * @param {string} resourceKey
 * @param {() => Promise<T>} operation
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
 * @returns {Promise<{ value: T; waitMs: number }>}
 */
export async function withIoResourceLock(resourceKey, operation, options = {}) {
    const key = normalizeIoResourceKey(resourceKey);
    const startedWait = Date.now();
    const previous = tails.get(key) ?? Promise.resolve();
    /** @type {() => void} */
    let release = () => {};
    const current = new Promise((resolve) => {
        release = () => resolve(undefined);
    });
    const tail = previous
        .catch(() => undefined)
        .then(() => current)
        .catch(() => undefined);
    tails.set(key, tail);

    try {
        await waitForPrevious(previous, key, options);
    } catch (error) {
        release();
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
        throw error;
    }
    const waitMs = Date.now() - startedWait;
    try {
        if (options.signal?.aborted) {
            throw createLockError('Abort', key);
        }
        const value = await operation();
        return { value, waitMs };
    } finally {
        release();
        if (tails.get(key) === tail) {
            tails.delete(key);
        }
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
    const keys = [...new Set(resourceKeys.map((key) => normalizeIoResourceKey(key)))].sort((a, b) =>
        a.localeCompare(b),
    );
    let totalWaitMs = 0;

    /**
     * @param {number} index
     * @returns {Promise<T>}
     */
    async function acquire(index) {
        const key = keys[index];
        if (!key) return operation();
        const locked = await withIoResourceLock(key, () => acquire(index + 1), options);
        totalWaitMs += locked.waitMs;
        return locked.value;
    }

    const value = await acquire(0);
    return { value, waitMs: totalWaitMs };
}

/**
 * Snapshot leve para health/tests.
 *
 * @returns {{ pendingResources: number; resources: string[] }}
 */
export function getIoLockStats() {
    return { pendingResources: tails.size, resources: [...tails.keys()] };
}
