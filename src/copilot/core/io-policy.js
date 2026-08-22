// @ts-check
/**
 * Pure I/O policy kernel for transport/output concerns.
 *
 * Workspace filesystem policy is owned by Infra. Core intentionally performs no filesystem I/O, realpath resolution,
 * path-authority issuance, process-scoped caching or ambient cwd lookup.
 *
 * @module copilot/core/io-policy
 */

import { validateUrlString } from './security/url-validator.js';

export const IO_POLICY_VERSION = '2026-08-18.r4.repo-text-scripts.v1';

/** Maximum HTTP redirects allowed by canonical URL policy. */
export const IO_URL_MAX_REDIRECTS = 5;

/** @type {Readonly<Record<string, { maxBytes: number; maxLines: number }>>} */
export const IO_OPERATION_ADVISORY_LIMITS = Object.freeze({
    read: Object.freeze({ maxBytes: 256 * 1024, maxLines: 2_000 }),
    write: Object.freeze({ maxBytes: 512 * 1024, maxLines: 0 }),
    append: Object.freeze({ maxBytes: 256 * 1024, maxLines: 0 }),
    scan: Object.freeze({ maxBytes: 0, maxLines: 4_000 }),
    search: Object.freeze({ maxBytes: 0, maxLines: 1_500 }),
    fetch: Object.freeze({ maxBytes: 256 * 1024, maxLines: 2_000 }),
    stat: Object.freeze({ maxBytes: 0, maxLines: 0 }),
    mkdir: Object.freeze({ maxBytes: 0, maxLines: 0 }),
});

const DEFAULT_SENSITIVE_OUTPUT_PATTERNS = Object.freeze([
    {
        regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu,
        replacement: 'Bearer [redacted]',
    },
    {
        regex: /(api[_-]?key\s*[:=]\s*)(["']?)[A-Za-z0-9._-]{8,}\2/giu,
        replacement: '$1[redacted]',
    },
    {
        regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
        replacement: '[redacted-gh-token]',
    },
]);

/**
 * @param {{ operation?: string; maxBytes?: number; maxLines?: number }} [options]
 */
export function resolveIoAdvisoryLimits(options = {}) {
    const operation =
        typeof options.operation === 'string' && options.operation.trim().length > 0
            ? options.operation.trim().toLowerCase()
            : 'read';
    const defaults = IO_OPERATION_ADVISORY_LIMITS[operation] ?? { maxBytes: 256 * 1024, maxLines: 2_000 };
    const maxBytes =
        typeof options.maxBytes === 'number' && Number.isFinite(options.maxBytes) && options.maxBytes > 0
            ? options.maxBytes
            : defaults.maxBytes;
    const maxLines =
        typeof options.maxLines === 'number' && Number.isFinite(options.maxLines) && options.maxLines >= 0
            ? options.maxLines
            : defaults.maxLines;
    return { operation, maxBytes, maxLines, advisory: true, policyVersion: IO_POLICY_VERSION };
}

/**
 * @param {{ input: string; allowPrivateNetworks?: boolean; allowLocalhost?: boolean; maxRedirects?: number }} options
 */
export function evaluateIoUrlPolicy(options) {
    const input = typeof options?.input === 'string' ? options.input.trim() : '';
    if (!input) {
        return { ok: false, reason: 'URL is required', code: 'URL_REQUIRED', policyVersion: IO_POLICY_VERSION };
    }

    void options.allowPrivateNetworks;
    void options.allowLocalhost;
    const validation = validateUrlString(input);
    if (!validation.safe || !validation.parsed) {
        return {
            ok: false,
            reason: validation.reason || 'Invalid URL',
            code: 'URL_BLOCKED',
            policyVersion: IO_POLICY_VERSION,
        };
    }

    return {
        ok: true,
        url: validation.parsed,
        maxRedirects:
            typeof options.maxRedirects === 'number' && options.maxRedirects >= 0
                ? options.maxRedirects
                : IO_URL_MAX_REDIRECTS,
        policyVersion: IO_POLICY_VERSION,
    };
}

/** @param {{ text: string; patterns?: { regex: RegExp; replacement?: string }[] }} options */
export function sanitizeIoTextOutput(options) {
    const sourceText = typeof options?.text === 'string' ? options.text : '';
    const patterns =
        Array.isArray(options?.patterns) && options.patterns.length > 0
            ? options.patterns
            : DEFAULT_SENSITIVE_OUTPUT_PATTERNS;

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

    return { text, sanitized: redactions > 0, redactions, policyVersion: IO_POLICY_VERSION };
}
