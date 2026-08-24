// @ts-check
/**
 * Strict MCP 2026-07-28 HTTP handler owner.
 *
 * This module deliberately owns only the modern MCP wire entry. Authentication, Origin/Host
 * validation, rate limiting and Node server composition remain outside and must be completed before
 * exposing this handler on a public socket. Legacy 2025 traffic is rejected here so a composition
 * root can route it to an evidence-backed compatibility adapter without contaminating modern code.
 *
 * @module copilot/mcp/transport/http/modern/handler
 */

import { createMcpHandler } from '@modelcontextprotocol/server';

export const MCP_MODERN_HTTP_HANDLER_VERSION = '1.0.0';

/**
 * @typedef {{
 *     responseMode?: 'auto' | 'json' | 'sse';
 *     keepAliveMs?: number;
 *     maxSubscriptions?: number;
 *     onerror?: (error: Error) => void;
 * }} McpModernHttpHandlerOptions
 */

/**
 * Create the strict 2026 HTTP handler from an injected server factory.
 *
 * The factory remains outside this owner so transport code does not reach upward into application
 * composition. `legacy: 'reject'` is intentional: user-land composition decides whether a real
 * legacy consumer warrants routing to a separate compatibility owner.
 *
 * @param {import('@modelcontextprotocol/server').McpServerFactory} factory
 * @param {McpModernHttpHandlerOptions} [options]
 * @returns {import('@modelcontextprotocol/server').McpHttpHandler}
 */
export function createMcpModernHttpHandler(factory, options = {}) {
    return createMcpHandler(factory, {
        legacy: 'reject',
        responseMode: options.responseMode ?? 'auto',
        ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
        ...(options.maxSubscriptions === undefined ? {} : { maxSubscriptions: options.maxSubscriptions }),
        ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
    });
}
