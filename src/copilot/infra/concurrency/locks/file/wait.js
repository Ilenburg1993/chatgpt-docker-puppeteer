// @ts-check
/** Abort/timeout primitives for lockfile acquisition waits. */

export function createFileLockAbortError() {
    const error = /** @type {Error & { code?: string }} */ (new Error('Lockfile abortado antes de adquirir recurso.'));
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

/** @param {string} lockPath */
export function createFileLockTimeoutError(lockPath) {
    const error = /** @type {Error & { code?: string; lockPath?: string }} */ (
        new Error(`Timeout ao aguardar lockfile: ${lockPath}`)
    );
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    error.lockPath = lockPath;
    return error;
}

/** @param {unknown} error */
export function fileLockErrorCode(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return typeof code === 'string' ? code : null;
}

/** @param {number} ms @param {AbortSignal | undefined} signal */
export function sleepForFileLock(ms, signal) {
    if (signal?.aborted) return Promise.reject(createFileLockAbortError());
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => {
                cleanup();
                resolve(undefined);
            },
            Math.max(0, ms),
        );
        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(createFileLockAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
