// @ts-check
/** Sanitized HTTP/MCP telemetry classification at the host-adapter boundary. */

import { MCP_PATH } from './route-policy.js';

/** @param {string} pathname @param {string | undefined} method */
export function classifyMcpHttpRoute(pathname, method) {
    if (pathname === '/' || pathname === '/health') return 'health';
    if (pathname === '/chatgpt-connector.json') return 'connector-profile';
    if (pathname.startsWith('/.well-known/')) return 'oauth-metadata';
    if (pathname === '/oauth/token') return 'oauth-token';
    if (pathname === '/oauth/authorize') return 'oauth-authorize';
    if (pathname === '/oauth/jwks.json') return 'oauth-jwks';
    if (pathname === '/oauth/status') return 'oauth-status';
    if (pathname.startsWith('/oauth/')) return 'oauth-other';
    if (pathname === MCP_PATH) return String(method ?? '').toUpperCase() === 'GET' ? 'mcp-stream' : 'mcp';
    return 'other';
}

/** @param {unknown} body @returns {string | null} */
export function readMcpJsonRpcMethodLabel(body) {
    const messages = Array.isArray(body) ? body : [body];
    const methods = new Set();
    for (const message of messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const method = String(/** @type {Record<string, unknown>} */ (message)['method'] ?? '').trim();
        if (/^[A-Za-z0-9_.:/-]{1,80}$/u.test(method)) methods.add(method);
        else if (method) methods.add('other');
    }
    if (methods.size === 0) return null;
    if (methods.size === 1) return methods.values().next().value ?? null;
    return 'batch:mixed';
}

/** @param {string | null} method @returns {'server-discover' | 'subscriptions-listen' | 'initialize' | 'tools-list' | 'tools-call' | 'other' | 'none'} */
export function classifyMcpCompatibilityRpcClass(method) {
    if (method === null) return 'none';
    if (method === 'server/discover') return 'server-discover';
    if (method === 'subscriptions/listen') return 'subscriptions-listen';
    if (method === 'initialize') return 'initialize';
    if (method === 'tools/list') return 'tools-list';
    if (method === 'tools/call') return 'tools-call';
    return 'other';
}

/**
 * @param {{ httpMethod?: string; rpcMethod: string | null; lastEventIdPresent: boolean }} input
 * @returns {'none' | 'stream-open' | 'stream-resume'}
 */
export function classifyMcpCompatibilityContinuity(input) {
    if (input.lastEventIdPresent) return 'stream-resume';
    if (String(input.httpMethod ?? '').toUpperCase() === 'GET' || input.rpcMethod === 'subscriptions/listen') {
        return 'stream-open';
    }
    return 'none';
}

/** @param {unknown} body @returns {string | null | undefined} */
export function readMcpToolCallName(body) {
    const messages = Array.isArray(body) ? body : [body];
    /** @type {Record<string, unknown>[]} */
    const toolCalls = [];
    for (const message of messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const record = /** @type {Record<string, unknown>} */ (message);
        if (record['method'] === 'tools/call') toolCalls.push(record);
    }
    if (toolCalls.length === 0) return undefined;
    if (toolCalls.length > 1) return 'batch-tools-call';
    const params = toolCalls[0]?.['params'];
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    const name = /** @type {Record<string, unknown>} */ (params)['name'];
    return typeof name === 'string' && name.trim() ? name.trim() : null;
}
