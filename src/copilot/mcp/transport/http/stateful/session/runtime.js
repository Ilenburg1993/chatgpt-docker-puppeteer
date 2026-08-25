// @ts-check
/**
 * Process-local runtime for MCP Streamable HTTP sessions.
 *
 * The live registry owns raw Mcp-Session-Id keys and SDK transport/server objects in memory only. Durable metadata is
 * delegated to a store that receives redacted hashes/previews and non-sensitive auth/transport metadata.
 *
 * @module copilot/mcp/transport/http/stateful/session/runtime
 */

import { createHash, createHmac } from 'node:crypto';
import {
    DEFAULT_MCP_HTTP_MAX_SESSIONS,
    DEFAULT_MCP_HTTP_SESSION_ID_SECRET,
    DEFAULT_MCP_HTTP_SESSION_TTL_MS,
} from './config.js';
import { createSqliteMcpHttpSessionStoreForDb } from './store.js';

export { DEFAULT_MCP_HTTP_MAX_SESSIONS, DEFAULT_MCP_HTTP_SESSION_TTL_MS } from './config.js';
export const MCP_HTTP_SESSION_RUNTIME_VERSION = '0.1.0';
const MAX_SESSION_ID_LENGTH = 256;
const SESSION_ID_SAFE_PATTERN = /^[\x21-\x7e]+$/u;

/**
 * @typedef {'client_delete' | 'ttl_expired' | 'server_shutdown' | 'auth_mismatch' | 'runtime_error' | 'replaced'} McpHttpSessionTerminateReason
 * @typedef {'closed' | 'close_failed'} McpHttpSessionTerminalLifecycleState
 *
 * @typedef {Readonly<{
 *     found: boolean;
 *     state: McpHttpSessionTerminalLifecycleState | 'not_found';
 *     reason: McpHttpSessionTerminateReason | null;
 *     errorCount: number;
 * }>} McpHttpSessionTerminationResult
 *
 * @typedef {object} McpHttpSessionAuthBinding
 * @property {'oauth' | 'mixed-auth' | 'none-dev' | 'secure-mcp-tunnel' | string} [mode]
 * @property {string} [issuerHash]
 * @property {string} [subjectHash]
 * @property {string} [clientIdHash]
 * @property {string} [resource]
 * @property {string} [audience]
 * @property {string[]} [scopes]
 *
 * @typedef {object} McpHttpSessionTransportBinding
 * @property {boolean} live
 * @property {number} processId
 * @property {'http1' | 'http2' | 'unknown' | string} adapter
 * @property {string} publicUrl
 *
 * @typedef {object} McpHttpLiveSessionEntry
 * @property {string} sessionIdHash
 * @property {string} sessionIdPreview
 * @property {number} createdAtMs
 * @property {number} lastSeenAtMs
 * @property {number} expiresAtMs
 * @property {string} protocolVersion
 * @property {unknown} transport
 * @property {unknown} server
 * @property {McpHttpSessionAuthBinding} authBinding
 * @property {McpHttpSessionTransportBinding} transportBinding
 *
 * @typedef {object} McpHttpSessionRuntimeOptions
 * @property {number} [ttlMs]
 * @property {number} [maxSessions]
 * @property {() => number} [now]
 * @property {string} [sessionIdSecret]
 * @property {import('./store.js').McpHttpSessionStore | null} [store]
 *
 * @typedef {object} McpHttpSessionRegisterOptions
 * @property {string} sessionId
 * @property {unknown} transport
 * @property {unknown} server
 * @property {McpHttpSessionAuthBinding} [authBinding]
 * @property {Partial<McpHttpSessionTransportBinding>} [transportBinding]
 * @property {string} [protocolVersion]
 */

/**
 * @param {McpHttpSessionRuntimeOptions} [options]
 * @returns {ReturnType<typeof buildMcpHttpSessionRuntime>}
 */
export function createMcpHttpSessionRuntime(options = {}) {
    return buildMcpHttpSessionRuntime(options);
}

