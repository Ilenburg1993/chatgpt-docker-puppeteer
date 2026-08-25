// @ts-check
/**
 * Hardened HTTPS + HTTP/2 Streamable HTTP adapter for the Copilot MCP endpoint.
 *
 * This adapter is intentionally small at the application layer: MCP/OAuth request routing is delegated to the cohesive
 * http/handler.js assembly, while this module owns the TLS/HTTP/2 transport envelope, origin safety, graceful shutdown, and
 * protocol-level hardening needed for Cloudflare Tunnel http2Origin.
 *
 * Version: 1.1.0
 *
 * @module copilot/mcp/adapters/http2
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { logMcp } from '#copilot/mcp/public/observability';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { createSecureServer, constants as http2Constants } from 'node:http2';
import { isIP } from 'node:net';
import { createMcpHttpProtocolState, recordMcpHttpProtocolRequest } from './http-protocol.js';
import { readMcpHttpServerTimingPolicy } from './http/config.js';
import { createMcpHttpRequestHandler } from './http/handler.js';
import { MCP_PATH } from './http/route-policy.js';
import { applyHttp2ServerTimingPolicy } from './http/server-timing.js';

export const MCP_HTTP2_ADAPTER_NAME = 'copilot-mcp-http2-adapter';
export const MCP_HTTP2_ADAPTER_VERSION = '1.1.0';

const DEFAULT_HTTP2_CERT_FILE = 'src/copilot/.ai/cloudflare/origin-cert.pem';
const DEFAULT_HTTP2_KEY_FILE = 'src/copilot/.ai/cloudflare/origin-key.pem';
const DEFAULT_HTTP2_HOST = '127.0.0.1';
const DEFAULT_HTTP2_PORT = 3333;
const DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS = 50;
const DEFAULT_HTTP2_MAX_SESSIONS = 32;
const DEFAULT_HTTP2_MAX_SESSION_MEMORY_MB = 16;
const DEFAULT_HTTP2_MAX_HEADER_LIST_PAIRS = 64;
const DEFAULT_HTTP2_MAX_SEND_HEADER_BLOCK_LENGTH = 32 * 1024;
const DEFAULT_HTTP2_MAX_SETTINGS = 32;
const DEFAULT_HTTP2_MAX_OUTSTANDING_PINGS = 10;
const DEFAULT_HTTP2_MAX_SESSION_INVALID_FRAMES = 100;
const DEFAULT_HTTP2_MAX_SESSION_REJECTED_STREAMS = 25;
const DEFAULT_HTTP2_STREAM_RESET_BURST = 100;
const DEFAULT_HTTP2_STREAM_RESET_RATE = 33;
const DEFAULT_HTTP2_UNKNOWN_PROTOCOL_TIMEOUT_MS = 2_000;
const DEFAULT_HTTP2_SHUTDOWN_DESTROY_AFTER_MS = 3_500;
// Cloudflared owns the persistent H2 origin pool. Zero disables origin-side idle GOAWAY by default.
const DEFAULT_HTTP2_SESSION_IDLE_TIMEOUT_MS = 0;
const DEFAULT_HTTP2_CERT_EXPIRY_WARN_DAYS = 14;
const DEFAULT_TLS_MIN_VERSION = /** @type {import('node:tls').SecureVersion} */ ('TLSv1.2');
const MAX_TLS_FILE_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);
const PRIVATE_KEY_BEGIN_PATTERN = /^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/u;
const PRIVATE_KEY_END_PATTERN = /-----END (?:RSA |EC )?PRIVATE KEY-----\s*$/u;
const ENCRYPTED_PRIVATE_KEY_PATTERN = /^-----BEGIN ENCRYPTED PRIVATE KEY-----/u;

/**
 * @typedef {object} McpHttp2ServerPolicy
 * @property {string} certFile
 * @property {string} keyFile
 * @property {boolean} allowHTTP1
 * @property {number} maxConcurrentStreams
 * @property {number} maxSessions
 * @property {number} maxSessionMemoryMb
 * @property {number} maxHeaderListPairs
 * @property {number} maxSendHeaderBlockLength
 * @property {number} maxSettings
 * @property {number} maxOutstandingPings
 * @property {number} maxSessionInvalidFrames
 * @property {number} maxSessionRejectedStreams
 * @property {number} streamResetBurst
 * @property {number} streamResetRate
 * @property {number} unknownProtocolTimeoutMs
 * @property {number} shutdownDestroyAfterMs
 * @property {number} sessionIdleTimeoutMs
 * @property {string[]} expectedCertificateHostnames
 * @property {boolean} allowCertificateHostnameMismatch
 * @property {number} certificateExpiryWarnDays
 * @property {boolean} allowNonLoopbackBind
 * @property {boolean} allowNonLoopbackClients
 * @property {import('node:tls').SecureVersion} minVersion
 */

