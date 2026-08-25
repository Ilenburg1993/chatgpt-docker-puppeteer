// @ts-check
/**
 * Pure MCP stateful request/session contract classification.
 *
 * This module owns no HTTP body I/O and no Node host mechanics. It classifies an already-parsed MCP request against
 * the stateful Streamable HTTP session contract.
 *
 * @module copilot/mcp/transport/http/stateful/request-contract
 */

import { isInitializeRequest } from '@modelcontextprotocol/server';

/**
 * @typedef {{ error: string; error_description: string }} McpStatefulRequestContractError
 *
 * @typedef {{
 *           ok: true;
 *           kind: 'not-post' | 'initialize' | 'session-bound';
 *           sessionId: string | null;
 *           initializeRequest: boolean;
 *       }
 *     | {
 *           ok: false;
 *           statusCode: 400;
 *           error: McpStatefulRequestContractError;
 *           kind: 'missing-session' | 'initialize-with-session';
 *           sessionId: string | null;
 *           initializeRequest: boolean;
 *       }} McpPostSessionClassification
 */

/**
 * @param {{ method?: string | null; sessionId?: string | null; body: unknown }} input
 * @returns {McpPostSessionClassification}
 */
export function classifyMcpPostSessionRequirement(input) {
    const method = String(input.method ?? '').toUpperCase();
    const sessionId = normalizeMcpSessionId(input.sessionId);
    const initializeRequest = isMcpInitializeRequestBody(input.body);

    if (method !== 'POST') return { ok: true, kind: 'not-post', sessionId, initializeRequest };
    if (!sessionId && initializeRequest) return { ok: true, kind: 'initialize', sessionId, initializeRequest };
    if (sessionId && !initializeRequest) return { ok: true, kind: 'session-bound', sessionId, initializeRequest };
    if (sessionId && initializeRequest) {
        return {
            ok: false,
            statusCode: 400,
            kind: 'initialize-with-session',
            sessionId,
            initializeRequest,
            error: {
                error: 'invalid_request',
                error_description: 'MCP initialize requests must not include an existing session ID.',
            },
        };
    }
    return {
        ok: false,
        statusCode: 400,
        kind: 'missing-session',
        sessionId,
        initializeRequest,
        error: {
            error: 'invalid_request',
            error_description: 'MCP POST requests without a session ID must be initialize requests.',
        },
    };
}

/** @param {unknown} body @returns {boolean} */
export function isMcpInitializeRequestBody(body) {
    try {
        return isInitializeRequest(body);
    } catch {
        return false;
    }
}

/** @param {string | null | undefined} value @returns {string | null} */
export function normalizeMcpSessionId(value) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
}
