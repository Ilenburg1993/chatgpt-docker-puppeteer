// @ts-check
/**
 * CLI entrypoint for the Copilot MCP server.
 *
 * This file is intentionally separate from index.js so process managers can start a concrete transport without
 * importing legacy startup paths. Stdio bootstrap keeps stdout reserved for JSON-RPC frames; HTTP/1.1 and HTTP/2 return
 * a Node server instance that can be shut down by SIGINT/SIGTERM.
 *
 * @module copilot/mcp/cli
 */

import {
    enableCopilotNodeCompileCache,
    flushCopilotNodeCompileCache,
    readCopilotNodeCompileCacheConfig,
} from '#copilot/infra/public/platform/node';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

enableCopilotNodeCompileCache(readCopilotNodeCompileCacheConfig(process.env));

/** @typedef {typeof import('#copilot/mcp/public/observability').logMcp} McpLogger */
/** @type {McpLogger | null} */
let cachedLogMcp = null;

/** @returns {Promise<McpLogger>} */
async function getLogMcp() {
    if (cachedLogMcp) return cachedLogMcp;
    const observability = await import('#copilot/mcp/public/observability');
    const logger = observability.logMcp;
    cachedLogMcp = logger;
    return logger;
}

const VALID_TRANSPORTS = /** @type {const} */ (['http', 'http2', 'stdio']);
const SHUTDOWN_GRACE_MS = 5000;

/**
 * @typedef {'http' | 'http2' | 'stdio'} McpCliTransport
 *
 * @typedef {import('node:http').Server
 *     | import('node:https').Server
 *     | import('node:http2').Http2Server
 *     | import('node:http2').Http2SecureServer} ClosableMcpServer
 * @typedef {ReturnType<typeof import('#copilot/mcp/public/composition/process-host').createComposedMcpProcessHost>} CliMcpProcessHost
 * @typedef {{ server: ClosableMcpServer; processHost: CliMcpProcessHost }} McpHttpRuntime
 * @typedef {Awaited<ReturnType<typeof import('#copilot/mcp/public/adapters/stdio').startStdioMcpServer>>} McpStdioRuntime
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
    const logMcp = await getLogMcp();
    if (transport === 'stdio') {
        await startStdioTransport(logMcp);
        return;
    }
    const runtime = await startHttpTransport(transport, logMcp);
    installHttpShutdownHandlers(runtime, transport, logMcp);
}

/**
 * @param {McpLogger} logMcp
 * @returns {Promise<void>}
 */
async function startStdioTransport(logMcp) {
    const restoreStdout = redirectStdoutDuringBootstrap();
    const { createComposedMcpProcessHost } = await import('#copilot/mcp/public/composition/process-host');
    const processHost = createComposedMcpProcessHost({ hostId: 'mcp-stdio-process-host' });
    try {
        const { startStdioMcpServer } = await import('#copilot/mcp/public/adapters/stdio');
        await processHost.prepare();
        flushCopilotNodeCompileCache();
        restoreStdout();
        const runtime = await startStdioMcpServer({ processHost, workspace: processHost.workspace });
        installStdioShutdownHandlers(runtime, logMcp);
    } catch (error) {
        restoreStdout();
        await processHost.dispose().catch(() => undefined);
        throw error;
    }
}

/**
 * @param {'http' | 'http2'} transport
 * @param {McpLogger} logMcp
 * @returns {Promise<McpHttpRuntime>}
 */
async function startHttpTransport(transport, logMcp) {
    const [{ createComposedMcpProcessHost, readComposedMcpSqliteDatabase }, startServer] = await Promise.all([
        import('#copilot/mcp/public/composition/process-host'),
        transport === 'http2'
            ? import('#copilot/mcp/public/adapters/http2').then((module) => module.startHttp2McpServer)
            : import('#copilot/mcp/public/adapters/http1').then((module) => module.startHttpMcpServer),
    ]);
    const processHost = createComposedMcpProcessHost({ hostId: `mcp-${transport}-process-host` });
    try {
        await processHost.prepare();
        const database = readComposedMcpSqliteDatabase();
        const adapterOptions = {
            processHost,
            workspace: processHost.workspace,
            ...(database ? { database } : {}),
        };
        const server = await startServer(adapterOptions);
        flushCopilotNodeCompileCache();
        logMcp('INFO', 'MCP HTTP server started.', {
            transport,
            processHost: processHost.snapshot(),
        });
        return { server, processHost };
    } catch (error) {
        await processHost.dispose().catch((disposeError) => {
            logMcp('ERROR', 'MCP process host cleanup failed after HTTP startup failure.', {
                transport,
                error: disposeError instanceof Error ? disposeError.message : String(disposeError),
            });
        });
        throw error;
    }
}