/**
 * @typedef {import('node:http2').Http2SecureServer & {
 *     closeGracefully?: (callback?: (error?: Error) => void) => void;
 *     mcpHttp2Runtime?: McpHttp2RuntimeState;
 * }} McpHttp2SecureServer
 *
 *
 * @typedef {{
 *     activeSessions: Set<import('node:http2').ServerHttp2Session>;
 *     closing: boolean;
 *     closed: boolean;
 *     closeCallbacks: ((error?: Error) => void)[];
 *     terminalError: Error | null;
 *     createdAt: number;
 *     acceptedSessions: number;
 *     rejectedSessions: number;
 *     sessionErrors: number;
 *     streamErrors: number;
 *     unknownProtocolEvents: number;
 *     tlsClientErrors: number;
 * }} McpHttp2RuntimeState
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttp2ServerPolicy}
 */
export function readMcpHttp2ServerPolicy(env = process.env) {
    return {
        certFile: normalizeRequiredPath(env['COPILOT_MCP_HTTP2_CERT_FILE'], DEFAULT_HTTP2_CERT_FILE),
        keyFile: normalizeRequiredPath(env['COPILOT_MCP_HTTP2_KEY_FILE'], DEFAULT_HTTP2_KEY_FILE),
        allowHTTP1: normalizeBooleanEnv(env['COPILOT_MCP_HTTP2_ALLOW_HTTP1'], true),
        maxConcurrentStreams: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_CONCURRENT_STREAMS',
            DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS,
            1,
            1000,
        ),
        maxSessions: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP2_MAX_SESSIONS', DEFAULT_HTTP2_MAX_SESSIONS, 1, 500),
        maxSessionMemoryMb: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_SESSION_MEMORY_MB',
            DEFAULT_HTTP2_MAX_SESSION_MEMORY_MB,
            1,
            256,
        ),
        maxHeaderListPairs: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_HEADER_LIST_PAIRS',
            DEFAULT_HTTP2_MAX_HEADER_LIST_PAIRS,
            4,
            512,
        ),
        maxSendHeaderBlockLength: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_SEND_HEADER_BLOCK_LENGTH',
            DEFAULT_HTTP2_MAX_SEND_HEADER_BLOCK_LENGTH,
            4096,
            256 * 1024,
        ),
        maxSettings: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP2_MAX_SETTINGS', DEFAULT_HTTP2_MAX_SETTINGS, 1, 128),
        maxOutstandingPings: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_OUTSTANDING_PINGS',
            DEFAULT_HTTP2_MAX_OUTSTANDING_PINGS,
            1,
            64,
        ),
        maxSessionInvalidFrames: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_SESSION_INVALID_FRAMES',
            DEFAULT_HTTP2_MAX_SESSION_INVALID_FRAMES,
            1,
            1000,
        ),
        maxSessionRejectedStreams: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_SESSION_REJECTED_STREAMS',
            DEFAULT_HTTP2_MAX_SESSION_REJECTED_STREAMS,
            1,
            1000,
        ),
        streamResetBurst: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_STREAM_RESET_BURST',
            DEFAULT_HTTP2_STREAM_RESET_BURST,
            1,
            5000,
        ),
        streamResetRate: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_STREAM_RESET_RATE',
            DEFAULT_HTTP2_STREAM_RESET_RATE,
            1,
            1000,
        ),
        unknownProtocolTimeoutMs: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_UNKNOWN_PROTOCOL_TIMEOUT_MS',
            DEFAULT_HTTP2_UNKNOWN_PROTOCOL_TIMEOUT_MS,
            100,
            60_000,
        ),
        shutdownDestroyAfterMs: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_SHUTDOWN_DESTROY_AFTER_MS',
            DEFAULT_HTTP2_SHUTDOWN_DESTROY_AFTER_MS,
            250,
            30_000,
        ),
        sessionIdleTimeoutMs: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_SESSION_IDLE_TIMEOUT_MS',
            DEFAULT_HTTP2_SESSION_IDLE_TIMEOUT_MS,
            0,
            10 * 60 * 1000,
        ),
        expectedCertificateHostnames: readExpectedCertificateHostnames(env),
        allowCertificateHostnameMismatch: normalizeBooleanEnv(
            env['COPILOT_MCP_HTTP2_ALLOW_CERT_HOSTNAME_MISMATCH'],
            false,
        ),
        certificateExpiryWarnDays: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_CERT_EXPIRY_WARN_DAYS',
            DEFAULT_HTTP2_CERT_EXPIRY_WARN_DAYS,
            1,
            365,
        ),
        allowNonLoopbackBind: normalizeBooleanEnv(env['COPILOT_MCP_HTTP2_ALLOW_NON_LOOPBACK_BIND'], false),
        allowNonLoopbackClients: normalizeBooleanEnv(env['COPILOT_MCP_HTTP2_ALLOW_NON_LOOPBACK_CLIENTS'], false),
        minVersion: normalizeTlsMinVersion(env['COPILOT_MCP_HTTP2_TLS_MIN_VERSION']),
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ host: string; port: number; policy: McpHttp2ServerPolicy }}
 */
