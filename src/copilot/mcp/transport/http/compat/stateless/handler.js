// @ts-check
/**
 * Request-scoped stateless compatibility transport for MCP 2025-family HTTP requests.
 *
 * The host adapter supplies an already-projected auth/workspace server configuration. This owner is responsible only
 * for the compatibility transport lifecycle: connect, dispatch, and deterministic close of both SDK transport and
 * request-scoped MCP server.
 *
 * @module copilot/mcp/transport/http/compat/stateless/handler
 */

import { logMcp } from '#copilot/mcp/public/observability';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

/**
 * @param {{
 *     req: import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest;
 *     res: import('node:http').ServerResponse | import('node:http2').Http2ServerResponse;
 *     parsedMcpBody?: unknown;
 *     createServer: () => ReturnType<typeof import('#copilot/mcp/public/server').createCopilotMcpServer>;
 * }} options
 * @returns {Promise<void>}
 */
export async function handleMcpStatelessCompatibilityRequest(options) {
    const server = options.createServer();
    const transport = new NodeStreamableHTTPServerTransport(
        /** @type {import('@modelcontextprotocol/node').StreamableHTTPServerTransportOptions} */ (
            /** @type {unknown} */ ({ sessionIdGenerator: undefined, enableJsonResponse: true })
        ),
    );
    /** @type {Promise<void> | null} */
    let closePromise = null;
    const closeOnce = () => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            const results = await Promise.allSettled([transport.close(), server.close()]);
            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length > 0) {
                logMcp('ERROR', 'MCP stateless compatibility request resource close failed.', {
                    closeFailureCount: failures.length,
                });
            }
        })();
        return closePromise;
    };
    const observeResponseClose = () => {
        void closeOnce();
    };
    options.res.once('close', observeResponseClose);
    try {
        await server.connect(/** @type {import('@modelcontextprotocol/server').Transport} */ (transport));
        const req = /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (options.req));
        const res = /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (options.res));
        if (options.parsedMcpBody === undefined) {
            await transport.handleRequest(req, res);
        } else {
            await transport.handleRequest(req, res, options.parsedMcpBody);
        }
    } finally {
        if (options.res.writableEnded) await closeOnce();
    }
}