/**
 * @param {McpStdioRuntime} runtime
 * @param {McpLogger} logMcp
 */
function installStdioShutdownHandlers(runtime, logMcp) {
    let closing = false;
    const shutdown = (/** @type {NodeJS.Signals} */ signal) => {
        if (closing) return;
        closing = true;
        process.exitCode = 0;
        logMcp('INFO', 'Stopping MCP stdio server.', { signal });
        const timeout = setTimeout(() => {
            logMcp('ERROR', 'Timed out while stopping MCP stdio server.', {
                signal,
                timeoutMs: SHUTDOWN_GRACE_MS,
            });
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        timeout.unref();
        void runtime
            .close()
            .then(() => {
                clearTimeout(timeout);
                logMcp('INFO', 'MCP stdio server and process host stopped cleanly.', { signal });
                process.exit(0);
            })
            .catch((error) => {
                clearTimeout(timeout);
                logMcp('ERROR', 'MCP stdio teardown failed.', {
                    signal,
                    error: error instanceof Error ? error.message : String(error),
                });
                process.exit(1);
            });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

/**
 * @param {McpHttpRuntime} runtime
 * @param {'http' | 'http2'} transport
 * @param {McpLogger} logMcp
 * @returns {void}
 */
function installHttpShutdownHandlers(runtime, transport, logMcp) {
    const { server, processHost } = runtime;
    let closing = false;
    const shutdown = (/** @type {NodeJS.Signals} */ signal) => {
        if (closing) return;
        closing = true;
        process.exitCode = 0;
        logMcp('INFO', 'Stopping MCP HTTP server.', { transport, signal });
        const timeout = setTimeout(() => {
            logMcp('ERROR', 'Timed out while stopping MCP HTTP server.', {
                transport,
                signal,
                timeoutMs: SHUTDOWN_GRACE_MS,
            });
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        timeout.unref();
        server.close((error) => {
            void (async () => {
                clearTimeout(timeout);
                if (error) {
                    logMcp('ERROR', 'Failed to stop MCP HTTP server cleanly.', {
                        transport,
                        signal,
                        error: error instanceof Error ? error.message : String(error),
                        processHost: processHost.snapshot(),
                    });
                    process.exit(1);
                }
                try {
                    await processHost.dispose();
                    logMcp('INFO', 'MCP HTTP server and process host stopped cleanly.', {
                        transport,
                        signal,
                        processHost: processHost.snapshot(),
                    });
                    process.exit(0);
                } catch (disposeError) {
                    logMcp('ERROR', 'MCP process host failed to reach terminal disposal.', {
                        transport,
                        signal,
                        error: disposeError instanceof Error ? disposeError.message : String(disposeError),
                        processHost: processHost.snapshot(),
                    });
                    process.exit(1);
                }
            })();
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

/**
 * Some legacy startup paths still write diagnostics to stdout while modules are imported. Stdio MCP reserves stdout for
 * JSON-RPC frames, so bootstrap noise is redirected to stderr until the transport takes ownership of stdout.
 *
 * @returns {() => void}
 */
function redirectStdoutDuringBootstrap() {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = /** @type {typeof process.stdout.write} */ (
        (chunk, encoding, callback) => {
            return process.stderr.write(chunk, encoding, callback);
        }
    );
    return () => {
        process.stdout.write = originalWrite;
    };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch(async (error) => {
        try {
            const logMcp = await getLogMcp();
            logMcp('ERROR', 'Fatal MCP server error.', {
                error: error instanceof Error ? error.message : String(error),
            });
        } catch {
            process.stderr.write(`[mcp:fatal] ${error instanceof Error ? error.message : String(error)}\n`);
        }
        process.exitCode = 1;
    });
}