export function readMcpHttp2ListenerConfig(env = process.env) {
    return {
        host: normalizeListenHost(env['COPILOT_MCP_HOST'] ?? DEFAULT_HTTP2_HOST),
        port: normalizeListenPort(Number(env['COPILOT_MCP_PORT'] ?? DEFAULT_HTTP2_PORT)),
        policy: readMcpHttp2ServerPolicy(env),
    };
}

/**
 * @typedef {{
 *     host?: string;
 *     port?: number;
 *     processHost?: ReturnType<typeof import('#copilot/mcp/public/process/host').createMcpProcessHost> & { toolCapabilities?: import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection; authRuntime?: ReturnType<typeof import('#copilot/mcp/public/composition/process-host').createComposedMcpProcessHost>['authRuntime'] };
 *     database?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     workspace?: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     processConfig?: NonNullable<Parameters<typeof createMcpHttpRequestHandler>[0]>['processConfig'];
 *     policy?: McpHttp2ServerPolicy;
 * }} McpHttp2StartOptions
 */

/**
 * @param {McpHttp2StartOptions} opts
 * @returns {import('#copilot/mcp/public/workspace').McpWorkspaceCapability}
 */
function requireHttp2WorkspaceCapability(opts) {
    const processHostWorkspace =
        /** @type {{ workspace?: import('#copilot/mcp/public/workspace').McpWorkspaceCapability } | undefined} */ (
            opts.processHost
        )?.workspace;
    if (opts.workspace && processHostWorkspace && opts.workspace !== processHostWorkspace) {
        throw new TypeError('MCP HTTP/2 received divergent workspace capabilities.');
    }
    const workspace = opts.workspace ?? processHostWorkspace;
    if (!workspace) throw new TypeError('MCP HTTP/2 requires a composition-owned workspace capability.');
    return workspace;
}

/**
 * @param {McpHttp2StartOptions} [opts]
 * @returns {Promise<McpHttp2SecureServer>}
 */
export async function startHttp2McpServer(opts = {}) {
    const workspace = requireHttp2WorkspaceCapability(opts);
    const host = normalizeListenHost(opts.host ?? process.env['COPILOT_MCP_HOST'] ?? DEFAULT_HTTP2_HOST);
    const port = normalizeListenPort(opts.port ?? Number(process.env['COPILOT_MCP_PORT'] ?? DEFAULT_HTTP2_PORT));
    const policy = opts.policy ?? readMcpHttp2ServerPolicy();
    const timingPolicy = opts.processConfig?.transport.http.request.timing ?? readMcpHttpServerTimingPolicy();
    assertLoopbackBindAllowed(host, policy);
    await opts.processHost?.prepare();
    const tlsIo = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.adapters.http2.tls-material',
            exactPaths: [policy.certFile, policy.keyFile],
            operations: ['read'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );

    const { cert, key, certStats, keyStats } = await readTlsMaterial(policy, tlsIo);
    const tlsReport = validateTlsMaterial(cert, key, policy);

    const protocolState = createMcpHttpProtocolState(policy.allowHTTP1 ? 'h2-compat' : 'h2');
    const requestHandler = createMcpHttpRequestHandler({
        host,
        port,
        protocolState,
        publicScheme: 'https',
        workspace,
        ...(opts.processConfig ? { processConfig: opts.processConfig } : {}),
        ...(opts.processHost?.toolCapabilities ? { toolCapabilities: opts.processHost.toolCapabilities } : {}),
        ...(opts.processHost?.authRuntime ? { authRuntime: opts.processHost.authRuntime } : {}),
        ...(opts.database ? { database: opts.database } : {}),
    });
    const http2Server = /** @type {McpHttp2SecureServer} */ (
        createSecureServer(buildHttp2SecureServerOptions(policy, cert, key), async (req, res) => {
            recordMcpHttpProtocolRequest(protocolState, req);
            await requestHandler(req, res);
        })
    );

    /** @type {{ value: Awaited<ReturnType<NonNullable<typeof opts.processHost>['acquire']>> | null }} */
    const processHostLease = { value: null };
    const runtime = installHttp2RuntimeGuards(http2Server, policy, requestHandler, () => processHostLease.value);
    applyHttp2ServerTimingPolicy(http2Server, timingPolicy);
    await listenHttp2Server(http2Server, host, port);
    try {
        processHostLease.value = opts.processHost ? await opts.processHost.acquire({ reason: 'http2-listener' }) : null;
    } catch (error) {
        await closeHttp2ServerAfterStartupFailure(http2Server);
        throw error;
    }
    logMcp('INFO', 'MCP HTTP/2 server listening.', {
        adapter: { name: MCP_HTTP2_ADAPTER_NAME, version: MCP_HTTP2_ADAPTER_VERSION },
        url: `https://${host}:${port}${MCP_PATH}`,
        timingPolicy,
        sessionRuntime: requestHandler.readSessionRuntimeState(),
        http2: redactHttp2PolicyForLog(policy),
        tls: {
            ...tlsReport,
            certFileBytes: certStats.size,
            keyFileBytes: keyStats.size,
        },
        runtime: summarizeHttp2Runtime(runtime),
    });
    return http2Server;
}