/**
 * @param {McpHttpSessionRuntimeOptions} [options]
 */
function buildMcpHttpSessionRuntime(options = {}) {
    const ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_MCP_HTTP_SESSION_TTL_MS, 10_000);
    const maxSessions = normalizePositiveInteger(options.maxSessions, DEFAULT_MCP_HTTP_MAX_SESSIONS, 1);
    const now = options.now ?? (() => Date.now());
    const sessionIdSecret = options.sessionIdSecret || DEFAULT_MCP_HTTP_SESSION_ID_SECRET;
    const store = options.store === undefined ? null : options.store;
    /** @type {Map<string, McpHttpLiveSessionEntry>} */
    const sessions = new Map();
    /** @type {Map<string, { entry: McpHttpLiveSessionEntry; reason: McpHttpSessionTerminateReason; promise: Promise<McpHttpSessionTerminationResult> }>} */
    const closingSessions = new Map();
    /** @type {Map<string, { entry: McpHttpLiveSessionEntry; reason: McpHttpSessionTerminateReason; errors: Error[] }>} */
    const failedClosures = new Map();
    const counters = {
        registered: 0,
        touched: 0,
        closing: 0,
        terminated: 0,
        expired: 0,
        closeFailed: 0,
        rejected: 0,
        storeErrors: 0,
    };

    return {
        /**
         * @param {McpHttpSessionRegisterOptions} input
         * @returns {McpHttpLiveSessionEntry}
         */
        register(input) {
            const sessionId = validateRawSessionId(input.sessionId);
            if (sessions.has(sessionId) || closingSessions.has(sessionId) || failedClosures.has(sessionId)) {
                counters.rejected += 1;
                throw new Error('MCP HTTP session ID collision with an already-owned lifecycle entry.');
            }
            if (ownedSessionCount() >= maxSessions) {
                counters.rejected += 1;
                throw new Error(`MCP HTTP session limit reached: ${maxSessions}`);
            }
            const startedAt = now();
            const sessionIdHash = hashMcpHttpSessionId(sessionId, sessionIdSecret);
            const entry = {
                sessionIdHash,
                sessionIdPreview: previewMcpHttpSessionId(sessionId),
                createdAtMs: startedAt,
                lastSeenAtMs: startedAt,
                expiresAtMs: startedAt + ttlMs,
                protocolVersion: normalizeProtocolVersion(input.protocolVersion),
                transport: input.transport,
                server: input.server,
                authBinding: sanitizeAuthBinding(input.authBinding),
                transportBinding: sanitizeTransportBinding(input.transportBinding),
            };
            sessions.set(sessionId, entry);
            counters.registered += 1;
            safeStoreCall(() =>
                store?.recordSession({
                    sessionIdHash: entry.sessionIdHash,
                    sessionIdPreview: entry.sessionIdPreview,
                    protocolVersion: entry.protocolVersion,
                    createdAtMs: entry.createdAtMs,
                    lastSeenAtMs: entry.lastSeenAtMs,
                    expiresAtMs: entry.expiresAtMs,
                    status: 'active',
                    terminatedAtMs: null,
                    terminateReason: null,
                    authBinding: entry.authBinding,
                    transport: entry.transportBinding,
                }),
            );
            return redactedEntry(entry);
        },
        /**
         * @param {string} sessionId
         * @returns {Promise<McpHttpLiveSessionEntry | null>}
         */
        async get(sessionId) {
            const normalized = validateRawSessionId(sessionId);
            const entry = sessions.get(normalized);
            if (!entry) return null;
            if (entry.expiresAtMs <= now()) {
                await terminateEntry(normalized, entry, 'ttl_expired');
                return null;
            }
            return redactedEntry(entry);
        },
        /**
         * @param {string} sessionId
         * @returns {Promise<McpHttpLiveSessionEntry | null>}
         */
        async touch(sessionId) {
            const normalized = validateRawSessionId(sessionId);
            const entry = sessions.get(normalized);
            if (!entry) return null;
            if (entry.expiresAtMs <= now()) {
                await terminateEntry(normalized, entry, 'ttl_expired');
                return null;
            }
            const current = now();
            entry.lastSeenAtMs = current;
            entry.expiresAtMs = current + ttlMs;
            counters.touched += 1;
            safeStoreCall(() => store?.touchSession(entry.sessionIdHash, entry.lastSeenAtMs, entry.expiresAtMs));
            return redactedEntry(entry);
        },
        /**
         * @param {string} sessionId
         * @param {McpHttpSessionTerminateReason} [reason]
         * @returns {Promise<McpHttpSessionTerminationResult>}
         */
        async terminate(sessionId, reason = 'client_delete') {
            const normalized = validateRawSessionId(sessionId);
            const active = sessions.get(normalized);
            if (active) return terminateEntry(normalized, active, reason);
            const closing = closingSessions.get(normalized);
            if (closing) return closing.promise;
            const failed = failedClosures.get(normalized);
            if (failed) {
                return Object.freeze({
                    found: true,
                    state: 'close_failed',
                    reason: failed.reason,
                    errorCount: failed.errors.length,
                });
            }
            return Object.freeze({ found: false, state: 'not_found', reason: null, errorCount: 0 });
        },
        /**
         * @returns {number}
         */
        sweepExpired,
        /**
         * @returns {Record<string, unknown>}
         */
        snapshot() {
            const policy = { ttlMs, maxSessions };
            return {
                version: MCP_HTTP_SESSION_RUNTIME_VERSION,
                activeSessions: sessions.size,
                closingSessions: closingSessions.size,
                closeFailedSessions: failedClosures.size,
                ownedSessions: ownedSessionCount(),
                policy,
                counters: { ...counters },
                sessions: [...sessions.values()].map((entry) => snapshotEntry(entry, 'active')),
                closing: [...closingSessions.values()].map(({ entry, reason }) => ({
                    ...snapshotEntry(entry, 'closing'),
                    terminateReason: reason,
                })),
                closeFailed: [...failedClosures.values()].map(({ entry, reason, errors }) => ({
                    ...snapshotEntry(entry, 'close_failed'),
                    terminateReason: reason,
                    closeErrorCount: errors.length,
                })),
            };
        },
        /**
         * @returns {Promise<Readonly<{ closed: number; closeFailed: number }>>}
         */
        async reset() {
            const activeResults = await Promise.all(
                [...sessions.entries()].map(([sessionId, entry]) =>
                    terminateEntry(sessionId, entry, 'server_shutdown'),
                ),
            );
            const closingResults = await Promise.all([...closingSessions.values()].map(({ promise }) => promise));
            const results = [...activeResults, ...closingResults];
            return Object.freeze({
                closed: results.filter((result) => result.state === 'closed').length,
                closeFailed: failedClosures.size,
            });
        },
    };

    /** @returns {number} */
    function ownedSessionCount() {
        return sessions.size + closingSessions.size + failedClosures.size;
    }

    /** @returns {Promise<number>} */
    async function sweepExpired() {
        const current = now();
        const expired = [...sessions.entries()].filter(([, entry]) => entry.expiresAtMs <= current);
        await Promise.all(expired.map(([sessionId, entry]) => terminateEntry(sessionId, entry, 'ttl_expired')));
        // Persisted active rows from a previous process no longer own live resources in this runtime; they can be
        // classified as expired directly after every process-local expired owner has finished its close lifecycle.
        safeStoreCall(() => store?.sweepExpired(current));
        return expired.length;
    }

    /**
     * @param {string} sessionId
     * @param {McpHttpLiveSessionEntry} entry
     * @param {McpHttpSessionTerminateReason} reason
     * @returns {Promise<McpHttpSessionTerminationResult>}
     */
    function terminateEntry(sessionId, entry, reason) {
        const existing = closingSessions.get(sessionId);
        if (existing) return existing.promise;

        sessions.delete(sessionId);
        counters.closing += 1;
        safeStoreCall(() => store?.beginSessionClose(entry.sessionIdHash, reason));

        const promise = (async () => {
            const closeErrors = (
                await Promise.all([
                    closeLiveObject(entry.transport, 'transport'),
                    closeLiveObject(entry.server, 'server'),
                ])
            ).filter((error) => error !== null);
            counters.closing = Math.max(0, counters.closing - 1);
            closingSessions.delete(sessionId);

            if (closeErrors.length > 0) {
                counters.closeFailed += 1;
                failedClosures.set(sessionId, { entry, reason, errors: closeErrors });
                safeStoreCall(() => store?.failSessionClose(entry.sessionIdHash, now(), reason));
                return Object.freeze({
                    found: true,
                    state: 'close_failed',
                    reason,
                    errorCount: closeErrors.length,
                });
            }

            counters.terminated += 1;
            if (reason === 'ttl_expired') counters.expired += 1;
            safeStoreCall(() => store?.completeSessionClose(entry.sessionIdHash, now(), reason));
            return Object.freeze({ found: true, state: 'closed', reason, errorCount: 0 });
        })();

        closingSessions.set(sessionId, { entry, reason, promise });
        return promise;
    }

    /**
     * @param {() => void} fn
     * @returns {void}
     */
    function safeStoreCall(fn) {
        try {
            fn();
        } catch {
            counters.storeErrors += 1;
        }
    }
}

