// @ts-check
/**
 * Canonical model-gateway redaction helpers.
 *
 * This module is deliberately value-based: callers can pass errors, provider payloads or logs without teaching the
 * redactor provider-specific control flow.
 *
 * @module copilot/model-gateway/secrets/redaction
 */

const SECRET_VALUE_RE = /\b(?:Bearer\s+)?(?:sk|sk-or-v1|gsk|hf|csk|nvapi|cpk|cfat|AIza|ya29|xoxb|pat|ghp)[A-Za-z0-9._~+/=-]{8,}\b/gu;
const SECRET_ASSIGNMENT_RE = /((?:api[_-]?key|authorization|bearer[_-]?token|token|secret|password)\s*[:=]\s*["']?)[^"',\s;]{8,}/giu;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function redactSecretText(value) {
    const text = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '');
    return text
        .replace(SECRET_ASSIGNMENT_RE, '$1[redacted]')
        .replace(SECRET_VALUE_RE, (match) => (match.toLowerCase().startsWith('bearer ') ? 'Bearer [redacted]' : '[redacted]'));
}

/**
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function redactSecretRecord(input) {
    return Object.fromEntries(
        Object.entries(input).map(([key, value]) => {
            if (/api[_-]?key|authorization|bearer|token|secret|password/iu.test(key)) {
                return [key, '[redacted]'];
            }
            if (typeof value === 'string') return [key, redactSecretText(value)];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return [key, redactSecretRecord(/** @type {Record<string, unknown>} */ (value))];
            }
            if (Array.isArray(value)) {
                return [
                    key,
                    value.map((item) =>
                        typeof item === 'string'
                            ? redactSecretText(item)
                            : item && typeof item === 'object'
                              ? redactSecretRecord(/** @type {Record<string, unknown>} */ (item))
                              : item,
                    ),
                ];
            }
            return [key, value];
        }),
    );
}

