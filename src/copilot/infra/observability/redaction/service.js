// @ts-check
import { IO_POLICY_VERSION } from '#copilot/infra/internal/operations/contracts/io';

const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu;
const JWT_TOKEN_RE = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const HEX_DOT_TOKEN_RE = /\b[A-Fa-f0-9]{24,}\.[A-Za-z0-9._~+/=-]{12,}\b/gu;
const SECRET_VALUE_RE =
    /(?<![A-Za-z0-9])(?:sk|sk-or-v1|gsk|hf|csk|nvapi|cpk|cfat|AIza|ya29|xoxb|pat|ghp|gho|ghu|ghs|ghr|github_pat)[A-Za-z0-9._~+/=-]{8,}/gu;
const SECRET_ASSIGNMENT_RE =
    /((?:api[_-]?key|authorization|bearer[_-]?token|token|secret|password)\s*[:=]\s*["']?)[^"',\s;]{8,}/giu;
const SENSITIVE_KEY_RE = /api[_-]?key|authorization|bearer|secret|password/iu;

export const DEFAULT_REDACTION_LIMITS = Object.freeze({
    maxDepth: 12,
    maxNodes: 4_096,
    maxArrayItems: 512,
    maxStringLength: 256 * 1024,
});

/** @param {string} key */
function isSensitiveKey(key) {
    if (SENSITIVE_KEY_RE.test(key)) return true;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, '');
    return normalized.endsWith('token') && normalized !== 'tokens';
}

/** @param {string} text @param {number|null|undefined} maxLength @returns {string} */
function truncateText(text, maxLength) {
    if (typeof maxLength !== 'number' || !Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength)
        return text;
    const marker = '...[truncated]';
    return `${text.slice(0, Math.max(0, maxLength - marker.length))}${marker}`;
}

/** @param {string} text @param {readonly (string|null|undefined)[]|undefined} additionalSecrets @returns {string} */
function redactAdditionalSecrets(text, additionalSecrets) {
    let redacted = text;
    for (const value of additionalSecrets ?? []) {
        if (typeof value === 'string' && value.length > 0) redacted = redacted.split(value).join('[redacted]');
    }
    return redacted;
}

/** @param {unknown} value @param {{additionalSecrets?:readonly (string|null|undefined)[];maxLength?:number|null}} [options] */
export function redactSecretText(value, options = {}) {
    const source = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '');
    const redacted = redactAdditionalSecrets(source, options.additionalSecrets)
        .replace(BEARER_TOKEN_RE, 'Bearer [redacted]')
        .replace(JWT_TOKEN_RE, '[redacted]')
        .replace(HEX_DOT_TOKEN_RE, '[redacted]')
        .replace(SECRET_ASSIGNMENT_RE, '$1[redacted]')
        .replace(SECRET_VALUE_RE, '[redacted]');
    return truncateText(redacted, options.maxLength);
}

/**
 * Bounded, cycle-safe structural redaction. It never recurses without a depth/node budget and never returns the input
 * object by reference.
 * @param {Record<string, unknown>} input
 * @param {{maxDepth?:number;maxNodes?:number;maxArrayItems?:number;maxStringLength?:number}} [options]
 * @returns {Record<string, unknown>}
 */
export function redactSecretRecord(input, options = {}) {
    const limits = {
        maxDepth: Math.max(1, Math.trunc(options.maxDepth ?? DEFAULT_REDACTION_LIMITS.maxDepth)),
        maxNodes: Math.max(1, Math.trunc(options.maxNodes ?? DEFAULT_REDACTION_LIMITS.maxNodes)),
        maxArrayItems: Math.max(1, Math.trunc(options.maxArrayItems ?? DEFAULT_REDACTION_LIMITS.maxArrayItems)),
        maxStringLength: Math.max(1, Math.trunc(options.maxStringLength ?? DEFAULT_REDACTION_LIMITS.maxStringLength)),
    };
    const seen = new WeakSet();
    let nodes = 0;

    /** @param {unknown} value @param {number} depth @param {string|null} key */
    /** @param {unknown} value @param {number} depth @param {string|null} key @returns {unknown} */
    function visit(value, depth, key) {
        if (key && isSensitiveKey(key)) return '[redacted]';
        if (typeof value === 'string') return redactSecretText(value, { maxLength: limits.maxStringLength });
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return '[circular]';
        nodes += 1;
        if (nodes > limits.maxNodes) return '[redaction-node-budget-exceeded]';
        if (depth >= limits.maxDepth) return '[redaction-depth-exceeded]';
        seen.add(value);
        if (Array.isArray(value)) {
            /** @type {unknown[]} */
            const result = value.slice(0, limits.maxArrayItems).map((item) => visit(item, depth + 1, null));
            if (value.length > limits.maxArrayItems)
                result.push(`[${value.length - limits.maxArrayItems} item(s) truncated]`);
            return result;
        }
        const record = /** @type {Record<string, unknown>} */ (value);
        /** @type {Record<string, unknown>} */
        const output = {};
        const isHeaders = key?.toLowerCase() === 'headers';
        for (const [rawKey, child] of Object.entries(record)) {
            const redactedKey = redactSecretText(rawKey, { maxLength: limits.maxStringLength });
            output[redactedKey] = isHeaders ? '[redacted]' : visit(child, depth + 1, rawKey);
        }
        return output;
    }

    return /** @type {Record<string, unknown>} */ (visit(input, 0, null));
}

const DEFAULT_IO_OUTPUT_PATTERNS = Object.freeze([
    { regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, replacement: 'Bearer [redacted]' },
    { regex: /(api[_-]?key\s*[:=]\s*)(["']?)[A-Za-z0-9._-]{8,}\2/giu, replacement: '$1[redacted]' },
    { regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, replacement: '[redacted-gh-token]' },
]);

/** @param {{text:string;patterns?:{regex:RegExp;replacement?:string}[]}} options */
export function sanitizeIoTextOutput(options) {
    const sourceText = typeof options?.text === 'string' ? options.text : '';
    const patterns =
        Array.isArray(options?.patterns) && options.patterns.length > 0 ? options.patterns : DEFAULT_IO_OUTPUT_PATTERNS;
    let redactions = 0;
    let text = sourceText;
    for (const pattern of patterns) {
        if (!(pattern?.regex instanceof RegExp)) continue;
        const replacement = typeof pattern.replacement === 'string' ? pattern.replacement : '[redacted]';
        text = text.replace(pattern.regex, () => {
            redactions += 1;
            return replacement;
        });
    }
    // Apply the wider secret vocabulary as a second pass. Count this as one additional redaction when it changes text.
    const hardened = redactSecretText(text);
    if (hardened !== text) redactions += 1;
    return { text: hardened, sanitized: redactions > 0, redactions, policyVersion: IO_POLICY_VERSION };
}