/**
 * Create one session runtime bound to one immutable stateful-process configuration generation. Listener/request-handler
 * composition owns the resulting runtime; the session module never keeps a process-global default instance.
 *
 * @param {import('./config.js').McpHttpStatefulProcessConfig} config
 * @param {{ database?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort; store?: import('./store.js').McpHttpSessionStore | null }} [options]
 * @returns {ReturnType<typeof createMcpHttpSessionRuntime>}
 */
export function createMcpHttpSessionRuntimeForConfig(config, options = {}) {
    if (!config || config.kind !== 'copilot-mcp-http-stateful-process-config') {
        throw new TypeError('MCP HTTP session runtime requires a normalized stateful process configuration.');
    }
    if (options.database && options.store !== undefined) {
        throw new TypeError('MCP HTTP session runtime accepts either database or store authority, not both.');
    }
    const store = options.database
        ? createSqliteMcpHttpSessionStoreForDb(options.database)
        : options.store === undefined
          ? null
          : options.store;
    return createMcpHttpSessionRuntime({
        ttlMs: config.policy.ttlMs,
        maxSessions: config.policy.maxSessions,
        sessionIdSecret: config.sessionIdHashSecret,
        store,
    });
}

/**
 * Project one explicit session runtime/config pair without consulting ambient or module-global state.
 *
 * @param {ReturnType<typeof createMcpHttpSessionRuntime>} runtime
 * @param {import('./config.js').McpHttpStatefulProcessConfig} config
 * @returns {Record<string, unknown>}
 */
