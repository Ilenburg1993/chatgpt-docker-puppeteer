// @ts-check
/**
 * Stateful Streamable HTTP router for MCP.
 *
 * Faixa 3 wires the official StreamableHTTPServerTransport session lifecycle into the process-local runtime introduced
 * in Faixa 2. Faixa 4/P0 binds sessions to verified OAuth claims, uses a durable event store on the operational path,
 * and validates Last-Event-ID before delegating resumability to the SDK transport.
 *
 * @module copilot/mcp/adapters/http-stateful-router
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { logMcp } from '../control-plane/audit.js';
import { resolveMcpSessionAuthBinding } from '../control-plane/auth.js';
import { createMcpInMemoryEventStore, createSqliteMcpEventStore, parseMcpEventId } from '../control-plane/event-store.js';
import {
    createDefaultMcpHttpSessionRuntimeWithSqliteStore,
    getDefaultMcpHttpSessionRuntime,
    hashMcpHttpSessionId,
} from '../control-plane/session-runtime.js';
import { getDefaultMcpHttpStreamRegistry } from '../control-plane/stream-registry.js';
import { createCopilotMcpServer } from '../server.js';
import { isMcpInitializeRequestBody, normalizeMcpSessionId } from './http-body.js';

/**
 * @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest
 * @typedef {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} McpHttpResponse
 * @typedef {{ error: string; error_description: string }} McpTransportError
 * @typedef {import('../control-plane/session-runtime.js').McpHttpSessionAuthBinding} McpHttpSessionAuthBinding
 * @typedef {import('../control-plane/auth.js').McpSessionAuthBindingResolution} StatefulRouterAuthBindingResolution
 *
 * @typedef {object} StatefulRouterOptions
 * @property {McpHttpRequest} req
 * @property {McpHttpResponse} res
 * @property {URL} url
 * @property {unknown} parsedMcpBody
 * @property {import('../control-plane/auth.js').McpAuthContext} authContext
 * @property {string} protocolVersion
 * @property {boolean} [useSqliteStore]
 * @property {ReturnType<typeof getDefaultMcpHttpSessionRuntime>} [runtime]
 * @property {ReturnType<typeof getDefaultMcpHttpStreamRegistry>} [streamRegistry]
 * @property {(req: McpHttpRequest, name: string) => string | undefined} readHeader
 * @property {(res: McpHttpResponse, statusCode: number, error: McpTransportError) => void} writeTransportError
 * @property {(options: { authContext: import('../control-plane/auth.js').McpAuthContext }) => ReturnType<typeof createCopilotMcpServer>} [createServer]
 * @property {(options: import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions) => StreamableHTTPServerTransport} [createTransport]
 * @property {() => import('../control-plane/event-store.js').McpSdkCompatibleEventStore} [createEventStore]
 * @property {(authContext: import('../control-plane/auth.js').McpAuthContext, url: URL) => Promise<StatefulRouterAuthBindingResolution> | StatefulRouterAuthBindingResolution} [resolveAuthBinding]
 *
 * @typedef {{ handled: true; mode: 'stateful'; kind: 'initialize' | 'session-bound' }} StatefulRouterResult
 */

const statefulTransportEventStores = new WeakMap();

/**
 * @param {StatefulRouterOptions} options
 * @returns {Promise<StatefulRouterResult>}
 */
