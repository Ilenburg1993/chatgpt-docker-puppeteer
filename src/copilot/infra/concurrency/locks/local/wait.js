// @ts-check
/** Timeout/abort/error normalization for process-local lock queues. */

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/** @param {'LockTimeout' | 'Abort'} kind @param {string} resourceKey */
export function createResourceLockError(kind, resourceKey) {
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

/** @param {unknown} error */
function asError(error) {
    return isError(error) ? /** @type {Error} */ (error) : new Error(String(error));
}

/**
 * @param {Promise<void>} previous
 * @param {string} key
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} options
 */
export function waitForPreviousResourceLock(previous, key, options) {
    if (options.signal?.aborted) return Promise.reject(createResourceLockError('Abort', key));
    if (options.timeoutMs === undefined && !options.signal) return previous.catch(() => undefined);
    return new Promise((resolve, reject) => {
        /** @type {NodeJS.Timeout | null} */ let timeout = null;
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(createResourceLockError('Abort', key));
        };
        if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.timeoutMs !== undefined) {
            timeout = setTimeout(
                () => {
                    cleanup();
                    reject(createResourceLockError('LockTimeout', key));
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
