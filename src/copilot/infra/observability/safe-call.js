// @ts-check
/** Failure-contained read-side calls for observability projections. */
const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/** @param {unknown} error */
export function healthErrorMessage(error) {
    return isError(error) ? /** @type {Error} */ (error).message : String(error);
}
/** @template T @param {() => T} fn @param {T} fallback @returns {T} */
export function safeHealthCall(fn, fallback) {
    try {
        return fn();
    } catch (error) {
        if (fallback && typeof fallback === 'object') {
            return /** @type {T} */ ({
                .../** @type {Record<string, unknown>} */ (fallback),
                error: healthErrorMessage(error),
            });
        }
        return fallback;
    }
}