export async function handleStatefulMcpHttpRequest(options) {
    const method = String(options.req.method ?? '').toUpperCase();
    const sessionId = normalizeMcpSessionId(options.readHeader(options.req, 'mcp-session-id'));
    const initializeRequest = method === 'POST' && isMcpInitializeRequestBody(options.parsedMcpBody);
    const runtime = options.runtime ?? (options.useSqliteStore === false
        ? getDefaultMcpHttpSessionRuntime()
        : createDefaultMcpHttpSessionRuntimeWithSqliteStore());

    if (method === 'POST' && initializeRequest) {
        if (sessionId) {
            options.writeTransportError(options.res, 400, {
                error: 'invalid_request',
                error_description: 'MCP initialize requests must not include an existing session ID.',
            });
            return { handled: true, mode: 'stateful', kind: 'initialize' };
        }
        const authBinding = await resolveRequestAuthBinding(options);
        if (!authBinding.ok) {
            writeAuthBindingFailure(options, authBinding);
            return { handled: true, mode: 'stateful', kind: 'initialize' };
        }
        if (!hasStatefulSessionCapacity(runtime)) {
            options.writeTransportError(options.res, 503, {
                error: 'server_overloaded',
                error_description: 'MCP stateful session capacity reached. Retry after active sessions expire or close.',
            });
            return { handled: true, mode: 'stateful', kind: 'initialize' };
        }
        await handleStatefulInitialize(options, runtime, authBinding.binding);
        return { handled: true, mode: 'stateful', kind: 'initialize' };
    }

    if (!sessionId) {
        options.writeTransportError(options.res, 400, {
            error: 'invalid_request',
            error_description: 'MCP requests after initialize must include Mcp-Session-Id.',
        });
        return { handled: true, mode: 'stateful', kind: 'session-bound' };
    }

    if (method === 'GET') {
        if (!acceptsTextEventStream(options.readHeader(options.req, 'accept'))) {
            options.writeTransportError(options.res, 406, {
                error: 'not_acceptable',
                error_description: 'MCP GET requests must accept text/event-stream.',
            });
            return { handled: true, mode: 'stateful', kind: 'session-bound' };
        }
        const lastEventIdError = validateLastEventIdHeader(options);
        if (lastEventIdError) {
            options.writeTransportError(options.res, 400, lastEventIdError);
            return { handled: true, mode: 'stateful', kind: 'session-bound' };
        }
    }

    const session = runtime.get(sessionId);
    if (!session) {
        options.writeTransportError(options.res, 404, {
            error: 'session_not_found',
            error_description: 'MCP session not found or expired.',
        });
        return { handled: true, mode: 'stateful', kind: 'session-bound' };
    }

    const authBinding = await resolveRequestAuthBinding(options);
    if (!authBinding.ok) {
        writeAuthBindingFailure(options, authBinding);
        return { handled: true, mode: 'stateful', kind: 'session-bound' };
    }

    if (!validateSessionAuthBinding(session.authBinding, authBinding.binding)) {
        options.writeTransportError(options.res, 403, {
            error: 'forbidden',
            error_description: 'MCP session auth binding mismatch.',
        });
        return { handled: true, mode: 'stateful', kind: 'session-bound' };
    }

    if (method === 'GET' && writeStatefulSseProbeIfRequested(options)) {
        runtime.touch(sessionId);
        return { handled: true, mode: 'stateful', kind: 'session-bound' };
    }

    const streamRegistry = options.streamRegistry ?? getDefaultMcpHttpStreamRegistry();
    const stream = method === 'GET' ? streamRegistry.open({ sessionId, kind: 'standalone-get-sse' }) : null;
    if (method === 'GET') await seedStatefulSdkReplayProbeIfRequested(options, session.transport);
    const sdkSseProbeTimer = method === 'GET' ? scheduleStatefulSdkSseProbeIfRequested(options, session.transport) : null;
    try {
        await handleRequestOnExistingTransport(options, session.transport, method === 'POST' ? options.parsedMcpBody : undefined);
        if (method === 'DELETE') {
            streamRegistry.closeBySession(sessionId, 'session_closed');
            runtime.terminate(sessionId, 'client_delete');
            writeNoContentIfResponseOpen(options.res);
        } else {
            runtime.touch(sessionId);
            if (stream) streamRegistry.touch(stream.streamKey);
        }
    } finally {
        if (sdkSseProbeTimer) clearTimeout(sdkSseProbeTimer);
        if (stream) streamRegistry.close(stream.streamKey, 'response_closed');
    }
    return { handled: true, mode: 'stateful', kind: 'session-bound' };
}

