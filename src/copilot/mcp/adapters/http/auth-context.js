// @ts-check
/** Authentication-context projection at the Node/Web HTTP adapter boundary. */

import { parseBearerToken } from '#copilot/mcp/public/auth';
import { readHeader } from './request-identity.js';

/** @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest */

/** @param {McpHttpRequest} req @param {URL} url @returns {import('#copilot/mcp/public/auth').McpAuthContext} */
export function buildAuthContext(req, url) {
    return {
        bearerToken: parseBearerToken(readHeader(req, 'authorization')),
        headers: req.headers,
        method: req.method ?? 'GET',
        url: url.toString(),
    };
}

/** @param {Request | undefined} request @returns {import('#copilot/mcp/public/auth').McpAuthContext} */
export function buildAuthContextFromWebRequest(request) {
    if (!request) return { bearerToken: null };
    return {
        bearerToken: parseBearerToken(request.headers.get('authorization') ?? undefined),
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
    };
}
