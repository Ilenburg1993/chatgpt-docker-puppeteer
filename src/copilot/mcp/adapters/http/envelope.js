// @ts-check
/** Pure MCP-over-HTTP request-envelope validation for Node host adapters. */

import {
    MCP_PROTOCOL_LEGACY_DEFAULT_VERSION,
    MCP_PROTOCOL_LEGACY_MISSING_HEADER_FALLBACK_VERSION,
} from '#copilot/mcp/public/protocol/version';
import { isMcpProtocolVersion } from './config.js';
import { readHeader } from './request-identity.js';

/** @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest */

/** @param {McpHttpRequest} req @param {ReturnType<typeof import('./config.js').readMcpHttpTransportPolicy>} transportPolicy */
export function chooseMcpProtocolVersion(req, transportPolicy) {
    const requested = readHeader(req, 'mcp-protocol-version');
    if (!requested) return MCP_PROTOCOL_LEGACY_MISSING_HEADER_FALLBACK_VERSION;
    return isMcpProtocolVersion(requested) && transportPolicy.legacySupportedProtocolVersions.includes(requested)
        ? requested
        : MCP_PROTOCOL_LEGACY_DEFAULT_VERSION;
}

/**
 * @param {McpHttpRequest} req
 * @param {ReturnType<typeof import('./config.js').readMcpHttpTransportPolicy>} transportPolicy
 * @returns {{ statusCode: number; error: { error: string; error_description: string } } | null}
 */
export function validateMcpRequestEnvelope(req, transportPolicy) {
    const method = String(req.method ?? '').toUpperCase();
    if (method !== 'POST') return null;
    const contentLength = readHeader(req, 'content-length');
    if (contentLength) {
        if (!/^\d+$/u.test(contentLength)) {
            return {
                statusCode: 400,
                error: { error: 'invalid_request', error_description: 'Invalid Content-Length header.' },
            };
        }
        if (Number(contentLength) > transportPolicy.maxRequestBodyBytes) {
            return {
                statusCode: 413,
                error: {
                    error: 'request_entity_too_large',
                    error_description: 'MCP request body exceeds configured limit.',
                },
            };
        }
    }
    if (transportPolicy.strictContentType) {
        const contentType = readHeader(req, 'content-type') ?? '';
        if (!contentType.trim() || !contentTypeHeaderSupportsJson(contentType)) {
            return {
                statusCode: 415,
                error: {
                    error: 'unsupported_media_type',
                    error_description: 'MCP POST requests must use application/json content.',
                },
            };
        }
    }
    return null;
}

/**
 * @param {McpHttpRequest} req
 * @param {ReturnType<typeof import('./config.js').readMcpHttpTransportPolicy>} transportPolicy
 */
export function validateMcpProtocolVersionHeader(req, transportPolicy) {
    const value = readHeader(req, 'mcp-protocol-version');
    if (!value) return null;
    if (!isMcpProtocolVersion(value)) {
        return { error: 'invalid_request', error_description: 'Invalid MCP-Protocol-Version header.' };
    }
    if (!transportPolicy.legacySupportedProtocolVersions.includes(value)) {
        return {
            error: 'unsupported_protocol_version',
            error_description: `Unsupported MCP protocol version: ${value}.`,
        };
    }
    return null;
}

/**
 * @param {McpHttpRequest} req
 * @param {ReturnType<typeof import('./config.js').readMcpHttpTransportPolicy>} transportPolicy
 */
export function validateMcpAcceptHeader(req, transportPolicy) {
    if (!transportPolicy.strictAcceptHeaders) return null;
    const method = String(req.method ?? '').toUpperCase();
    if (method !== 'POST' && method !== 'GET') return null;
    const accept = readHeader(req, 'accept') ?? '';
    if (!accept.trim()) {
        return { error: 'not_acceptable', error_description: 'MCP requests must include an Accept header.' };
    }
    if (
        method === 'POST' &&
        (!acceptHeaderSupports(accept, 'application/json') || !acceptHeaderSupports(accept, 'text/event-stream'))
    ) {
        return {
            error: 'not_acceptable',
            error_description: 'MCP POST requests must accept both application/json and text/event-stream.',
        };
    }
    if (method === 'GET' && !acceptHeaderSupports(accept, 'text/event-stream')) {
        return { error: 'not_acceptable', error_description: 'MCP GET requests must accept text/event-stream.' };
    }
    return null;
}

/** @param {string} header */
function contentTypeHeaderSupportsJson(header) {
    const media = header.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    return media === 'application/json' || media.endsWith('+json');
}

/** @param {string} header @param {string} required */
function acceptHeaderSupports(header, required) {
    const [requiredType, requiredSubtype] = required.toLowerCase().split('/');
    for (const item of header.split(',')) {
        const media = item.split(';', 1)[0]?.trim().toLowerCase() ?? '';
        if (!media) continue;
        if (media === '*/*') return true;
        const [type, subtype] = media.split('/');
        if ((type === requiredType || type === '*') && (subtype === requiredSubtype || subtype === '*')) return true;
    }
    return false;
}
