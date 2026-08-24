// @ts-check
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
/**
 * Stdio adapter for local MCP clients.
 *
 * @module copilot/mcp/adapters/stdio
 */

import { logMcp } from '#copilot/mcp/public/observability';
import { createCopilotMcpServer } from '#copilot/mcp/public/server';

/**
 * @param {{
 *     processHost?: ReturnType<typeof import('#copilot/mcp/public/process/host').createMcpProcessHost>;
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 * }} options
 */
export async function startStdioMcpServer(options) {
    if (!options?.workspace) throw new TypeError('MCP stdio requires a composition-owned workspace capability.');
    await options.processHost?.prepare();
    const server = createCopilotMcpServer({ workspace: options.workspace });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const lease = options.processHost ? await options.processHost.acquire({ reason: 'stdio-transport' }) : null;
    let closePromise = /** @type {Promise<void> | null} */ (null);
    const close = () => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            const failures = [];
            for (const operation of [() => transport.close(), () => server.close(), () => lease?.release()]) {
                try {
                    await operation();
                } catch (error) {
                    failures.push(error instanceof Error ? error : new Error(String(error)));
                }
            }
            try {
                await options.processHost?.dispose();
            } catch (error) {
                failures.push(error instanceof Error ? error : new Error(String(error)));
            }
            if (failures.length > 0) throw new AggregateError(failures, 'MCP stdio teardown failed.');
        })();
        return closePromise;
    };
    const sdkOnClose = transport.onclose;
    transport.onclose = () => {
        sdkOnClose?.();
        void close().catch((error) => {
            logMcp('ERROR', 'MCP stdio close failed.', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    };
    logMcp('INFO', 'MCP stdio server connected.');
    return Object.freeze({ server, transport, close });
}
