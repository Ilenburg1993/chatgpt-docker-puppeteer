// @ts-check
/**
 * Process-local runtime for MCP Streamable HTTP sessions.
 *
 * The live registry owns raw Mcp-Session-Id keys and SDK transport/server objects in memory only. Durable metadata is
 * delegated to a store that receives redacted hashes/previews and non-sensitive auth/transport metadata.
 *
 * @module copilot/mcp/control-plane/session-runtime
 */

import { createHash, createHmac } from 'node:crypto';
import { createSqliteMcpHttpSessionStore } from './session-store.js';

export const DEFAULT_MCP_HTTP_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MCP_HTTP_MAX_SESSIONS = 256;
export const MCP_HTTP_SESSION_RUNTIME_VERSION = '0.1.0';

const DEFAULT_SESSION_ID_SECRET = 'copilot-mcp-http-session-id-v1';
const MAX_SESSION_ID_LENGTH = 256;
const SESSION_ID_SAFE_PATTERN = /^[\x21-\x7e]+$/u;

/**
 * @typedef {'client_delete' | 'ttl_expired' | 'server_shutdown' | 'auth_mismatch' | 'runtime_error' | 'replaced'} McpHttpSessionTerminateReason
 *
 * @typedef {object} McpHttpSessionPolicy
 * @property {boolean} enabled
 * @property {boolean} requested
 * @property {boolean} statelessCompat
 * @property {number} ttlMs
 * @property {number} maxSessions
 * @property {string} reason
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
 * @property {import('./session-store.js').McpHttpSessionStore | null} [store]
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
        String(env['COPILOT_MCP_AUTH_MODE'] ?? '').trim().toLowerCase() === 'oauth' &&
        String(env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? '').trim().toLowerCase() === 'all';
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
    const sessionIdSecret = options.sessionIdSecret || process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'] || DEFAULT_SESSION_ID_SECRET;
    const store = options.store === undefined ? null : options.store;
    /** @type {Map<string, McpHttpLiveSessionEntry>} */
    const sessions = new Map();
    const counters = {
        registered: 0,
        touched: 0,
        terminated: 0,
        expired: 0,
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
            const existing = sessions.get(sessionId);
            if (existing) terminateEntry(sessionId, existing, 'replaced');
            sweepExpired();
            if (!sessions.has(sessionId) && sessions.size >= maxSessions) {
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
         * @returns {McpHttpLiveSessionEntry | null}
         */
        get(sessionId) {
            const normalized = validateRawSessionId(sessionId);
            const entry = sessions.get(normalized);
            if (!entry) return null;
            if (entry.expiresAtMs <= now()) {
                terminateEntry(normalized, entry, 'ttl_expired');
                counters.expired += 1;
                return null;
            }
            return redactedEntry(entry);
        },
        /**
         * @param {string} sessionId
         * @returns {McpHttpLiveSessionEntry | null}
         */
        touch(sessionId) {
            const normalized = validateRawSessionId(sessionId);
            const entry = sessions.get(normalized);
            if (!entry) return null;
            if (entry.expiresAtMs <= now()) {
                terminateEntry(normalized, entry, 'ttl_expired');
                counters.expired += 1;
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
         * @returns {boolean}
         */
        terminate(sessionId, reason = 'client_delete') {
            const normalized = validateRawSessionId(sessionId);
            const entry = sessions.get(normalized);
            if (!entry) return false;
            terminateEntry(normalized, entry, reason);
            return true;
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
                policy,
                counters: { ...counters },
                sessions: [...sessions.values()].map((entry) => ({
                    sessionIdHash: entry.sessionIdHash,
                    sessionIdPreview: entry.sessionIdPreview,
                    protocolVersion: entry.protocolVersion,
                    createdAtMs: entry.createdAtMs,
                    lastSeenAtMs: entry.lastSeenAtMs,
                    expiresAtMs: entry.expiresAtMs,
                    authBinding: entry.authBinding,
                    transportBinding: entry.transportBinding,
                })),
            };
        },
        /** @returns {void} */
        reset() {
            for (const [sessionId, entry] of sessions) terminateEntry(sessionId, entry, 'server_shutdown');
            sessions.clear();
        },
    };

    /** @returns {number} */
    function sweepExpired() {
        const current = now();
        let count = 0;
        for (const [sessionId, entry] of sessions) {
            if (entry.expiresAtMs > current) continue;
            terminateEntry(sessionId, entry, 'ttl_expired');
            counters.expired += 1;
            count += 1;
        }
        safeStoreCall(() => store?.sweepExpired(current));
        return count;
    }

    /**
     * @param {string} sessionId
     * @param {McpHttpLiveSessionEntry} entry
     * @param {McpHttpSessionTerminateReason} reason
     * @returns {void}
     */
    function terminateEntry(sessionId, entry, reason) {
        sessions.delete(sessionId);
        counters.terminated += 1;
        closeLiveObject(entry.transport);
        closeLiveObject(entry.server);
        safeStoreCall(() => store?.terminateSession(entry.sessionIdHash, now(), reason));
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
 * @returns {ReturnType<typeof createMcpHttpSessionRuntime>}
 */
export function createDefaultMcpHttpSessionRuntimeWithSqliteStore() {
    if (defaultRuntimeStoreKind === 'sqlite') return defaultRuntime;
    defaultRuntime.reset();
    defaultRuntime = createMcpHttpSessionRuntime({ store: createSqliteMcpHttpSessionStore() });
    defaultRuntimeStoreKind = 'sqlite';
    return defaultRuntime;
}

/**
 * @param {McpHttpSessionRuntimeOptions} [options]
 * @returns {void}
 */
export function resetDefaultMcpHttpSessionRuntimeForTests(options = {}) {
    defaultRuntime.reset();
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
            ? input['scopes'].map((item) => boundedString(item, 128)).filter(Boolean).slice(0, 64)
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
 * @returns {void}
 */
function closeLiveObject(object) {
    const close = object && typeof object === 'object' ? /** @type {Record<string, unknown>} */ (object)['close'] : null;
    if (typeof close !== 'function') return;
    try {
        void close.call(object);
    } catch {
        // Best-effort close only. Faixa 3 adds adapter-level close accounting.
    }
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
