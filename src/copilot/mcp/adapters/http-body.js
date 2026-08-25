// @ts-check
/**
 * Bounded MCP JSON body helpers for Streamable HTTP.
 *
 * This module deliberately does not log request payloads. It owns bounded Node request-body I/O only; stateful
 * initialize/session semantics are owned by `transport/http/stateful/request-contract`.
 *
 * @module copilot/mcp/adapters/http-body
 */

import { concatBufferViews, decodeUtf8Buffer } from '#copilot/infra/public/platform/buffer';
export const DEFAULT_MCP_HTTP_BODY_MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_ENCODING = 'utf8';

/**
 * @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpBodyRequest
 *
 * @typedef {{ error: string; error_description: string }} McpHttpBodyError
 *
 * @typedef {{ ok: true; body: unknown; bytesRead: number }} McpHttpJsonBodyResult
 *
 * @typedef {{ ok: false; statusCode: number; error: McpHttpBodyError; bytesRead: number }} McpHttpJsonBodyFailure
 *
 * @typedef {{ maxBytes?: number }} McpHttpJsonBodyOptions
 *
 */

/**
 * Read and parse a bounded JSON MCP request body.
 *
 * @param {McpHttpBodyRequest} req
 * @param {McpHttpJsonBodyOptions} [options]
 * @returns {Promise<McpHttpJsonBodyResult | McpHttpJsonBodyFailure>}
 */
export async function readMcpHttpJsonBody(req, options = {}) {
    const maxBytes = normalizeMaxBytes(options.maxBytes);
    const contentLength = readBodyHeader(req, 'content-length');
    if (contentLength) {
        if (!/^\d+$/u.test(contentLength)) {
            return bodyFailure(400, 'invalid_request', 'Invalid Content-Length header.', 0);
        }
        if (Number(contentLength) > maxBytes) {
            return bodyFailure(413, 'request_entity_too_large', 'MCP request body exceeds configured limit.', 0);
        }
    }

    let bytesRead = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    try {
        for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), DEFAULT_ENCODING);
            bytesRead += buffer.byteLength;
            if (bytesRead > maxBytes) {
                return bodyFailure(
                    413,
                    'request_entity_too_large',
                    'MCP request body exceeds configured limit.',
                    bytesRead,
                );
            }
            chunks.push(buffer);
        }
    } catch {
        return bodyFailure(400, 'invalid_request', 'Could not read MCP request body.', bytesRead);
    }

    if (bytesRead === 0) {
        return bodyFailure(400, 'invalid_request', 'MCP POST requests must include a JSON request body.', bytesRead);
    }

    try {
        const raw = decodeUtf8Buffer(concatBufferViews(chunks, bytesRead), 'MCP request body contains invalid UTF-8.');
        const body = JSON.parse(raw);
        return { ok: true, body, bytesRead };
    } catch {
        return bodyFailure(400, 'invalid_request', 'Invalid JSON request body.', bytesRead);
    }
}

/**
 * @param {McpHttpBodyRequest} req
 * @param {string} name
 * @returns {string | undefined}
 */
function readBodyHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeMaxBytes(value) {
    const parsed = Number(value ?? DEFAULT_MCP_HTTP_BODY_MAX_BYTES);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MCP_HTTP_BODY_MAX_BYTES;
}

/**
 * @param {number} statusCode
 * @param {string} error
 * @param {string} errorDescription
 * @param {number} bytesRead
 * @returns {McpHttpJsonBodyFailure}
 */
function bodyFailure(statusCode, error, errorDescription, bytesRead) {
    return {
        ok: false,
        statusCode,
        error: { error, error_description: errorDescription },
        bytesRead,
    };
}
