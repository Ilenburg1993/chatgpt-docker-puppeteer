// @ts-check
/**
 * HTTP/1.1 Streamable HTTP adapter for local MCP Inspector and emergency fallback.
 *
 * The canonical remote transport for this project is HTTPS + HTTP/2+ through Cloudflare Tunnel. This HTTP/1.1 adapter
 * remains intentionally supported for local debugging and compatibility only. It shares the same MCP/OAuth route
 * handler as the HTTP/2 adapter and never pre-reads request bodies before delegating to the MCP SDK.
 *
 * Version: 1.0.0
 *
 * @module copilot/mcp/adapters/http
 */

import { logMcp } from '#copilot/mcp/control-plane';
import { createServer } from 'node:http';
import { createMcpHttpProtocolState, recordMcpHttpProtocolRequest } from './http-protocol.js';
import {
    MCP_PATH,
    configureHttp1ServerTiming,
    createMcpHttpRequestHandler,
    notifyMcpHttpStarted,
    readMcpHttpServerTimingPolicy,
    readMcpHttpSessionPolicy,
    readMcpHttpSessionRuntimeState,
} from './http-shared.js';

export { readMcpHttpServerTimingPolicy, readMcpHttpSessionPolicy, readMcpHttpSessionRuntimeState };

export const MCP_HTTP1_ADAPTER_NAME = 'copilot-mcp-http1-adapter';
export const MCP_HTTP1_ADAPTER_VERSION = '1.0.0';

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 3333;
const DEFAULT_HTTP1_MAX_HEADER_SIZE_BYTES = 16 * 1024;
const DEFAULT_HTTP1_MAX_HEADERS_COUNT = 128;
const DEFAULT_HTTP1_MAX_REQUESTS_PER_SOCKET = 500;
const DEFAULT_HTTP1_MAX_CONNECTIONS = 64;
const DEFAULT_HTTP1_KEEP_ALIVE_INITIAL_DELAY_MS = 30_000;
const DEFAULT_HTTP1_CONNECTIONS_CHECKING_INTERVAL_MS = 30_000;
const DEFAULT_HTTP1_SHUTDOWN_DESTROY_AFTER_MS = 3_500;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * @typedef {object} McpHttp1ServerPolicy
 * @property {string} host
 * @property {number} port
 * @property {boolean} loopbackBindRequired
 * @property {boolean} loopbackClientsRequired
 * @property {number} maxConnections
 * @property {number} maxHeaderSizeBytes
 * @property {number} maxHeadersCount
 * @property {number} maxRequestsPerSocket
 * @property {boolean} keepAlive
 * @property {number} keepAliveInitialDelayMs
 * @property {number} connectionsCheckingIntervalMs
 * @property {number} shutdownDestroyAfterMs
 * @property {boolean} insecureHTTPParser
 * @property {boolean} requireHostHeader
 * @property {boolean} joinDuplicateHeaders
 * @property {boolean} noDelay
 * @property {boolean} rejectUpgradeRequests
 * @property {boolean} rejectConnectRequests
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {McpHttp1ServerPolicy}
 */
export function readMcpHttp1ServerPolicy(env = process.env, opts = {}) {
    const host = normalizeHost(opts.host ?? env['COPILOT_MCP_HOST'] ?? DEFAULT_HTTP_HOST);
    const port = normalizePort(opts.port ?? env['COPILOT_MCP_PORT'] ?? DEFAULT_HTTP_PORT, DEFAULT_HTTP_PORT);
    const loopbackBindRequired = !readBooleanEnv(env, 'COPILOT_MCP_HTTP_ALLOW_NON_LOOPBACK_BIND', false);
    const loopbackClientsRequired = !readBooleanEnv(env, 'COPILOT_MCP_HTTP_ALLOW_NON_LOOPBACK_CLIENTS', false);
    return {
        host,
        port,
        loopbackBindRequired,
        loopbackClientsRequired,
        maxConnections: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_MAX_CONNECTIONS',
            DEFAULT_HTTP1_MAX_CONNECTIONS,
            1,
            10_000,
        ),
        maxHeaderSizeBytes: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_MAX_HEADER_SIZE_BYTES',
            DEFAULT_HTTP1_MAX_HEADER_SIZE_BYTES,
            1024,
            128 * 1024,
        ),
        maxHeadersCount: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_MAX_HEADERS_COUNT',
            DEFAULT_HTTP1_MAX_HEADERS_COUNT,
            16,
            2_000,
        ),
        maxRequestsPerSocket: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_MAX_REQUESTS_PER_SOCKET',
            DEFAULT_HTTP1_MAX_REQUESTS_PER_SOCKET,
            1,
            100_000,
        ),
        keepAlive: readBooleanEnv(env, 'COPILOT_MCP_HTTP1_KEEP_ALIVE', true),
        keepAliveInitialDelayMs: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_KEEP_ALIVE_INITIAL_DELAY_MS',
            DEFAULT_HTTP1_KEEP_ALIVE_INITIAL_DELAY_MS,
            0,
            10 * 60 * 1000,
        ),
        connectionsCheckingIntervalMs: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_CONNECTIONS_CHECKING_INTERVAL_MS',
            DEFAULT_HTTP1_CONNECTIONS_CHECKING_INTERVAL_MS,
            1_000,
            10 * 60 * 1000,
        ),
        shutdownDestroyAfterMs: readBoundedIntegerEnv(
            env,
            'COPILOT_MCP_HTTP1_SHUTDOWN_DESTROY_AFTER_MS',
            DEFAULT_HTTP1_SHUTDOWN_DESTROY_AFTER_MS,
            100,
            30_000,
        ),
        insecureHTTPParser: false,
        requireHostHeader: true,
        joinDuplicateHeaders: false,
        noDelay: true,
        rejectUpgradeRequests: readBooleanEnv(env, 'COPILOT_MCP_HTTP1_REJECT_UPGRADE_REQUESTS', true),
        rejectConnectRequests: readBooleanEnv(env, 'COPILOT_MCP_HTTP1_REJECT_CONNECT_REQUESTS', true),
    };
}

