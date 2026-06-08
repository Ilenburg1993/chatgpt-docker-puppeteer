// @ts-check
/**
 * Pure secret redaction helpers shared by SDK boundary, terminal UX and model-gateway.
 *
 * Keep this module dependency-free: higher layers may re-export it, but this layer cannot depend on routing, terminal
 * state or provider code.
 *
 * @module copilot/core/security/redaction
 */

const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu;
const JWT_TOKEN_RE = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const HEX_DOT_TOKEN_RE = /\b[A-Fa-f0-9]{24,}\.[A-Za-z0-9._~+/=-]{12,}\b/gu;
const SECRET_VALUE_RE =
    /(?<![A-Za-z0-9])(?:sk|sk-or-v1|gsk|hf|csk|nvapi|cpk|cfat|AIza|ya29|xoxb|pat|ghp|gho|ghu|ghs|ghr|github_pat)[A-Za-z0-9._~+/=-]{8,}/gu;
const SECRET_ASSIGNMENT_RE =
    /((?:api[_-]?key|authorization|bearer[_-]?token|token|secret|password)\s*[:=]\s*["']?)[^"',\s;]{8,}/giu;
const SENSITIVE_KEY_RE = /api[_-]?key|authorization|bearer|secret|password/iu;

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
    if (SENSITIVE_KEY_RE.test(key)) return true;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, '');
    return normalized.endsWith('token') && normalized !== 'tokens';
}

/**
 * @param {string} text
 * @param {number | null | undefined} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength) {
    if (typeof maxLength !== 'number' || !Number.isFinite(maxLength) || maxLength <= 0) return text;
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

/**
 * @param {string} text
 * @param {readonly (string | null | undefined)[] | undefined} additionalSecrets
 * @returns {string}
 */
function redactAdditionalSecrets(text, additionalSecrets) {
    let redacted = text;
    for (const value of additionalSecrets ?? []) {
        if (typeof value === 'string' && value.length > 0) {
            redacted = redacted.split(value).join('[redacted]');
        }
    }
    return redacted;
}

/**
 * @param {unknown} value
 * @param {{ additionalSecrets?: readonly (string | null | undefined)[]; maxLength?: number | null }} [options]
 * @returns {string}
 */
export function redactSecretText(value, options = {}) {
    const text = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '');
    const redacted = redactAdditionalSecrets(text, options.additionalSecrets)
        .replace(BEARER_TOKEN_RE, 'Bearer [redacted]')
        .replace(JWT_TOKEN_RE, '[redacted]')
        .replace(HEX_DOT_TOKEN_RE, '[redacted]')
        .replace(SECRET_ASSIGNMENT_RE, '$1[redacted]')
        .replace(SECRET_VALUE_RE, '[redacted]');
    return truncateText(redacted, options.maxLength);
}

/**
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function redactSecretRecord(input) {
    return Object.fromEntries(
        Object.entries(input).map(([key, value]) => {
            const redactedKey = redactSecretText(key);
            if (isSensitiveKey(key)) {
                return [redactedKey, '[redacted]'];
            }
            if (key.toLowerCase() === 'headers' && value && typeof value === 'object' && !Array.isArray(value)) {
                return [
                    redactedKey,
                    Object.fromEntries(
                        Object.keys(/** @type {Record<string, unknown>} */ (value)).map((name) => [
                            redactSecretText(name),
                            '[redacted]',
                        ]),
                    ),
                ];
            }
            if (typeof value === 'string') return [redactedKey, redactSecretText(value)];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return [redactedKey, redactSecretRecord(/** @type {Record<string, unknown>} */ (value))];
            }
            if (Array.isArray(value)) {
                return [
                    redactedKey,
                    value.map((item) =>
                        typeof item === 'string'
                            ? redactSecretText(item)
                            : item && typeof item === 'object'
                              ? redactSecretRecord(/** @type {Record<string, unknown>} */ (item))
                              : item,
                    ),
                ];
            }
            return [redactedKey, value];
        }),
    );
}