/**
 * Stop an HTTP/2 MCP server by refusing new sessions, sending GOAWAY to active sessions, and force-destroying sessions
 * that outlive the configured grace period. This mirrors Node's documented requirement that active HTTP/2 sessions must
 * be closed explicitly for graceful shutdown.
 *
 * @param {import('node:http2').Http2SecureServer | McpHttp2SecureServer} server
 * @param {(error?: Error) => void} [callback]
 * @returns {void}
 */
export function stopHttp2McpServer(server, callback) {
    const secureServer = /** @type {McpHttp2SecureServer} */ (server);
    if (typeof secureServer.closeGracefully === 'function') {
        secureServer.closeGracefully(callback);
        return;
    }
    secureServer.close(callback);
}

/**
 * @param {McpHttp2ServerPolicy} policy
 * @param {string} cert
 * @param {string} key
 * @returns {import('node:http2').SecureServerOptions}
 */
function buildHttp2SecureServerOptions(policy, cert, key) {
    return /** @type {import('node:http2').SecureServerOptions} */ (
        /** @type {unknown} */ ({
            allowHTTP1: policy.allowHTTP1,
            ALPNProtocols: policy.allowHTTP1 ? ['h2', 'http/1.1'] : ['h2'],
            cert,
            key,
            minVersion: policy.minVersion,
            maxSessionMemory: policy.maxSessionMemoryMb,
            maxHeaderListPairs: policy.maxHeaderListPairs,
            maxSendHeaderBlockLength: policy.maxSendHeaderBlockLength,
            maxSettings: policy.maxSettings,
            maxOutstandingPings: policy.maxOutstandingPings,
            maxSessionInvalidFrames: policy.maxSessionInvalidFrames,
            maxSessionRejectedStreams: policy.maxSessionRejectedStreams,
            streamResetBurst: policy.streamResetBurst,
            streamResetRate: policy.streamResetRate,
            unknownProtocolTimeout: policy.unknownProtocolTimeoutMs,
            strictFieldWhitespaceValidation: true,
            strictSingleValueFields: true,
            settings: {
                enablePush: false,
                maxConcurrentStreams: policy.maxConcurrentStreams,
            },
        })
    );
}

/**
 * @param {McpHttp2SecureServer} server
 * @param {McpHttp2ServerPolicy} policy
 * @param {ReturnType<typeof createMcpHttpRequestHandler>} requestHandler
 * @param {() => Awaited<ReturnType<ReturnType<typeof import('#copilot/mcp/public/process/host').createMcpProcessHost>['acquire']>> | null} getProcessHostLease
 * @returns {McpHttp2RuntimeState}
 */