export function readMcpHttpSessionRuntimeState(runtime, config) {
    if (!runtime || typeof runtime.snapshot !== 'function') {
        throw new TypeError('MCP HTTP session runtime state requires an explicit runtime capability.');
    }
    if (!config || config.kind !== 'copilot-mcp-http-stateful-process-config') {
        throw new TypeError('MCP HTTP session runtime state requires an explicit stateful process config.');
    }
    const snapshot = runtime.snapshot();
    const runtimePolicy =
        snapshot['policy'] && typeof snapshot['policy'] === 'object'
            ? /** @type {{ ttlMs?: unknown; maxSessions?: unknown }} */ (snapshot['policy'])
            : {};
    const posture = config.posture;
    return {
        activeSessions: Number(snapshot['activeSessions'] ?? 0),
        closingSessions: Number(snapshot['closingSessions'] ?? 0),
        closeFailedSessions: Number(snapshot['closeFailedSessions'] ?? 0),
        ownedSessions: Number(snapshot['ownedSessions'] ?? 0),
        enabled: posture.enabled,
        requested: posture.requested,
        statelessCompat: posture.statelessCompat,
        reason: posture.reason,
        ttlMs: Number(runtimePolicy.ttlMs ?? posture.ttlMs),
        maxSessions: Number(runtimePolicy.maxSessions ?? posture.maxSessions),
        runtimeVersion: MCP_HTTP_SESSION_RUNTIME_VERSION,
        counters: snapshot['counters'],
    };
}

