// @ts-check
/**
 * CLI entrypoint for the Copilot MCP server.
 *
 * This file is intentionally separate from index.js so process managers can start
 * a concrete transport without importing legacy startup paths. Stdio bootstrap
 * keeps stdout reserved for JSON-RPC frames; HTTP/1.1 and HTTP/2 return a Node
 * server instance that can be shut down by SIGINT/SIGTERM.
 *
 * @module copilot/mcp/cli
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { logMcp } from '#copilot/mcp/control-plane';
import { enableCopilotNodeCompileCache } from './runtime/node-compile-cache.js';

enableCopilotNodeCompileCache();

const VALID_TRANSPORTS = /** @type {const} */ (['http', 'http2', 'stdio']);
const SHUTDOWN_GRACE_MS = 5000;

/**
 * @typedef {'http' | 'http2' | 'stdio'} McpCliTransport
 * @typedef {import('node:http').Server | import('node:https').Server | import('node:http2').Http2Server | import('node:http2').Http2SecureServer} ClosableMcpServer
 */

/**
 * @param {string[]} argv
 * @returns {McpCliTransport}
 */
export function parseTransport(argv) {
    const explicitTransport = readTransportArgument(argv);
    if (explicitTransport) return normalizeTransport(explicitTransport);
    if (argv.includes('--stdio')) return 'stdio';
    if (argv.includes('--http2') || argv.includes('--h2')) return 'http2';
    if (argv.includes('--http')) return 'http';
    return 'http2';
}

/**
 * @param {string[]} argv
 * @returns {string | null}
 */
function readTransportArgument(argv) {
    const equalsArg = argv.find((arg) => arg.startsWith('--transport='));
    if (equalsArg) return equalsArg.slice('--transport='.length);
    const idx = argv.indexOf('--transport');
    if (idx < 0) return null;
    const value = argv[idx + 1];
    if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --transport. Use http, http2, h2, or stdio.');
    }
    return value;
}

/**
 * @param {string} value
 * @returns {McpCliTransport}
 */
function normalizeTransport(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'h2') return 'http2';
    if (VALID_TRANSPORTS.includes(/** @type {McpCliTransport} */ (normalized))) {
        return /** @type {McpCliTransport} */ (normalized);
    }
    throw new Error(`Invalid MCP transport "${value}". Use http, http2, h2, or stdio.`);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const transport = parseTransport(process.argv.slice(2));
    if (transport === 'stdio') {
        await startStdioTransport();
        return;
    }
    const server = await startHttpTransport(transport);
    installHttpShutdownHandlers(server, transport);
}

/**
 * @returns {Promise<void>}
 */
async function startStdioTransport() {
    const restoreStdout = redirectStdoutDuringBootstrap();
    try {
        const { startStdioMcpServer } = await import('#copilot/mcp/adapters');
        restoreStdout();
        await startStdioMcpServer();
    } catch (error) {
        restoreStdout();
        throw error;
    }
}

/**
 * @param {'http' | 'http2'} transport
 * @returns {Promise<ClosableMcpServer>}
 */
async function startHttpTransport(transport) {
    const adapters = await import('#copilot/mcp/adapters');
    const server = transport === 'http2' ? await adapters.startHttp2McpServer() : await adapters.startHttpMcpServer();
    logMcp('INFO', 'MCP HTTP server started.', { transport });
    return server;
}

/**
 * @param {ClosableMcpServer} server
 * @param {'http' | 'http2'} transport
 * @returns {void}
 */
function installHttpShutdownHandlers(server, transport) {
    let closing = false;
    const shutdown = (/** @type {NodeJS.Signals} */ signal) => {
        if (closing) return;
        closing = true;
        process.exitCode = 0;
        logMcp('INFO', 'Stopping MCP HTTP server.', { transport, signal });
        const timeout = setTimeout(() => {
            logMcp('ERROR', 'Timed out while stopping MCP HTTP server.', { transport, signal, timeoutMs: SHUTDOWN_GRACE_MS });
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        timeout.unref();
        server.close((error) => {
            clearTimeout(timeout);
            if (error) {
                logMcp('ERROR', 'Failed to stop MCP HTTP server cleanly.', {
                    transport,
                    signal,
                    error: error instanceof Error ? error.message : String(error),
                });
                process.exit(1);
            }
            process.exit(0);
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
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

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        logMcp('ERROR', 'Fatal MCP server error.', {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
    });
}