function installHttp2RuntimeGuards(server, policy, requestHandler, getProcessHostLease) {
    /** @type {McpHttp2RuntimeState} */
    const runtime = {
        activeSessions: new Set(),
        closing: false,
        closed: false,
        closeCallbacks: [],
        terminalError: null,
        createdAt: Date.now(),
        acceptedSessions: 0,
        rejectedSessions: 0,
        sessionErrors: 0,
        streamErrors: 0,
        unknownProtocolEvents: 0,
        tlsClientErrors: 0,
    };
    server.mcpHttp2Runtime = runtime;

    server.on('connection', (socket) => {
        const remoteAddress = normalizeRemoteAddress(socket.remoteAddress ?? '');
        if (!policy.allowNonLoopbackClients && !isLoopbackAddress(remoteAddress)) {
            runtime.rejectedSessions += 1;
            logMcp('WARN', 'Rejected non-loopback MCP HTTP/2 origin connection.', { remoteAddress });
            socket.destroy();
        }
    });

    server.on('session', (session) => {
        if (runtime.closing) {
            closeHttp2Session(session, http2Constants.NGHTTP2_NO_ERROR);
            return;
        }
        if (runtime.activeSessions.size >= policy.maxSessions) {
            runtime.rejectedSessions += 1;
            logMcp('WARN', 'Rejected MCP HTTP/2 session because max session limit was reached.', {
                activeSessions: runtime.activeSessions.size,
                maxSessions: policy.maxSessions,
            });
            closeHttp2Session(session, http2Constants.NGHTTP2_ENHANCE_YOUR_CALM);
            setTimeout(
                () => {
                    if (!session.closed && !session.destroyed) session.destroy();
                },
                Math.min(policy.shutdownDestroyAfterMs, 1000),
            ).unref();
            return;
        }
        runtime.acceptedSessions += 1;
        runtime.activeSessions.add(session);
        if (policy.sessionIdleTimeoutMs > 0) {
            session.setTimeout(policy.sessionIdleTimeoutMs, () => {
                logMcp('WARN', 'Closing idle MCP HTTP/2 session after explicit timeout.', {
                    sessionIdleTimeoutMs: policy.sessionIdleTimeoutMs,
                });
                closeHttp2Session(session, http2Constants.NGHTTP2_NO_ERROR);
            });
        }
        session.on('close', () => runtime.activeSessions.delete(session));
        session.on('error', (error) => {
            runtime.sessionErrors += 1;
            logMcp('WARN', 'MCP HTTP/2 session error.', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
        session.on('stream', (stream) => {
            stream.on('error', (error) => {
                runtime.streamErrors += 1;
                logMcp('WARN', 'MCP HTTP/2 stream error.', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        });
    });

    server.on('sessionError', (error) => {
        runtime.sessionErrors += 1;
        logMcp('WARN', 'MCP HTTP/2 server session error.', {
            error: error instanceof Error ? error.message : String(error),
        });
    });

    server.on('tlsClientError', (error) => {
        runtime.tlsClientErrors += 1;
        logMcp('WARN', 'MCP HTTP/2 TLS client error.', {
            error: error instanceof Error ? error.message : String(error),
        });
    });

    server.on('unknownProtocol', (socket) => {
        runtime.unknownProtocolEvents += 1;
        logMcp('WARN', 'MCP HTTP/2 unknown TLS ALPN protocol.', {
            allowHTTP1: policy.allowHTTP1,
            unknownProtocolTimeoutMs: policy.unknownProtocolTimeoutMs,
        });
        socket.destroy();
    });

    const close = server.close.bind(server);
    server.closeGracefully = (callback) =>
        closeHttp2ServerGracefully(runtime, policy, close, requestHandler, getProcessHostLease, callback);
    server.close = /** @type {typeof server.close} */ (
        (callback) => {
            closeHttp2ServerGracefully(runtime, policy, close, requestHandler, getProcessHostLease, callback);
            return server;
        }
    );
    Object.defineProperty(server, Symbol.asyncDispose, {
        configurable: true,
        value: () =>
            new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve(undefined)));
            }),
    });
    return runtime;
}

/**
 * @param {McpHttp2RuntimeState} runtime
 * @param {McpHttp2ServerPolicy} policy
 * @param {(callback?: (err?: Error) => void) => McpHttp2SecureServer} close
 * @param {ReturnType<typeof createMcpHttpRequestHandler>} requestHandler
 * @param {() => Awaited<ReturnType<ReturnType<typeof import('#copilot/mcp/public/process/host').createMcpProcessHost>['acquire']>> | null} getProcessHostLease
 * @param {(error?: Error) => void} [callback]
 * @returns {void}
 */
function closeHttp2ServerGracefully(runtime, policy, close, requestHandler, getProcessHostLease, callback) {
    if (callback) {
        if (runtime.closed) setImmediate(() => callback(runtime.terminalError ?? undefined));
        else runtime.closeCallbacks.push(callback);
    }
    if (runtime.closing || runtime.closed) return;
    runtime.closing = true;
    logMcp('INFO', 'Closing MCP HTTP/2 server sessions.', {
        activeSessions: runtime.activeSessions.size,
        shutdownDestroyAfterMs: policy.shutdownDestroyAfterMs,
    });
    const destroyTimer = setTimeout(() => {
        let destroyed = 0;
        for (const session of runtime.activeSessions) {
            if (!session.closed && !session.destroyed) {
                session.destroy();
                destroyed += 1;
            }
        }
        if (destroyed > 0) logMcp('WARN', 'Destroyed lingering MCP HTTP/2 sessions during shutdown.', { destroyed });
    }, policy.shutdownDestroyAfterMs);
    destroyTimer.unref();

    for (const session of runtime.activeSessions) {
        try {
            if (!session.closed && !session.destroyed) closeHttp2Session(session, http2Constants.NGHTTP2_NO_ERROR);
        } catch (error) {
            logMcp('WARN', 'Failed to send GOAWAY while closing MCP HTTP/2 session.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const complete = async (/** @type {Error | undefined} */ transportError) => {
        clearTimeout(destroyTimer);
        const failures = transportError ? [transportError] : [];
        try {
            await requestHandler.close();
        } catch (error) {
            failures.push(asCloseError(error, 'MCP HTTP/2 request handler close failed'));
        }
        try {
            await getProcessHostLease()?.release();
        } catch (error) {
            failures.push(asCloseError(error, 'MCP HTTP/2 process-host lease release failed'));
        }
        runtime.terminalError = combineHttp2CloseFailures(failures);
        runtime.closed = true;
        const callbacks = runtime.closeCallbacks.splice(0);
        for (const pending of callbacks) pending(runtime.terminalError ?? undefined);
    };
    try {
        close((error) => void complete(error));
    } catch (error) {
        void complete(asCloseError(error, 'MCP HTTP/2 listener close failed'));
    }
}

/** @param {unknown} error @param {string} fallback */
function asCloseError(error, fallback) {
    return error instanceof Error ? error : new Error(`${fallback}: ${String(error)}`);
}

/** @param {Error[]} failures */
function combineHttp2CloseFailures(failures) {
    if (failures.length === 0) return null;
    if (failures.length === 1) return failures[0] ?? null;
    return new AggregateError(failures, 'MCP HTTP/2 shutdown failed.');
}

/** @param {McpHttp2SecureServer} server */
function closeHttp2ServerAfterStartupFailure(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
}

/**
 * Node's HTTP/2 runtime accepts GOAWAY error codes here, while the ambient overload can narrow too aggressively under
 * checkJs. This helper keeps the shutdown semantics in one place and preserves a no-code fallback.
 *
 * @param {import('node:http2').ServerHttp2Session} session
 * @param {number} code
 * @returns {void}
 */
function closeHttp2Session(session, code) {
    try {
        /** @type {{ close: (code?: number) => void }} */ (session).close(code);
    } catch {
        session.close();
    }
}

/**
 * @param {import('node:http2').Http2SecureServer} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenHttp2Server(server, host, port) {
    return new Promise((resolve, reject) => {
        /** @param {Error} error */
        const onError = (error) => {
            server.off('listening', onListening);
            server.off('error', onError);
            reject(
                new Error(
                    `Cannot start MCP HTTP/2 server on ${host}:${port}. Is another MCP HTTP server already running? Cause: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
        };
        const onListening = () => {
            server.off('error', onError);
            server.off('listening', onListening);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

/**
 * @param {McpHttp2ServerPolicy} policy
 * @param {ReturnType<typeof createConfiguredFsIo>} tlsIo
 * @returns {Promise<{
 *     cert: string;
 *     key: string;
 *     certStats: { size: number; mode: number };
 *     keyStats: { size: number; mode: number };
 * }>}
 */
async function readTlsMaterial(policy, tlsIo) {
    try {
        const [certSnapshot, keySnapshot] = await Promise.all([
            tlsIo.readTextFresh(policy.certFile),
            tlsIo.readTextFresh(policy.keyFile),
        ]);
        if (!certSnapshot.isFile || certSnapshot.sizeBytes <= 0 || certSnapshot.sizeBytes > MAX_TLS_FILE_BYTES) {
            throw new Error(`certificate file must be a non-empty regular file <= ${MAX_TLS_FILE_BYTES} bytes`);
        }
        if (!keySnapshot.isFile || keySnapshot.sizeBytes <= 0 || keySnapshot.sizeBytes > MAX_TLS_FILE_BYTES) {
            throw new Error(`key file must be a non-empty regular file <= ${MAX_TLS_FILE_BYTES} bytes`);
        }
        const certStats = { size: certSnapshot.sizeBytes, mode: certSnapshot.mode };
        const keyStats = { size: keySnapshot.sizeBytes, mode: keySnapshot.mode };
        warnIfPrivateKeyFileModeIsLoose(policy.keyFile, keyStats);
        return { cert: certSnapshot.content, key: keySnapshot.content, certStats, keyStats };
    } catch (error) {
        throw new Error(
            `Cannot start MCP HTTP/2 server without TLS material. Set COPILOT_MCP_HTTP2_CERT_FILE and COPILOT_MCP_HTTP2_KEY_FILE or create ${DEFAULT_HTTP2_CERT_FILE} and ${DEFAULT_HTTP2_KEY_FILE}. Cause: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}

/**
 * @param {string} keyFile
 * @param {{ mode: number }} keyStats
 * @returns {void}
 */
function warnIfPrivateKeyFileModeIsLoose(keyFile, keyStats) {
    if (process.platform === 'win32') return;
    if ((keyStats.mode & 0o077) !== 0) {
        logMcp('WARN', 'MCP HTTP/2 TLS private key file is readable by group/other users.', {
            keyFile,
            recommendedMode: '0600',
        });
    }
}

/**
 * @param {string} cert
 * @param {string} key
 * @param {McpHttp2ServerPolicy} policy
 * @returns {{
 *     subject: string;
 *     issuer: string;
 *     validFrom: string;
 *     validTo: string;
 *     daysUntilExpiry: number;
 *     expectedCertificateHostnames: string[];
 *     hostnameValidation: 'not-configured' | 'ok' | 'mismatch-allowed';
 * }}
 */
function validateTlsMaterial(cert, key, policy) {
    validateCertificatePem(cert, policy.certFile);
    validatePrivateKeyPem(key, policy.keyFile);
    try {
        const certificate = new X509Certificate(cert);
        const privateKey = createPrivateKey(key);
        const certPublicKey = certificate.publicKey.export({ format: 'der', type: 'spki' });
        const privatePublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
        if (!Buffer.from(certPublicKey).equals(Buffer.from(privatePublicKey))) {
            throw new Error('certificate public key differs from private key public key');
        }
        const nowMs = Date.now();
        const validFromMs = Date.parse(certificate.validFrom);
        const validToMs = Date.parse(certificate.validTo);
        if (Number.isFinite(validFromMs) && validFromMs > nowMs) throw new Error('certificate is not valid yet');
        if (Number.isFinite(validToMs) && validToMs <= nowMs) throw new Error('certificate is expired');
        const daysUntilExpiry = Number.isFinite(validToMs)
            ? Math.ceil((validToMs - nowMs) / (24 * 60 * 60 * 1000))
            : Number.POSITIVE_INFINITY;
        if (Number.isFinite(daysUntilExpiry) && daysUntilExpiry <= policy.certificateExpiryWarnDays) {
            logMcp('WARN', 'MCP HTTP/2 TLS certificate is nearing expiry.', {
                daysUntilExpiry,
                validTo: certificate.validTo,
                certificateExpiryWarnDays: policy.certificateExpiryWarnDays,
            });
        }
        const hostnameValidation = validateCertificateHostnames(certificate, policy);
        return {
            subject: certificate.subject,
            issuer: certificate.issuer,
            validFrom: certificate.validFrom,
            validTo: certificate.validTo,
            daysUntilExpiry,
            expectedCertificateHostnames: policy.expectedCertificateHostnames,
            hostnameValidation,
        };
    } catch (error) {
        throw new Error(
            `Invalid MCP HTTP/2 TLS material. Check ${policy.certFile} and ${policy.keyFile}; certificate and key must be PEM, valid, and must match. Cause: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}

/**
 * @param {X509Certificate} certificate
 * @param {McpHttp2ServerPolicy} policy
 * @returns {'not-configured' | 'ok' | 'mismatch-allowed'}
 */
function validateCertificateHostnames(certificate, policy) {
    if (policy.expectedCertificateHostnames.length === 0) return 'not-configured';
    const matched = policy.expectedCertificateHostnames.some((hostname) =>
        isIP(hostname) ? Boolean(certificate.checkIP(hostname)) : Boolean(certificate.checkHost(hostname)),
    );
    if (matched) return 'ok';
    if (policy.allowCertificateHostnameMismatch) {
        logMcp('WARN', 'MCP HTTP/2 TLS certificate hostname mismatch was explicitly allowed.', {
            expectedCertificateHostnames: policy.expectedCertificateHostnames,
            subject: certificate.subject,
        });
        return 'mismatch-allowed';
    }
    throw new Error(
        `certificate does not match expected hostname(s): ${policy.expectedCertificateHostnames.join(', ')}`,
    );
}

/**
 * @param {string} pem
 * @param {string} file
 * @returns {void}
 */
function validateCertificatePem(pem, file) {
    const text = String(pem).trim();
    if (!text.startsWith('-----BEGIN CERTIFICATE-----')) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: expected PEM block -----BEGIN CERTIFICATE-----.`);
    }
    if (!text.includes('-----END CERTIFICATE-----')) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: missing -----END CERTIFICATE-----.`);
    }
}

/**
 * @param {string} pem
 * @param {string} file
 * @returns {void}
 */
function validatePrivateKeyPem(pem, file) {
    const text = String(pem).trim();
    if (ENCRYPTED_PRIVATE_KEY_PATTERN.test(text)) {
        throw new Error(
            `Invalid MCP HTTP/2 TLS file ${file}: encrypted private keys are not supported for unattended MCP origin startup.`,
        );
    }
    if (!PRIVATE_KEY_BEGIN_PATTERN.test(text)) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: expected an unencrypted PEM private key block.`);
    }
    if (!PRIVATE_KEY_END_PATTERN.test(text)) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: missing private key END PEM marker.`);
    }
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeRequiredPath(value, fallback) {
    const filePath = String(value ?? fallback).trim();
    if (!filePath) return fallback;
    if (filePath.includes('\0') || /[\r\n]/u.test(filePath)) {
        throw new Error('MCP HTTP/2 TLS file path must be single-line and must not contain null bytes.');
    }
    return filePath;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeListenHost(value) {
    const host = String(value ?? DEFAULT_HTTP2_HOST).trim() || DEFAULT_HTTP2_HOST;
    if (host.length > 255 || host.includes('\0') || /[\s/\\]/u.test(host)) {
        throw new Error(`Invalid MCP HTTP/2 host: ${JSON.stringify(host)}.`);
    }
    return host;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeListenPort(value) {
    const parsed = Number(value ?? DEFAULT_HTTP2_PORT);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid MCP HTTP/2 port: ${JSON.stringify(value)}.`);
    }
    return parsed;
}

/**
 * @param {string} host
 * @param {McpHttp2ServerPolicy} policy
 * @returns {void}
 */
function assertLoopbackBindAllowed(host, policy) {
    if (policy.allowNonLoopbackBind || isLoopbackAddress(host)) return;
    throw new Error(
        `Refusing to bind MCP HTTP/2 origin to non-loopback host ${JSON.stringify(host)}. Cloudflare Tunnel should reach this dev origin over loopback. Set COPILOT_MCP_HTTP2_ALLOW_NON_LOOPBACK_BIND=true only if this exposure is intentional.`,
    );
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function normalizeBooleanEnv(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum, maximum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function readExpectedCertificateHostnames(env) {
    const raw = String(
        env['COPILOT_MCP_HTTP2_EXPECTED_CERT_HOSTNAME'] ??
            env['COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME'] ??
            env['COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME'] ??
            env['COPILOT_MCP_PUBLIC_HOSTNAME'] ??
            '',
    );
    return [
        ...new Set(
            raw
                .split(',')
                .map((item) => normalizeCertificateHostname(item))
                .filter(Boolean),
        ),
    ];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeCertificateHostname(value) {
    const hostname = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\.$/u, '');
    if (!hostname || hostname.length > 253 || hostname.includes('\0') || /[^a-z0-9.*:-]/u.test(hostname)) return '';
    if (hostname.includes('*') && !hostname.startsWith('*.')) return '';
    return hostname;
}

/**
 * @param {string | undefined} value
 * @returns {import('node:tls').SecureVersion}
 */
function normalizeTlsMinVersion(value) {
    const raw = String(value ?? DEFAULT_TLS_MIN_VERSION).trim();
    return raw === 'TLSv1.2' || raw === 'TLSv1.3' ? raw : DEFAULT_TLS_MIN_VERSION;
}

/**
 * @param {string} address
 * @returns {string}
 */
function normalizeRemoteAddress(address) {
    return String(address ?? '')
        .trim()
        .replace(/^::ffff:/u, '');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isLoopbackAddress(value) {
    const normalized = normalizeRemoteAddress(value).toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
    if (LOOPBACK_HOSTS.includes(normalized)) return true;
    if (isIP(normalized) === 4) return normalized.startsWith('127.');
    return normalized === '::1';
}

/**
 * @param {McpHttp2ServerPolicy} policy
 * @returns {Record<string, unknown>}
 */
function redactHttp2PolicyForLog(policy) {
    return {
        version: MCP_HTTP2_ADAPTER_VERSION,
        certFile: policy.certFile,
        keyFile: policy.keyFile,
        allowHTTP1: policy.allowHTTP1,
        maxConcurrentStreams: policy.maxConcurrentStreams,
        maxSessions: policy.maxSessions,
        maxSessionMemoryMb: policy.maxSessionMemoryMb,
        maxHeaderListPairs: policy.maxHeaderListPairs,
        maxSendHeaderBlockLength: policy.maxSendHeaderBlockLength,
        maxSettings: policy.maxSettings,
        maxOutstandingPings: policy.maxOutstandingPings,
        maxSessionInvalidFrames: policy.maxSessionInvalidFrames,
        maxSessionRejectedStreams: policy.maxSessionRejectedStreams,
        streamResetBurst: policy.streamResetBurst,
        streamResetRate: policy.streamResetRate,
        unknownProtocolTimeoutMs: policy.unknownProtocolTimeoutMs,
        shutdownDestroyAfterMs: policy.shutdownDestroyAfterMs,
        sessionIdleTimeoutMs: policy.sessionIdleTimeoutMs,
        expectedCertificateHostnames: policy.expectedCertificateHostnames,
        allowCertificateHostnameMismatch: policy.allowCertificateHostnameMismatch,
        allowNonLoopbackBind: policy.allowNonLoopbackBind,
        allowNonLoopbackClients: policy.allowNonLoopbackClients,
        minVersion: policy.minVersion,
    };
}

/**
 * @param {McpHttp2RuntimeState} runtime
 * @returns {Record<string, unknown>}
 */
function summarizeHttp2Runtime(runtime) {
    return {
        activeSessions: runtime.activeSessions.size,
        closing: runtime.closing,
        acceptedSessions: runtime.acceptedSessions,
        rejectedSessions: runtime.rejectedSessions,
        sessionErrors: runtime.sessionErrors,
        streamErrors: runtime.streamErrors,
        unknownProtocolEvents: runtime.unknownProtocolEvents,
        tlsClientErrors: runtime.tlsClientErrors,
        uptimeMs: Date.now() - runtime.createdAt,
    };
}