/**
 * @param {StatefulRouterOptions} options
 * @returns {boolean}
 */
function writeStatefulSseProbeIfRequested(options) {
    if (options.readHeader(options.req, 'x-copilot-mcp-sse-probe') !== '1') return false;
    const response = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (options.res));
    if (response['headersSent'] === true || response['writableEnded'] === true) return false;
    setHeaderIfSupported(options.res, 'Content-Type', 'text/event-stream; charset=utf-8');
    setHeaderIfSupported(options.res, 'Cache-Control', 'no-store, no-transform');
    setHeaderIfSupported(options.res, 'X-Accel-Buffering', 'no');
    setHeaderIfSupported(options.res, 'X-Copilot-MCP-SSE-Probe', 'ok');
    response['statusCode'] = 200;
    const payload = JSON.stringify({ ok: true, diagnostic: true, at: new Date().toISOString() });
    const write = response['write'];
    const end = response['end'];
    if (typeof write === 'function') write.call(options.res, `event: copilot-mcp-sse-probe\ndata: ${payload}\n\n`);
    if (typeof end === 'function') end.call(options.res);
    return true;
}

/**
 * @param {StatefulRouterOptions} options
 * @param {unknown} transport
 * @returns {NodeJS.Timeout | null}
 */
function scheduleStatefulSdkSseProbeIfRequested(options, transport) {
    if (options.readHeader(options.req, 'x-copilot-mcp-sdk-sse-probe') !== '1') return null;
    const send = transport && typeof transport === 'object'
        ? /** @type {Record<string, unknown>} */ (transport)['send']
        : null;
    if (typeof send !== 'function') return null;
    return setTimeout(() => {
        Promise.resolve(
            send.call(transport, {
                jsonrpc: '2.0',
                method: 'notifications/message',
                params: {
                    level: 'info',
                    logger: 'copilot-mcp-sdk-sse-probe',
                    data: { ok: true, at: new Date().toISOString() },
                },
            }),
        ).catch((error) => {
            logMcp('WARN', 'MCP stateful SDK SSE probe send failed.', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, 25);
}

/**
 * @param {StatefulRouterOptions} options
 * @param {unknown} transport
 * @returns {Promise<void>}
 */
async function seedStatefulSdkReplayProbeIfRequested(options, transport) {
    if (options.readHeader(options.req, 'x-copilot-mcp-sdk-replay-probe') !== '1') return;
    if (!transport || typeof transport !== 'object') return;
    const eventStore = statefulTransportEventStores.get(transport);
    if (!eventStore) return;
    const lastEventId = options.readHeader(options.req, 'last-event-id');
    const parsed = lastEventId ? parseMcpEventId(lastEventId) : null;
    if (!parsed) return;
    await eventStore.storeEvent(parsed.streamId, {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', logger: 'copilot-mcp-sdk-replay-probe', data: { sequence: parsed.sequence + 1 } },
    });
    setHeaderIfSupported(options.res, 'X-Copilot-MCP-SSE-Replay-Probe', 'seeded-same-stream');
}

/**
 * @param {StatefulRouterOptions} options
 * @returns {Promise<StatefulRouterAuthBindingResolution>}
 */
async function resolveRequestAuthBinding(options) {
    if (options.resolveAuthBinding) return options.resolveAuthBinding(options.authContext, options.url);
    if (options.useSqliteStore === false) return buildInMemoryRouterBinding(options);
    return resolveMcpSessionAuthBinding(options.authContext, `${options.url.origin}${options.url.pathname}`);
}

/**
 * Direct unit tests and explicit in-memory router harnesses do not pass through the public HTTP envelope. Keep that path
 * deterministic while preserving the operational SQLite/JWKS claims path above.
 *
 * @param {StatefulRouterOptions} options
 * @returns {StatefulRouterAuthBindingResolution}
 */
function buildInMemoryRouterBinding(options) {
    const credential = String(options.authContext.bearerToken ?? '');
    return {
        ok: true,
        verified: false,
        binding: {
            mode: credential ? 'oauth-in-memory' : 'none-dev',
            issuerHash: '',
            subjectHash: credential ? hashMcpHttpSessionId(credential) : '',
            clientIdHash: '',
            resource: `${options.url.origin}${options.url.pathname}`,
            audience: options.url.origin,
            scopes: [],
        },
    };
}

/**
 * @param {StatefulRouterOptions} options
 * @param {Extract<StatefulRouterAuthBindingResolution, { ok: false }>} failure
 * @returns {void}
 */
function writeAuthBindingFailure(options, failure) {
    if (failure.challenge) setHeaderIfSupported(options.res, 'WWW-Authenticate', failure.challenge);
    options.writeTransportError(options.res, failure.statusCode, failure.error);
}

/**
 * @param {StatefulRouterOptions} options
 * @returns {McpTransportError | null}
 */
function validateLastEventIdHeader(options) {
    const lastEventId = options.readHeader(options.req, 'last-event-id');
    if (!lastEventId) return null;
    try {
        parseMcpEventId(lastEventId);
        return null;
    } catch {
        return {
            error: 'invalid_request',
            error_description: 'MCP Last-Event-ID is malformed or does not belong to this event-store format.',
        };
    }
}

/**
 * @param {ReturnType<typeof getDefaultMcpHttpSessionRuntime>} runtime
 * @returns {boolean}
 */
function hasStatefulSessionCapacity(runtime) {
    runtime.sweepExpired();
    const snapshot = runtime.snapshot();
    const policy = snapshot['policy'] && typeof snapshot['policy'] === 'object'
        ? /** @type {{ maxSessions?: unknown }} */ (snapshot['policy'])
        : {};
    const activeSessions = Number(snapshot['activeSessions'] ?? 0);
    const maxSessions = Number(policy.maxSessions ?? 0);
    return maxSessions <= 0 || activeSessions < maxSessions;
}

/**
 * @param {StatefulRouterOptions} options
 * @param {ReturnType<typeof getDefaultMcpHttpSessionRuntime>} runtime
 * @param {McpHttpSessionAuthBinding} authBinding
 * @returns {Promise<void>}
 */
async function handleStatefulInitialize(options, runtime, authBinding) {
    const createServer = options.createServer ?? createCopilotMcpServer;
    const createTransport = options.createTransport ?? ((transportOptions) => new StreamableHTTPServerTransport(transportOptions));
    const createEventStore = options.createEventStore ?? (() => createDefaultStatefulEventStore(options));
    const server = createServer({ authContext: options.authContext });
    const rawEventStore = createEventStore();
    const eventStore = /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').EventStore} */ (
        /** @type {unknown} */ (rawEventStore)
    );
    /** @type {string | null} */
    let initializedSessionId = null;
    /** @type {StreamableHTTPServerTransport} */
    const transport = createTransport({
        eventStore,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
            initializedSessionId = sessionId;
            runtime.register({
                sessionId,
                transport,
                server,
                authBinding,
                transportBinding: {
                    adapter: detectAdapter(options.req),
                    publicUrl: `${options.url.origin}${options.url.pathname}`,
                },
                protocolVersion: options.protocolVersion,
            });
            logMcp('INFO', 'MCP stateful HTTP session initialized.', {
                sessionIdPresent: true,
                protocolVersion: options.protocolVersion,
            });
        },
    });
    if (transport && typeof transport === 'object') statefulTransportEventStores.set(transport, rawEventStore);

    try {
        await server.connect(
            /** @type {import('@modelcontextprotocol/sdk/shared/transport.js').Transport} */ (transport),
        );
        await transport.handleRequest(
            /** @type {import('node:http').IncomingMessage} */ (options.req),
            /** @type {import('node:http').ServerResponse} */ (options.res),
            options.parsedMcpBody,
        );
    } catch (error) {
        if (initializedSessionId) runtime.terminate(initializedSessionId, 'runtime_error');
        else {
            await safeClose(transport);
            await safeClose(server);
        }
        throw error;
    }

    if (!initializedSessionId) {
        await safeClose(transport);
        await safeClose(server);
    }
}

/**
 * @param {StatefulRouterOptions} options
 * @returns {import('../control-plane/event-store.js').McpSdkCompatibleEventStore}
 */
function createDefaultStatefulEventStore(options) {
    return options.useSqliteStore === false ? createMcpInMemoryEventStore() : createSqliteMcpEventStore();
}

/**
 * @param {StatefulRouterOptions} options
 * @param {unknown} transport
 * @param {unknown} parsedMcpBody
 * @returns {Promise<void>}
 */
async function handleRequestOnExistingTransport(options, transport, parsedMcpBody) {
    const handleRequest = transport && typeof transport === 'object'
        ? /** @type {Record<string, unknown>} */ (transport)['handleRequest']
        : null;
    if (typeof handleRequest !== 'function') {
        throw new Error('MCP stateful transport is missing handleRequest().');
    }
    if (parsedMcpBody === undefined) {
        await handleRequest.call(
            transport,
            /** @type {import('node:http').IncomingMessage} */ (options.req),
            /** @type {import('node:http').ServerResponse} */ (options.res),
        );
        return;
    }
    await handleRequest.call(
        transport,
        /** @type {import('node:http').IncomingMessage} */ (options.req),
        /** @type {import('node:http').ServerResponse} */ (options.res),
        parsedMcpBody,
    );
}

/**
 * @param {McpHttpSessionAuthBinding} expected
 * @param {McpHttpSessionAuthBinding} actual
 * @returns {boolean}
 */
function validateSessionAuthBinding(expected, actual) {
    if (!expected.mode && !expected.resource && !expected.audience && !expected.subjectHash) return true;
    return expected.mode === actual.mode
        && String(expected.resource ?? '') === String(actual.resource ?? '')
        && String(expected.audience ?? '') === String(actual.audience ?? '')
        && String(expected.issuerHash ?? '') === String(actual.issuerHash ?? '')
        && String(expected.subjectHash ?? '') === String(actual.subjectHash ?? '')
        && String(expected.clientIdHash ?? '') === String(actual.clientIdHash ?? '')
        && scopesEqual(expected.scopes, actual.scopes);
}

/**
 * @param {string[] | undefined} expected
 * @param {string[] | undefined} actual
 * @returns {boolean}
 */
function scopesEqual(expected = [], actual = []) {
    return [...expected].sort().join(' ') === [...actual].sort().join(' ');
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function acceptsTextEventStream(value) {
    return String(value ?? '')
        .toLowerCase()
        .split(',')
        .map((item) => item.trim().split(';')[0])
        .includes('text/event-stream');
}

/**
 * @param {McpHttpRequest} req
 * @returns {'http1' | 'http2' | 'unknown'}
 */
function detectAdapter(req) {
    const major = Number(req.httpVersionMajor ?? 0);
    if (major >= 2) return 'http2';
    if (major === 1) return 'http1';
    return 'unknown';
}

/**
 * @param {McpHttpResponse} res
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function setHeaderIfSupported(res, name, value) {
    const setHeader = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (res))['setHeader'];
    if (typeof setHeader === 'function') setHeader.call(res, name, value);
}

/**
 * @param {McpHttpResponse} res
 * @returns {void}
 */
function writeNoContentIfResponseOpen(res) {
    const response = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (res));
    if (response['headersSent'] === true || response['writableEnded'] === true) return;
    response['statusCode'] = 204;
    const end = response['end'];
    if (typeof end === 'function') end.call(res);
}

/**
 * @param {unknown} closeable
 * @returns {Promise<void>}
 */
async function safeClose(closeable) {
    const close = closeable && typeof closeable === 'object' ? /** @type {Record<string, unknown>} */ (closeable)['close'] : null;
    if (typeof close !== 'function') return;
    try {
        await close.call(closeable);
    } catch {
        // Best-effort cleanup only.
    }
}
