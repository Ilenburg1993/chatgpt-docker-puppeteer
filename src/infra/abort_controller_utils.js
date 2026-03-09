// @ts-check - Type checking rigoroso habilitado

/**
 * @module infra/abort_controller_utils
 * @file Utility functions for managing AbortController with Promise operations. Provides safe patterns for timeout
 *   handling and resource cleanup.
 *
 *   Created to address P0 bugs in forensics.js, handle_manager.js, and recovery_system.js where Promise.race() operations
 *   lacked proper cleanup mechanisms.
 */

/**
 * Executes an operation with a timeout using Promise.race and AbortController. Guarantees proper cleanup of timers and
 * signals abort on completion or error.
 *
 * @example
 *     const result = await withTimeout(() => page.screenshot({ path: 'screenshot.png' }), 5000, 'SCREENSHOT_TIMEOUT');
 *
 * @param {function} operation - Function that returns a Promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [timeoutMessage='Operation timed out'] - Error message for timeout. Default is `'Operation timed
 *   out'`
 * @returns {Promise<unknown>} Result of the operation
 * @throws {Error} If timeout occurs or operation fails
 */
export async function withTimeout(operation, timeoutMs, timeoutMessage = 'Operation timed out') {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;

    try {
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort(timeoutMessage);
                const error = new Error(timeoutMessage);
                /** @type {any} */ (error).code = 'TIMEOUT';
                /** @type {any} */ (error).timeoutMs = timeoutMs;
                reject(error);
            }, timeoutMs);
        });

        const result = await /** @type {Promise<any>} */ (Promise.race([operation(), timeoutPromise]));

        // Clear timeout on success
        if (timeoutId !== null) clearTimeout(timeoutId);

        return result;
    } catch (/** @type {any} */ err) {
        // Ensure timeout is cleared even on error
        if (timeoutId !== null) clearTimeout(timeoutId);
        controller.abort('operation_failed');
        throw err;
    } finally {
        // Final cleanup - abort any pending operations
        controller.abort('cleanup');
    }
}

/**
 * Executes an operation that accepts an AbortSignal with automatic timeout. The operation receives the signal and
 * should respect it for cancellation.
 *
 * @example
 *     const result = await withAbort(
 *         async (signal) => {
 *             const response = await fetch(url, { signal });
 *             return response.json();
 *         },
 *         10000,
 *         'FETCH_TIMEOUT',
 *     );
 *
 * @param {function} operation - Function that accepts AbortSignal and returns Promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [timeoutMessage='Operation aborted'] - Error message for timeout. Default is `'Operation aborted'`
 * @returns {Promise<unknown>} Result of the operation
 * @throws {Error} If timeout occurs or operation fails
 */
export async function withAbort(operation, timeoutMs, timeoutMessage = 'Operation aborted') {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;

    try {
        timeoutId = setTimeout(() => {
            controller.abort(timeoutMessage);
        }, timeoutMs);

        const result = await /** @type {Promise<any>} */ (operation(controller.signal));

        // Clear timeout on success
        if (timeoutId !== null) clearTimeout(timeoutId);

        return result;
    } catch (/** @type {any} */ err) {
        // Ensure timeout is cleared even on error
        if (timeoutId !== null) clearTimeout(timeoutId);
        controller.abort('operation_failed');
        throw err;
    } finally {
        // Final cleanup
        controller.abort('cleanup');
    }
}

/**
 * Creates a shared timeout promise that can be reused in multiple Promise.race() calls. Useful when you need the same
 * timeout for multiple sequential operations. Returns both the timeout promise and a cleanup function.
 *
 * @example
 *     const { promise: timeoutPromise, cleanup } = createSharedTimeout(5000, 'FOCUS_TIMEOUT');
 *     try {
 *         await Promise.race([page.mouse.click(1, 1), timeoutPromise]);
 *         await Promise.race([page.evaluate(() => window.focus()), timeoutPromise]);
 *     } finally {
 *         cleanup();
 *     }
 *
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [timeoutMessage='Operation timed out'] - Error message for timeout. Default is `'Operation timed
 *   out'`
 * @returns {{ promise: Promise<void>; controller: AbortController; cleanup: function }}
 */
export function createSharedTimeout(timeoutMs, timeoutMessage = 'Operation timed out') {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;
    let promiseResolved = false;

    const promise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            promiseResolved = true;
            controller.abort(timeoutMessage);
            const error = new Error(timeoutMessage);
            /** @type {any} */ (error).code = 'TIMEOUT';
            /** @type {any} */ (error).timeoutMs = timeoutMs;
            reject(error);
        }, timeoutMs);
    });

    const cleanup = () => {
        if (timeoutId !== null && !promiseResolved) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        controller.abort('cleanup');
    };

    return { promise, controller, cleanup };
}

