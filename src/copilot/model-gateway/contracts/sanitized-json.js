// @ts-check
/**
 * Shape-preserving JSON sanitization contract for Model Gateway records.
 *
 * Runtime sanitization is intentionally separated from the generic public wrappers: the runtime core accepts unknown
 * data and validates every recursive branch; the wrappers only recover the structural information that the sanitizer
 * demonstrably preserves. Sensitive keys are always projected to strings because their values are replaced with
 * `[redacted]` regardless of the original value type.
 *
 * @module copilot/model-gateway/contracts/sanitized-json
 */

const SENSITIVE_JSON_KEY_RE = /^(?:authorization|proxy-authorization|api[_-]?key|secret|token|bearer[_-]?token|access[_-]?token)$/iu;

/**
 * Lower-case spellings accepted by SENSITIVE_JSON_KEY_RE. This is intentionally exact rather than broad: dynamic
 * Record<string, unknown> keys remain unknown-valued, while object literals with known safe keys retain their shape.
 *
 * @typedef {
 *   | 'authorization'
 *   | 'proxy-authorization'
 *   | 'apikey'
 *   | 'api_key'
 *   | 'api-key'
 *   | 'secret'
 *   | 'token'
 *   | 'bearertoken'
 *   | 'bearer_token'
 *   | 'bearer-token'
 *   | 'accesstoken'
 *   | 'access_token'
 *   | 'access-token'
 * } SanitizedSecretKey
 */

/**
 * @template T
 * @typedef {T extends undefined ? null : T extends string ? string : T extends readonly (infer U)[] ? SanitizedJson<U>[] : T extends Record<string, unknown> ? SanitizedRecord<T> : T} SanitizedJson
 */

/**
 * @template {Record<string, unknown>} T
 * @typedef {{ [K in keyof T]: K extends string ? Lowercase<K> extends SanitizedSecretKey ? string : SanitizedJson<T[K]> : SanitizedJson<T[K]> }} FiniteSanitizedRecord
 */

/**
 * Open dictionaries stay open and unknown-valued. Only finite object shapes receive key-by-key preservation; this
 * prevents a generic Record<string, unknown> from being mistaken for a record whose every key is sensitive.
 *
 * @template {Record<string, unknown>} T
 * @typedef {string extends keyof T ? Record<string, unknown> : FiniteSanitizedRecord<T>} SanitizedRecord
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {(value: string) => string} sanitizeString
 * @returns {Record<string, unknown>}
 */
function sanitizeUnknownRecord(value, sanitizeString) {
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            SENSITIVE_JSON_KEY_RE.test(key) ? '[redacted]' : sanitizeUnknownValue(item, sanitizeString),
        ]),
    );
}

/**
 * @param {unknown} value
 * @param {(value: string) => string} sanitizeString
 * @returns {unknown}
 */
function sanitizeUnknownValue(value, sanitizeString) {
    if (typeof value === 'string') return sanitizeString(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeUnknownValue(item, sanitizeString));
    if (isRecord(value)) return sanitizeUnknownRecord(value, sanitizeString);
    if (value === undefined) return null;
    return value;
}

/**
 * @template T
 * @param {T} value
 * @param {(value: string) => string} sanitizeString
 * @returns {SanitizedJson<T>}
 */
export function sanitizeJsonValue(value, sanitizeString) {
    return /** @type {SanitizedJson<T>} */ (sanitizeUnknownValue(value, sanitizeString));
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} value
 * @param {(value: string) => string} sanitizeString
 * @returns {SanitizedRecord<T>}
 */
export function sanitizeJsonRecord(value, sanitizeString) {
    return /** @type {SanitizedRecord<T>} */ (sanitizeUnknownRecord(value, sanitizeString));
}
