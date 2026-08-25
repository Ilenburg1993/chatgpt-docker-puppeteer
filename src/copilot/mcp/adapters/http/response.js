// @ts-check
/**
 * Deterministic HTTP response primitives for the MCP Node host adapters.
 *
 * This module owns serialization/header mechanics only; it does not decide routing, authentication or protocol era.
 *
 * @module copilot/mcp/adapters/http/response
 */

import { createHash } from 'node:crypto';

/** @typedef {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} McpHttpResponse */

export const PUBLIC_METADATA_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
export const NO_STORE_CACHE_CONTROL = 'no-store, no-transform';

/** @param {McpHttpResponse} res @param {number} statusCode @param {unknown} payload @param {string} [cacheControl] */
export function writeJson(res, statusCode, payload, cacheControl = NO_STORE_CACHE_CONTROL) {
    const body = JSON.stringify(payload);
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': cacheControl,
        ...(cacheControl.includes('no-store') ? { pragma: 'no-cache', 'surrogate-control': 'no-store' } : {}),
        ...(cacheControl.includes('no-store') ? {} : { etag: buildWeakJsonEtag(body) }),
        'x-content-type-options': 'nosniff',
    };
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, headers);
    response.end(body);
}

/** @param {McpHttpResponse} res @param {number} statusCode */
export function writeEmpty(res, statusCode) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, {
        'content-length': '0',
        'cache-control': NO_STORE_CACHE_CONTROL,
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
    });
    response.end();
}

/** @param {McpHttpResponse} res @param {number} statusCode @param {string} body */
export function writeText(res, statusCode, body) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    response.writeHead(statusCode, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': NO_STORE_CACHE_CONTROL,
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
    });
    response.end(body);
}

/** @param {McpHttpResponse} res */
export function safeEnd(res) {
    try {
        res.end();
    } catch {
        // Best-effort termination only.
    }
}

/** @param {McpHttpResponse} res @param {string} name @param {string} value */
export function setHeaderIfAbsent(res, name, value) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    if (!response.hasHeader(name)) response.setHeader(name, value);
}

/** @param {McpHttpResponse} res @param {readonly string[]} values */
export function appendVaryHeader(res, values) {
    const response = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res));
    const existing = response.getHeader('Vary');
    const current = Array.isArray(existing)
        ? existing.flatMap((item) => String(item).split(','))
        : String(existing ?? '')
              .split(',')
              .filter(Boolean);
    const normalized = new Map();
    for (const value of [...current, ...values]) {
        const trimmed = String(value).trim();
        if (trimmed) normalized.set(trimmed.toLowerCase(), trimmed);
    }
    if (normalized.size > 0) response.setHeader('Vary', [...normalized.values()].join(', '));
}

/** @param {McpHttpResponse} res */
export function setNoStoreResponseHeaders(res) {
    res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    appendVaryHeader(res, ['Origin', 'Accept', 'Accept-Encoding']);
}

/** @param {McpHttpResponse} res @param {readonly string[]} methods */
export function writeMethodNotAllowed(res, methods) {
    res.setHeader('Allow', methods.join(', '));
    writeJson(res, 405, { error: 'method_not_allowed', allowed_methods: methods });
}

/**
 * @param {McpHttpResponse} res
 * @param {number} statusCode
 * @param {{ error: string; error_description: string }} error
 */
export function writeMcpTransportError(res, statusCode, error) {
    writeJson(res, statusCode, {
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: error.error_description,
            data: error,
        },
    });
}

/** @param {string} body */
function buildWeakJsonEtag(body) {
    return `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
}
