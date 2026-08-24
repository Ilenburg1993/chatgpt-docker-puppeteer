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
import { createSqliteMcpHttpSessionStoreForDb } from './store.js';

export const DEFAULT_MCP_HTTP_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MCP_HTTP_MAX_SESSIONS = 256;
export const MCP_HTTP_SESSION_RUNTIME_VERSION = '0.1.0';

const DEFAULT_SESSION_ID_SECRET = 'copilot-mcp-http-session-id-v1';
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
 * @typedef {object} McpHttpSessionPolicy
 * @property {boolean} enabled
 * @property {boolean} requested
 * @property {boolean} statelessCompat
 * @property {number} ttlMs
 * @property {number} maxSessions
 * @property {string} reason
 *
 * @typedef {McpHttpSessionPolicy & {
 *     postSessionContractEnforced: boolean;
 *     sessionIdHashSecretPresent: boolean;
 *     statelessFallbackPossible: boolean;
 * }} McpHttpStatefulRuntimePolicySnapshot
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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpSessionPolicy}
 */
export function readMcpHttpStatefulSessionPolicy(env = process.env) {
    const raw = String(env['COPILOT_MCP_HTTP_STATEFUL_SESSIONS'] ?? '')
        .trim()
        .toLowerCase();
    const explicitTrue = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on' || raw === 'experimental';
    const explicitFalse = raw === 'false' || raw === '0' || raw === 'no' || raw === 'off' || raw === 'disabled';
    const oauthEnforcementRequiresStateful =
        !explicitFalse &&
        String(env['COPILOT_MCP_AUTH_MODE'] ?? '')
            .trim()
            .toLowerCase() === 'oauth' &&
        String(env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? '')
            .trim()
            .toLowerCase() === 'all';
    const requested = explicitTrue || oauthEnforcementRequiresStateful;
    const statelessCompat = readBooleanEnv(env, 'COPILOT_MCP_HTTP_STATELESS_COMPAT', false);
    const enabled = requested && !statelessCompat;
    return {
        enabled,
        requested,
        statelessCompat,
        ttlMs: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP_SESSION_TTL_MS', DEFAULT_MCP_HTTP_SESSION_TTL_MS, 10_000),
        maxSessions: readPositiveIntegerEnv(env, 'COPILOT_MCP_HTTP_MAX_SESSIONS', DEFAULT_MCP_HTTP_MAX_SESSIONS, 1),
        reason: enabled
            ? explicitTrue
                ? 'stateful-session-runtime-enabled-by-policy'
                : 'stateful-session-runtime-enabled-by-oauth-enforcement'
            : statelessCompat
              ? 'stateless-compatibility-fallback-enabled'
              : explicitFalse
                ? 'stateful-session-runtime-explicitly-disabled'
                : 'stateful-session-runtime-disabled-until-opt-in',
    };
}

/**
 * Return a sanitized policy/posture snapshot owned by the stateful transport boundary. Secret material is never
 * returned; only whether an explicit session-id hash secret meets the minimum operational length is exposed.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttpStatefulRuntimePolicySnapshot}
 */
export function readMcpHttpStatefulRuntimePolicySnapshot(env = process.env) {
    const policy = readMcpHttpStatefulSessionPolicy(env);
    const sessionIdSecret = env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'];
    return {
        ...policy,
        postSessionContractEnforced: readBooleanEnv(env, 'COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT', false),
        sessionIdHashSecretPresent: typeof sessionIdSecret === 'string' && sessionIdSecret.trim().length >= 32,
        statelessFallbackPossible: !policy.enabled,
    };
}

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
    const sessionIdSecret =
        options.sessionIdSecret || process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'] || DEFAULT_SESSION_ID_SECRET;
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

let defaultRuntime = createMcpHttpSessionRuntime({ store: null });
let defaultRuntimeStoreKind = /** @type {'memory' | 'sqlite'} */ ('memory');

/**
 * The default singleton does not create SQLite until explicitly enabled by the HTTP adapter in later migration phases.
 * Faixa 2 exposes the runtime and durable store separately; Faixa 3 wires live transports into it.
 *
 * @returns {ReturnType<typeof createMcpHttpSessionRuntime>}
 */
export function getDefaultMcpHttpSessionRuntime() {
    return defaultRuntime;
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @returns {Promise<ReturnType<typeof createMcpHttpSessionRuntime>>}
 */
export async function createDefaultMcpHttpSessionRuntimeWithSqliteStore(db) {
    if (!db) throw new Error('SQLite-backed MCP session runtime requires an injected database capability.');
    if (defaultRuntimeStoreKind === 'sqlite') return defaultRuntime;
    const reset = await defaultRuntime.reset();
    if (reset.closeFailed > 0) {
        throw new Error(
            `Cannot replace MCP HTTP session runtime while ${reset.closeFailed} owned resource(s) failed to close.`,
        );
    }
    defaultRuntime = createMcpHttpSessionRuntime({ store: createSqliteMcpHttpSessionStoreForDb(db) });
    defaultRuntimeStoreKind = 'sqlite';
    return defaultRuntime;
}

/**
 * @param {McpHttpSessionRuntimeOptions} [options]
 * @returns {Promise<void>}
 */
export async function resetDefaultMcpHttpSessionRuntimeForTests(options = {}) {
    const reset = await defaultRuntime.reset();
    if (reset.closeFailed > 0) {
        throw new Error(
            `Cannot reset MCP HTTP session runtime while ${reset.closeFailed} owned resource(s) failed to close.`,
        );
    }
    defaultRuntime = createMcpHttpSessionRuntime({ store: null, ...options });
    defaultRuntimeStoreKind = options.store ? 'sqlite' : 'memory';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown>}
 */
export function readMcpHttpSessionRuntimeState(env = process.env) {
    const policy = readMcpHttpStatefulSessionPolicy(env);
    const snapshot = defaultRuntime.snapshot();
    return {
        activeSessions: Number(snapshot['activeSessions'] ?? 0),
        closingSessions: Number(snapshot['closingSessions'] ?? 0),
        closeFailedSessions: Number(snapshot['closeFailedSessions'] ?? 0),
        ownedSessions: Number(snapshot['ownedSessions'] ?? 0),
        enabled: policy.enabled,
        requested: policy.requested,
        statelessCompat: policy.statelessCompat,
        reason: policy.reason,
        ttlMs: policy.ttlMs,
        maxSessions: policy.maxSessions,
        runtimeVersion: MCP_HTTP_SESSION_RUNTIME_VERSION,
        counters: snapshot['counters'],
    };
}

/**
 * @param {string} sessionId
 * @param {string} [secret]
 * @returns {string}
 */
export function hashMcpHttpSessionId(sessionId, secret = DEFAULT_SESSION_ID_SECRET) {
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
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum) {
    return normalizePositiveInteger(env[name], fallback, minimum);
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