/**
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {Promise<import('node:http').Server>}
 */
export async function startHttpMcpServer(opts = {}) {
    const policy = readMcpHttp1ServerPolicy(process.env, opts);
    assertHttp1Policy(policy);
    warnIfHttp1ConflictsWithHttp2ProjectDefault(policy);

    const protocolState = createMcpHttpProtocolState('http1');
    const requestHandler = createMcpHttpRequestHandler({
        host: policy.host,
        port: policy.port,
        protocolState,
        publicScheme: 'http',
    });

    const httpServer = createServer(
        {
            connectionsCheckingInterval: policy.connectionsCheckingIntervalMs,
            headersTimeout: readMcpHttpServerTimingPolicy().headersTimeoutMs,
            insecureHTTPParser: policy.insecureHTTPParser,
            joinDuplicateHeaders: policy.joinDuplicateHeaders,
            keepAlive: policy.keepAlive,
            keepAliveInitialDelay: policy.keepAliveInitialDelayMs,
            maxHeaderSize: policy.maxHeaderSizeBytes,
            noDelay: policy.noDelay,
            requestTimeout: readMcpHttpServerTimingPolicy().requestTimeoutMs,
            requireHostHeader: policy.requireHostHeader,
        },
        async (req, res) => {
            recordMcpHttpProtocolRequest(protocolState, req);
            await requestHandler(req, res);
        },
    );

    httpServer.maxConnections = policy.maxConnections;
    httpServer.maxHeadersCount = policy.maxHeadersCount;
    httpServer.maxRequestsPerSocket = policy.maxRequestsPerSocket;

    installHttp1SocketGuards(httpServer, policy);
    installHttp1ProtocolGuards(httpServer, policy);
    installHttp1GracefulClose(httpServer, policy);

    const timingPolicy = configureHttp1ServerTiming(httpServer);
    await listenHttpServer(httpServer, policy.host, policy.port);
    logMcp('INFO', 'MCP HTTP/1.1 fallback server listening.', {
        adapter: { name: MCP_HTTP1_ADAPTER_NAME, version: MCP_HTTP1_ADAPTER_VERSION },
        url: `http://${formatHostForUrl(policy.host)}:${policy.port}${MCP_PATH}`,
        timingPolicy,
        sessionRuntime: readMcpHttpSessionRuntimeState(),
        policy: sanitizeHttp1PolicyForLog(policy),
        standardTransport: 'https-http2-plus',
    });
    notifyMcpHttpStarted();
    return httpServer;
}

/**
 * @param {McpHttp1ServerPolicy} policy
 * @returns {void}
 */
function assertHttp1Policy(policy) {
    if (policy.loopbackBindRequired && !isLoopbackHost(policy.host)) {
        throw new Error(
            `Refusing to start cleartext MCP HTTP/1.1 on non-loopback host ${policy.host}. ` +
                'The project standard is HTTPS/HTTP2+ via Cloudflare Tunnel. Set COPILOT_MCP_HTTP_ALLOW_NON_LOOPBACK_BIND=true only for an explicit local-network test.',
        );
    }
}

/**
 * @param {McpHttp1ServerPolicy} policy
 * @returns {void}
 */
