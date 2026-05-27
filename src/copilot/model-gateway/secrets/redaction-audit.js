// @ts-check
/**
 * Secret redaction audit helpers for model-gateway persisted surfaces.
 *
 * These helpers never return raw secret values. Samples carry only paths and redacted snippets so the audit can be
 * printed in terminal logs or JSON artifacts.
 *
 * @module copilot/model-gateway/secrets/redaction-audit
 */

const DEFAULT_MAX_SAMPLES = 20;
const SECRET_ENV_KEY_RE = /(?:api[_-]?key|authorization|bearer|token|secret|password|credential)/iu;
const AUDIT_BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu;
const AUDIT_JWT_TOKEN_RE = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const AUDIT_SECRET_ASSIGNMENT_RE =
    /((?:api[_-]?key|authorization|bearer[_-]?token|access[_-]?token|token|secret|password)\s*[:=]\s*["']?)[^"',\s;]{8,}/giu;
const AUDIT_PROVIDER_SECRET_RE =
    /\b(?:sk-(?:or-v1-)?|gsk_|hf_|csk-|nvapi-|cpk_|cfat_|AIza|ya29\.|xoxb-|pat_|ghp_)[A-Za-z0-9._~+/=-]{8,}\b/gu;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * @param {string} value
 * @returns {string}
 */
function compactSnippet(value) {
    return value.replace(/\s+/gu, ' ').slice(0, 240);
}

/**
 * @param {string} text
 * @param {readonly string[]} additionalSecrets
 * @returns {string}
 */
function redactAuditText(text, additionalSecrets) {
    let redacted = text;
    for (const secret of additionalSecrets) redacted = redacted.split(secret).join('[redacted]');
    return redacted
        .replace(AUDIT_BEARER_TOKEN_RE, 'Bearer [redacted]')
        .replace(AUDIT_JWT_TOKEN_RE, '[redacted]')
        .replace(AUDIT_SECRET_ASSIGNMENT_RE, '$1[redacted]')
        .replace(AUDIT_PROVIDER_SECRET_RE, '[redacted]');
}

/**
 * @param {unknown} value
 * @param {{ additionalSecrets?: readonly string[] }} [options]
 * @returns {unknown}
 */
export function redactModelGatewayAuditedValue(value, options = {}) {
    const additionalSecrets = [...new Set((options.additionalSecrets ?? []).map(optionalString).filter((item) => item !== null))];
    if (typeof value === 'string') return redactAuditText(value, additionalSecrets);
    if (Array.isArray(value)) return value.map((item) => redactModelGatewayAuditedValue(item, { additionalSecrets }));
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                redactModelGatewayAuditedValue(item, { additionalSecrets }),
            ]),
        );
    }
    return value;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function collectModelGatewaySecretAuditEnvValues(env = process.env) {
    return [
        ...new Set(
            Object.entries(env)
                .filter(([key, value]) => SECRET_ENV_KEY_RE.test(key) && typeof value === 'string' && value.length >= 8)
                .map(([, value]) => String(value)),
        ),
    ];
}

/**
 * @param {unknown} value
 * @param {{
 *     surface?: string;
 *     rootPath?: string;
 *     additionalSecrets?: readonly string[];
 *     maxSamples?: number;
 * }} [options]
 * @returns {{ schema: 'model-gateway-redaction-value-audit'; surface: string; ok: boolean; scannedStringCount: number; leakCount: number; sampleCount: number; samples: Array<{ path: string; redactedSnippet: string }> }}
 */
export function auditModelGatewayValueRedaction(value, options = {}) {
    const surface = optionalString(options.surface) ?? 'value';
    const rootPath = optionalString(options.rootPath) ?? '$';
    const maxSamples = positiveInteger(options.maxSamples, DEFAULT_MAX_SAMPLES);
    const additionalSecrets = [...new Set((options.additionalSecrets ?? []).map(optionalString).filter((item) => item !== null))];
    /** @type {Array<{ path: string; redactedSnippet: string }>} */
    const samples = [];
    let scannedStringCount = 0;
    let leakCount = 0;

    /**
     * @param {unknown} item
     * @param {string} path
     * @returns {void}
     */
    function visit(item, path) {
        if (typeof item === 'string') {
            scannedStringCount += 1;
            const redacted = redactAuditText(item, additionalSecrets);
            if (redacted !== item) {
                leakCount += 1;
                if (samples.length < maxSamples) samples.push({ path, redactedSnippet: compactSnippet(redacted) });
            }
            return;
        }
        if (Array.isArray(item)) {
            item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
            return;
        }
        if (isRecord(item)) {
            for (const [key, entry] of Object.entries(item)) {
                visit(entry, `${path}.${key}`);
            }
        }
    }

    visit(value, rootPath);
    return {
        schema: 'model-gateway-redaction-value-audit',
        surface,
        ok: leakCount === 0,
        scannedStringCount,
        leakCount,
        sampleCount: samples.length,
        samples,
    };
}

/**
 * @param {Array<{ ok: boolean; leakCount: number; scannedStringCount: number; sampleCount: number }>} audits
 * @returns {{ ok: boolean; leakCount: number; scannedStringCount: number; sampleCount: number }}
 */
export function summarizeModelGatewayRedactionAudits(audits) {
    return audits.reduce(
        (summary, audit) => ({
            ok: summary.ok && audit['ok'] === true,
            leakCount: summary.leakCount + (typeof audit['leakCount'] === 'number' ? audit['leakCount'] : 0),
            scannedStringCount:
                summary.scannedStringCount +
                (typeof audit['scannedStringCount'] === 'number' ? audit['scannedStringCount'] : 0),
            sampleCount: summary.sampleCount + (typeof audit['sampleCount'] === 'number' ? audit['sampleCount'] : 0),
        }),
        { ok: true, leakCount: 0, scannedStringCount: 0, sampleCount: 0 },
    );
}
