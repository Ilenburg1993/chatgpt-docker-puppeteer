// @ts-check
/**
 * CLI entrypoint for the Copilot MCP server.
 *
 * @module copilot/mcp/cli
 */

import { logMcp } from '#copilot/mcp/control-plane';

/**
 * @param {string[]} argv
 * @returns {'http' | 'http2' | 'stdio'}
 */
function parseTransport(argv) {
    const idx = argv.indexOf('--transport');
    const value = idx >= 0 ? argv[idx + 1] : undefined;
    if (value === 'stdio' || value === 'http' || value === 'http2' || value === 'h2') {
        return value === 'h2' ? 'http2' : value;
    }
    if (argv.includes('--stdio')) return 'stdio';
    if (argv.includes('--http2') || argv.includes('--h2')) return 'http2';
    return 'http';
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const transport = parseTransport(process.argv.slice(2));
    if (transport === 'stdio') {
        const restoreStdout = redirectStdoutDuringBootstrap();
        const { startStdioMcpServer } = await import('#copilot/mcp/adapters');
        restoreStdout();
        await startStdioMcpServer();
        return;
    }
    const server =
        transport === 'http2'
            ? await import('#copilot/mcp/adapters').then((module) => module.startHttp2McpServer())
            : await import('#copilot/mcp/adapters').then((module) => module.startHttpMcpServer());
    const shutdown = () => {
        logMcp('INFO', 'Stopping MCP HTTP server.', { transport });
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

/**
 * Some legacy startup paths still write diagnostics to stdout while modules are
 * imported. Stdio MCP reserves stdout for JSON-RPC frames, so bootstrap noise is
 * redirected to stderr until the transport takes ownership of stdout.
 *
 * @returns {() => void}
 */
function redirectStdoutDuringBootstrap() {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((chunk, encoding, callback) => {
        return process.stderr.write(chunk, encoding, callback);
    });
    return () => {
        process.stdout.write = originalWrite;
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        logMcp('ERROR', 'Fatal MCP server error.', {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
    });
}