function warnIfHttp1ConflictsWithHttp2ProjectDefault(policy) {
    const originTransport = String(process.env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '')
        .trim()
        .toLowerCase();
    const cloudflareHttp2Origin = String(process.env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'] ?? '')
        .trim()
        .toLowerCase();
    if (originTransport === 'http2' || cloudflareHttp2Origin === 'true' || cloudflareHttp2Origin === '1') {
        logMcp('WARN', 'Starting HTTP/1.1 MCP fallback while the environment advertises HTTP/2+ origin settings.', {
            adapter: { name: MCP_HTTP1_ADAPTER_NAME, version: MCP_HTTP1_ADAPTER_VERSION },
            host: policy.host,
            port: policy.port,
            originTransport: originTransport || null,
            cloudflareHttp2Origin: cloudflareHttp2Origin || null,
            recommendation:
                'Use startHttp2McpServer for the permanent Cloudflare endpoint; keep HTTP/1.1 for local inspector/fallback only.',
        });
    }
}

/**
 * @param {import('node:http').Server} server
 * @param {McpHttp1ServerPolicy} policy
 * @returns {void}
 */
function installHttp1SocketGuards(server, policy) {
    /** @type {Set<import('node:net').Socket>} */
    const sockets = new Set();
    Object.defineProperty(server, '__mcpHttp1Sockets', {
        value: sockets,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    server.on('connection', (socket) => {
        const remoteAddress = normalizeRemoteAddress(socket.remoteAddress ?? '');
        if (policy.loopbackClientsRequired && !isLoopbackHost(remoteAddress)) {
            logMcp('WARN', 'Rejected non-loopback MCP HTTP/1.1 client connection.', {
                remoteAddress: summarizeAddress(remoteAddress),
                localAddress: summarizeAddress(socket.localAddress ?? ''),
            });
            socket.destroy();
            return;
        }
        sockets.add(socket);
        socket.setNoDelay(policy.noDelay);
        if (policy.keepAlive) socket.setKeepAlive(true, policy.keepAliveInitialDelayMs);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', (error) => {
            logMcp('WARN', 'MCP HTTP/1.1 socket error.', {
                remoteAddress: summarizeAddress(remoteAddress),
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });
}

/**
 * @param {import('node:http').Server} server
 * @param {McpHttp1ServerPolicy} policy
 * @returns {void}
 */
function installHttp1ProtocolGuards(server, policy) {
    server.on('clientError', (error, socket) => {
        const netSocket = /** @type {import('node:net').Socket} */ (socket);
        logMcp('WARN', 'MCP HTTP/1.1 client protocol error.', {
            code: /** @type {{ code?: unknown }} */ (error).code ?? null,
            message: error instanceof Error ? error.message : String(error),
            remoteAddress: summarizeAddress(netSocket.remoteAddress ?? ''),
        });
        if (!netSocket.destroyed) {
            netSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        }
    });

    server.on('dropRequest', (req, socket) => {
        const netSocket = /** @type {import('node:net').Socket} */ (socket);
        logMcp('WARN', 'MCP HTTP/1.1 request dropped after maxRequestsPerSocket.', {
            method: req.method ?? null,
            url: summarizeUrlPath(req.url ?? ''),
            remoteAddress: summarizeAddress(netSocket.remoteAddress ?? ''),
            maxRequestsPerSocket: policy.maxRequestsPerSocket,
        });
    });

    if (policy.rejectUpgradeRequests) {
        server.on('upgrade', (req, socket) => {
            const netSocket = /** @type {import('node:net').Socket} */ (socket);
            logMcp('WARN', 'Rejected unsupported MCP HTTP/1.1 upgrade request.', {
                method: req.method ?? null,
                url: summarizeUrlPath(req.url ?? ''),
                remoteAddress: summarizeAddress(netSocket.remoteAddress ?? ''),
            });
            if (!netSocket.destroyed) {
                netSocket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            }
        });
    }

    if (policy.rejectConnectRequests) {
        server.on('connect', (req, socket) => {
            const netSocket = /** @type {import('node:net').Socket} */ (socket);
            logMcp('WARN', 'Rejected unsupported MCP HTTP/1.1 CONNECT request.', {
                url: summarizeUrlPath(req.url ?? ''),
                remoteAddress: summarizeAddress(netSocket.remoteAddress ?? ''),
            });
            if (!netSocket.destroyed) {
                netSocket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            }
        });
    }
}

/**
 * Patch server.close so the existing CLI shutdown path also reaps idle sockets and eventually destroys active fallback
 * sockets before the process-manager grace timeout expires.
 *
 * @param {import('node:http').Server} server
 * @param {McpHttp1ServerPolicy} policy
 * @returns {void}
 */
function installHttp1GracefulClose(server, policy) {
    const originalClose = server.close.bind(server);
    let closing = false;
    server.close = /** @type {typeof server.close} */ (
        (callback) => {
            if (closing) return originalClose(callback);
            closing = true;
            logMcp('INFO', 'Closing MCP HTTP/1.1 fallback server.', {
                adapter: { name: MCP_HTTP1_ADAPTER_NAME, version: MCP_HTTP1_ADAPTER_VERSION },
                shutdownDestroyAfterMs: policy.shutdownDestroyAfterMs,
            });
            const destroyTimer = setTimeout(() => {
                const destroyed = destroyTrackedSockets(server);
                logMcp(destroyed > 0 ? 'WARN' : 'INFO', 'MCP HTTP/1.1 shutdown destroy sweep completed.', {
                    destroyedSockets: destroyed,
                    shutdownDestroyAfterMs: policy.shutdownDestroyAfterMs,
                });
            }, policy.shutdownDestroyAfterMs);
            destroyTimer.unref();

            const wrappedCallback = (/** @type {Error | undefined} */ error) => {
                clearTimeout(destroyTimer);
                if (typeof callback === 'function') callback(error);
            };

            const result = originalClose(wrappedCallback);
            if (typeof server.closeIdleConnections === 'function') {
                server.closeIdleConnections();
            }
            return result;
        }
    );
}

/**
 * @param {import('node:http').Server} server
 * @returns {number}
 */
function destroyTrackedSockets(server) {
    const runtimeServer = /** @type {import('node:http').Server & { __mcpHttp1Sockets?: Set<import('node:net').Socket> }} */ (server);
    const sockets = runtimeServer.__mcpHttp1Sockets;
    let destroyed = 0;
    if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
    }
    if (sockets) {
        for (const socket of sockets) {
            if (!socket.destroyed) {
                socket.destroy();
                destroyed += 1;
            }
        }
    }
    return destroyed;
}

/**
 * @param {import('node:http').Server} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenHttpServer(server, host, port) {
    return new Promise((resolve, reject) => {
        /** @param {Error} error */
        const onError = (error) => {
            server.off('listening', onListening);
            reject(
                new Error(
                    `Cannot start MCP HTTP/1.1 server on ${host}:${port}. Is another MCP HTTP server already running? Cause: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

/**
 * @param {McpHttp1ServerPolicy} policy
 * @returns {Record<string, unknown>}
 */
function sanitizeHttp1PolicyForLog(policy) {
    return {
        host: policy.host,
        port: policy.port,
        loopbackBindRequired: policy.loopbackBindRequired,
        loopbackClientsRequired: policy.loopbackClientsRequired,
        maxConnections: policy.maxConnections,
        maxHeaderSizeBytes: policy.maxHeaderSizeBytes,
        maxHeadersCount: policy.maxHeadersCount,
        maxRequestsPerSocket: policy.maxRequestsPerSocket,
        keepAlive: policy.keepAlive,
        keepAliveInitialDelayMs: policy.keepAliveInitialDelayMs,
        connectionsCheckingIntervalMs: policy.connectionsCheckingIntervalMs,
        shutdownDestroyAfterMs: policy.shutdownDestroyAfterMs,
        insecureHTTPParser: policy.insecureHTTPParser,
        requireHostHeader: policy.requireHostHeader,
        joinDuplicateHeaders: policy.joinDuplicateHeaders,
        noDelay: policy.noDelay,
        rejectUpgradeRequests: policy.rejectUpgradeRequests,
        rejectConnectRequests: policy.rejectConnectRequests,
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHost(value) {
    const host = String(value ?? DEFAULT_HTTP_HOST).trim();
    if (!host) return DEFAULT_HTTP_HOST;
    if (host.includes('\0') || /\s/u.test(host) || host.length > 255) {
        throw new Error('MCP HTTP/1.1 host must be a valid hostname or IP address.');
    }
    return host.replace(/^\[/u, '').replace(/\]$/u, '');
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePort(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) return fallback;
    return Math.floor(parsed);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readBoundedIntegerEnv(env, name, fallback, minimum, maximum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(env, name, fallback) {
    const raw = String(env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRemoteAddress(value) {
    return String(value ?? '')
        .trim()
        .replace(/^::ffff:/u, '');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isLoopbackHost(value) {
    const normalized = normalizeRemoteAddress(value)
        .toLowerCase()
        .replace(/^\[/u, '')
        .replace(/\]$/u, '')
        .replace(/\.$/u, '');
    return (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized === '127.0.0.1' ||
        normalized === '::1'
    );
}

/**
 * @param {string} host
 * @returns {string}
 */
function formatHostForUrl(host) {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * @param {string} value
 * @returns {string}
 */
function summarizeAddress(value) {
    const normalized = normalizeRemoteAddress(value);
    if (!normalized) return '';
    if (isLoopbackHost(normalized)) return normalized;
    const [first, second = '', third = ''] = normalized.split('.');
    return third ? `${first}.${second}.${third}.<redacted>` : '<redacted>';
}

/**
 * @param {string} value
 * @returns {string}
 */
function summarizeUrlPath(value) {
    try {
        return new URL(value, 'http://localhost').pathname.slice(0, 160);
    } catch {
        return String(value ?? '').slice(0, 160);
    }
}
