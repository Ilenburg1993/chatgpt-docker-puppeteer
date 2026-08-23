// @ts-check
/** Pure JSON codec with explicit strict/result semantics and no filesystem authority. */

/** @param {unknown} error @param {string | undefined} context */
function jsonParseError(error, context) {
    const message = error instanceof Error ? error.message : String(error);
    return new SyntaxError(context ? `Invalid JSON (${context}): ${message}` : `Invalid JSON: ${message}`, {
        cause: error,
    });
}

/**
 * @template [T=unknown]
 * @param {string} raw
 * @param {string} [context]
 * @returns {{ok:true;data:T}|{ok:false;error:SyntaxError}}
 */
export function parseJsonResult(raw, context) {
    try {
        return { ok: true, data: /** @type {T} */ (JSON.parse(raw)) };
    } catch (error) {
        return { ok: false, error: jsonParseError(error, context) };
    }
}

/**
 * @template [T=unknown]
 * @param {string} raw
 * @param {string} [context]
 * @returns {T}
 */
export function parseJsonStrict(raw, context) {
    const result = parseJsonResult(raw, context);
    if (!result.ok) throw result.error;
    return /** @type {T} */ (result.data);
}

/**
 * Strict serialization: unlike JSON.stringify, the public contract always returns a string or throws.
 * Circular values, BigInt and top-level undefined/functions/symbols are rejected instead of being silently replaced.
 *
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
export function stringifyJsonStrict(value, indent) {
    const serialized = JSON.stringify(value, null, indent);
    if (serialized === undefined) throw new TypeError('JSON value is not serializable to a top-level string.');
    return serialized;
}