/**
 * Wraps multiple operations in a single timeout context. If any operation exceeds the total timeout, all are aborted.
 *
 * @example
 *     const [clickResult, focusResult] = await withSharedTimeout(
 *         [() => page.mouse.click(1, 1), () => page.evaluate(() => window.focus())],
 *         5000,
 *         'FOCUS_RECOVERY_TIMEOUT',
 *     );
 *
 * @param {function[]} operations - Array of functions returning Promises
 * @param {number} timeoutMs - Total timeout for all operations
 * @param {string} [timeoutMessage='Operations timed out'] - Error message. Default is `'Operations timed out'`
 * @returns {Promise<unknown[]>} Array of results from all operations
 * @throws {Error} If timeout occurs or any operation fails
 */
export async function withSharedTimeout(operations, timeoutMs, timeoutMessage = 'Operations timed out') {
    const { promise: timeoutPromise, cleanup } = createSharedTimeout(timeoutMs, timeoutMessage);
    const results = [];

    try {
        for (const operation of operations) {
            const result = await /** @type {Promise<any>} */ (Promise.race([operation(), timeoutPromise]));
            results.push(result);
        }
        return results;
    } finally {
        cleanup();
    }
}

/**
 * @typedef {object} WithRetryOptions
 * @property {number} [maxRetries] - Max retry attempts
 * @property {number} [timeoutMs] - Timeout per attempt
 * @property {number} [backoffMs] - Backoff delay
 * @property {function} [shouldRetry] - Predicate to decide retry
 */
/**
 * Executes an operation with retries and timeout per attempt. Each retry gets a fresh timeout, and exponential backoff
 * is applied.
 *
 * @example
 *     const result = await withRetry(() => fetch(url).then((r) => r.json()), {
 *         maxRetries: 3,
 *         timeoutMs: 5000,
 *         backoffMs: 100,
 *         shouldRetry: (err) => err.code !== 'AUTH_ERROR',
 *     });
 *
 * @param {function} operation - Function that returns a Promise
 * @param {WithRetryOptions} options - Configuration options
 * @returns {Promise<unknown>} Result of the operation
 * @throws {Error} If all retries fail
 */
export async function withRetry(operation, options = {}) {
    const _opts = /** @type {any} */ (options);
    const { maxRetries = 3, timeoutMs = 5000, backoffMs = 100, shouldRetry = () => true } = _opts;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await withTimeout(operation, timeoutMs, `RETRY_ATTEMPT_${attempt}_TIMEOUT`);
        } catch (/** @type {any} */ err) {
            lastError = err;

            // Don't retry if we've exhausted attempts or error is not retryable
            if (attempt >= maxRetries || !shouldRetry(err)) {
                break;
            }

            // Exponential backoff
            const delay = Math.min(backoffMs * Math.pow(2, attempt), 5000);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    // All retries failed
    const error = /** @type {any} */ (new Error(`Operation failed after ${maxRetries + 1} attempts`));
    error.code = 'MAX_RETRIES_EXCEEDED';
    error.lastError = lastError;
    error.attempts = maxRetries + 1;
    throw error;
}

/**
 * Utility to check if an error is an abort error. Useful for handling AbortController cancellations.
 *
 * @example
 *     try {
 *         await withTimeout(operation, 5000);
 *     } catch (err) {
 *         if (isAbortError(err)) {
 *             console.log('Operation was aborted/timed out');
 *         }
 *     }
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if error is from abort
 */
export function isAbortError(error) {
    const _e = /** @type {any} */ (error);
    return !!(
        _e &&
        (_e.name === 'AbortError' ||
            _e.code === 'ABORT_ERR' ||
            _e.code === 'TIMEOUT' ||
            (_e.message && _e.message.includes('abort')))
    );
}

/**
 * Creates a cancellable operation that can be manually aborted. Returns the operation promise and a cancel function.
 *
 * @example
 *     const { promise, cancel } = createCancellable(async (signal) => {
 *         const response = await fetch(url, { signal });
 *         return response.json();
 *     });
 *
 *     // Later, if needed:
 *     cancel('User cancelled');
 *
 *     try {
 *         const result = await promise;
 *     } catch (err) {
 *         if (isAbortError(err)) {
 *             console.log('Operation was cancelled');
 *         }
 *     }
 *
 * @param {function} operation - Function that accepts AbortSignal and returns Promise
 * @returns {{ promise: Promise<unknown>; cancel: function }}
 */
export function createCancellable(operation) {
    const controller = new AbortController();

    const promise = operation(controller.signal).finally(() => {
        controller.abort('cleanup');
    });

    const cancel = (reason = 'Cancelled') => {
        controller.abort(reason);
    };

    return { promise, cancel };
}