/**
 * @param {string} sessionId
 * @param {string} [secret]
 * @returns {string}
 */
export function hashMcpHttpSessionId(sessionId, secret = DEFAULT_MCP_HTTP_SESSION_ID_SECRET) {
    const normalized = validateRawSessionId(sessionId);
    return createHmac('sha256', secret).update(normalized).digest('hex');
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function previewMcpHttpSessionId(sessionId) {
    const normalized = validateRawSessionId(sessionId);
    const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    return `${normalized.slice(0, 4)}…${digest}`;
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function validateRawSessionId(sessionId) {
    const normalized = String(sessionId ?? '').trim();
    if (!normalized) throw new Error('MCP session ID is required.');
    if (normalized.length > MAX_SESSION_ID_LENGTH) throw new Error('MCP session ID is too long.');
    if (!SESSION_ID_SAFE_PATTERN.test(normalized)) throw new Error('MCP session ID contains unsafe characters.');
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {McpHttpSessionAuthBinding}
 */
function sanitizeAuthBinding(value) {
    const input = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
    return {
        mode: boundedString(input['mode'], 64),
        issuerHash: boundedString(input['issuerHash'], 128),
        subjectHash: boundedString(input['subjectHash'], 128),
        clientIdHash: boundedString(input['clientIdHash'], 128),
        resource: boundedString(input['resource'], 512),
        audience: boundedString(input['audience'], 512),
        scopes: Array.isArray(input['scopes'])
            ? input['scopes']
                  .map((item) => boundedString(item, 128))
                  .filter(Boolean)
                  .slice(0, 64)
            : [],
    };
}

/**
 * @param {unknown} value
 * @returns {McpHttpSessionTransportBinding}
 */
function sanitizeTransportBinding(value) {
    const input = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
    return {
        live: true,
        processId: process.pid,
        adapter: boundedString(input['adapter'], 32) || 'unknown',
        publicUrl: boundedString(input['publicUrl'], 2048),
    };
}

/**
 * @param {unknown} object
 * @param {string} kind
 * @returns {Promise<Error | null>}
 */
async function closeLiveObject(object, kind) {
    const close =
        object && typeof object === 'object' ? /** @type {Record<string, unknown>} */ (object)['close'] : null;
    if (typeof close !== 'function') return null;
    try {
        await close.call(object);
        return null;
    } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        return new Error(`MCP session ${kind} close failed: ${cause.message}`, { cause });
    }
}

/**
 * @param {McpHttpLiveSessionEntry} entry
 * @param {'active' | 'closing' | 'close_failed'} lifecycle
 * @returns {Record<string, unknown>}
 */
function snapshotEntry(entry, lifecycle) {
    return {
        lifecycle,
        sessionIdHash: entry.sessionIdHash,
        sessionIdPreview: entry.sessionIdPreview,
        protocolVersion: entry.protocolVersion,
        createdAtMs: entry.createdAtMs,
        lastSeenAtMs: entry.lastSeenAtMs,
        expiresAtMs: entry.expiresAtMs,
        authBinding: entry.authBinding,
        transportBinding: entry.transportBinding,
    };
}

/**
 * @param {McpHttpLiveSessionEntry} entry
 * @returns {McpHttpLiveSessionEntry}
 */
function redactedEntry(entry) {
    return { ...entry };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeProtocolVersion(value) {
    const normalized = boundedString(value, 32);
    return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : '2025-11-25';
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function boundedString(value, maxLength) {
    const raw = String(value ?? '');
    let normalized = '';
    for (let index = 0; index < raw.length; index += 1) {
        const code = raw.charCodeAt(index);
        if (code <= 31 || code === 127) continue;
        normalized += raw[index];
    }
    return normalized.trim().slice(0, maxLength);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, minimum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}
