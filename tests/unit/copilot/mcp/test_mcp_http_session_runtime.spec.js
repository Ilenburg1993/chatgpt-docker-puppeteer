// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
/**
 * Tests for MCP Streamable HTTP process-local session runtime and redacted SQLite metadata store.
 */

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    hashMcpHttpSessionId,
    readMcpHttpStatefulRuntimePolicySnapshot,
    readMcpHttpStatefulSessionPolicy,
} from '#copilot/mcp/public/transport/http/stateful';
import {
    createMcpHttpSessionRuntime,
    createSqliteMcpHttpSessionStoreForDb,
    previewMcpHttpSessionId,
} from '#copilot/testing/mcp/transport/http/stateful';

describe('MCP HTTP stateful session runtime', () => {
    it('keeps raw session IDs process-local and exposes only redacted metadata', async () => {
        let now = 1_000;
        const runtime = createMcpHttpSessionRuntime({
            now: () => now,
            ttlMs: 10_000,
            maxSessions: 2,
            store: null,
            sessionIdSecret: 'unit-secret',
        });
        const transport = {
            closed: 0,
            close() {
                this.closed += 1;
            },
        };
        const server = {
            closed: 0,
            close() {
                this.closed += 1;
            },
        };

        const entry = runtime.register({
            sessionId: 'session-abc-123',
            transport,
            server,
            protocolVersion: '2025-11-25',
            authBinding: {
                mode: 'oauth',
                subjectHash: 'subhash',
                resource: 'https://mcp.aurelin.org/mcp',
                audience: 'https://mcp.aurelin.org',
                scopes: ['repo:read'],
            },
            transportBinding: { adapter: 'http2', publicUrl: 'https://mcp.aurelin.org/mcp' },
        });

        assert.equal(entry.sessionIdHash, hashMcpHttpSessionId('session-abc-123', 'unit-secret'));
        assert.equal(entry.sessionIdPreview, previewMcpHttpSessionId('session-abc-123'));
        assert.equal(Object.hasOwn(entry, 'sessionId'), false);

        const snapshot = runtime.snapshot();
        assert.equal(snapshot['activeSessions'], 1);
        assert.equal(JSON.stringify(snapshot).includes('session-abc-123'), false);

        now += 500;
        const touched = await runtime.touch('session-abc-123');
        assert.equal(touched?.lastSeenAtMs, 1_500);
        assert.equal(touched?.expiresAtMs, 11_500);

        const termination = await runtime.terminate('session-abc-123', 'client_delete');
        assert.deepEqual(termination, { found: true, state: 'closed', reason: 'client_delete', errorCount: 0 });
        assert.equal(transport.closed, 1);
        assert.equal(server.closed, 1);
        assert.equal(runtime.snapshot()['activeSessions'], 0);
    });

    it('expires idle sessions and enforces maxSessions', async () => {
        let now = 10;
        const runtime = createMcpHttpSessionRuntime({ now: () => now, ttlMs: 10_000, maxSessions: 1, store: null });
        runtime.register({ sessionId: 'a', transport: {}, server: {} });

        assert.throws(() => runtime.register({ sessionId: 'b', transport: {}, server: {} }), /session limit/u);

        now = 10_011;
        assert.equal(await runtime.get('a'), null);
        assert.equal(runtime.snapshot()['activeSessions'], 0);
        runtime.register({ sessionId: 'b', transport: {}, server: {} });
        assert.equal(runtime.snapshot()['activeSessions'], 1);
    });

    it('persists only redacted session metadata in SQLite', async () => {
        const db = new Database(':memory:');
        try {
            const store = createSqliteMcpHttpSessionStoreForDb(adaptBetterSqliteDatabase(db));
            let now = 100;
            const runtime = createMcpHttpSessionRuntime({
                now: () => now,
                ttlMs: 10_000,
                maxSessions: 2,
                store,
                sessionIdSecret: 'unit-secret',
            });
            runtime.register({
                sessionId: 'raw-session-secret',
                transport: {},
                server: {},
                authBinding: { mode: 'oauth', subjectHash: 'subject-hash', scopes: ['repo:read', 'repo:write'] },
            });

            const hash = hashMcpHttpSessionId('raw-session-secret', 'unit-secret');
            const stored = store.readSession(hash);
            assert.equal(stored?.sessionIdHash, hash);
            assert.equal(stored?.status, 'active');
            assert.equal(JSON.stringify(stored).includes('raw-session-secret'), false);

            now = 10_101;
            assert.equal(await runtime.get('raw-session-secret'), null);
            const expired = store.readSession(hash);
            assert.equal(expired?.status, 'expired');
            assert.equal(expired?.terminateReason, 'ttl_expired');
        } finally {
            db.close();
        }
    });

    it('does not declare termination before asynchronous resource closure settles', async () => {
        const transportClose = Promise.withResolvers();
        const serverClose = Promise.withResolvers();
        const runtime = createMcpHttpSessionRuntime({ store: null, maxSessions: 2 });
        runtime.register({
            sessionId: 'async-close',
            transport: { close: () => transportClose.promise },
            server: { close: () => serverClose.promise },
        });

        const terminationPromise = runtime.terminate('async-close', 'client_delete');
        const closing = runtime.snapshot();
        assert.equal(closing['activeSessions'], 0);
        assert.equal(closing['closingSessions'], 1);
        assert.equal(/** @type {Record<string, number>} */ (closing['counters'])['terminated'], 0);

        transportClose.resolve(undefined);
        serverClose.resolve(undefined);
        const termination = await terminationPromise;

        assert.deepEqual(termination, { found: true, state: 'closed', reason: 'client_delete', errorCount: 0 });
        const closed = runtime.snapshot();
        assert.equal(closed['closingSessions'], 0);
        assert.equal(closed['closeFailedSessions'], 0);
        assert.equal(/** @type {Record<string, number>} */ (closed['counters'])['terminated'], 1);
    });

    it('classifies close failure explicitly and persists close_failed instead of terminated', async () => {
        const db = new Database(':memory:');
        try {
            const store = createSqliteMcpHttpSessionStoreForDb(adaptBetterSqliteDatabase(db));
            const runtime = createMcpHttpSessionRuntime({ store, sessionIdSecret: 'unit-secret' });
            runtime.register({
                sessionId: 'close-fails',
                transport: {
                    async close() {
                        throw new Error('transport refused close');
                    },
                },
                server: { close() {} },
            });
            const hash = hashMcpHttpSessionId('close-fails', 'unit-secret');

            const termination = await runtime.terminate('close-fails', 'runtime_error');
            assert.deepEqual(termination, {
                found: true,
                state: 'close_failed',
                reason: 'runtime_error',
                errorCount: 1,
            });
            const snapshot = runtime.snapshot();
            assert.equal(snapshot['activeSessions'], 0);
            assert.equal(snapshot['closingSessions'], 0);
            assert.equal(snapshot['closeFailedSessions'], 1);
            assert.equal(/** @type {Record<string, number>} */ (snapshot['counters'])['terminated'], 0);
            assert.equal(/** @type {Record<string, number>} */ (snapshot['counters'])['closeFailed'], 1);

            const stored = store.readSession(hash);
            assert.equal(stored?.status, 'close_failed');
            assert.equal(stored?.terminateReason, 'runtime_error');
        } finally {
            db.close();
        }
    });

    it('migrates the pre-lifecycle SQLite schema without losing stored session metadata', () => {
        const db = new Database(':memory:');
        try {
            db.exec(`
                CREATE TABLE copilot_mcp_http_sessions (
                    session_id_hash TEXT PRIMARY KEY,
                    session_id_preview TEXT NOT NULL,
                    protocol_version TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    last_seen_at_ms INTEGER NOT NULL,
                    expires_at_ms INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active', 'terminated', 'expired')),
                    terminated_at_ms INTEGER,
                    terminate_reason TEXT,
                    auth_binding_json TEXT NOT NULL,
                    transport_json TEXT NOT NULL
                ) STRICT;
                INSERT INTO copilot_mcp_http_sessions VALUES (
                    'legacy-hash', 'lega…12345678', '2025-11-25', 1, 2, 3,
                    'active', NULL, NULL, '{}', '{}'
                );
            `);
            const store = createSqliteMcpHttpSessionStoreForDb(adaptBetterSqliteDatabase(db));
            const preserved = store.readSession('legacy-hash');
            assert.equal(preserved?.status, 'active');
            assert.equal(preserved?.protocolVersion, '2025-11-25');

            store.beginSessionClose('legacy-hash', 'server_shutdown');
            assert.equal(store.readSession('legacy-hash')?.status, 'closing');
            store.failSessionClose('legacy-hash', 4, 'server_shutdown');
            assert.equal(store.readSession('legacy-hash')?.status, 'close_failed');
        } finally {
            db.close();
        }
    });

    it('enables stateful policy when explicitly requested or required by OAuth-all, unless stateless fallback is explicit', () => {
        assert.deepEqual(readMcpHttpStatefulSessionPolicy({ COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true' }), {
            enabled: true,
            requested: true,
            statelessCompat: false,
            ttlMs: 600_000,
            maxSessions: 256,
            reason: 'stateful-session-runtime-enabled-by-policy',
        });
        assert.deepEqual(
            readMcpHttpStatefulSessionPolicy({
                COPILOT_MCP_AUTH_MODE: 'oauth',
                COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            }),
            {
                enabled: true,
                requested: true,
                statelessCompat: false,
                ttlMs: 600_000,
                maxSessions: 256,
                reason: 'stateful-session-runtime-enabled-by-oauth-enforcement',
            },
        );
        assert.equal(
            readMcpHttpStatefulSessionPolicy({
                COPILOT_MCP_AUTH_MODE: 'oauth',
                COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
                COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'false',
            }).enabled,
            false,
        );
        assert.equal(
            readMcpHttpStatefulSessionPolicy({
                COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true',
                COPILOT_MCP_HTTP_STATELESS_COMPAT: 'true',
            }).enabled,
            false,
        );
    });

    it('owns sanitized stateful transport posture without exposing the session hash secret', () => {
        const env = {
            COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true',
            COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT: 'true',
            COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET: 'x'.repeat(32),
        };
        const snapshot = readMcpHttpStatefulRuntimePolicySnapshot(env);

        assert.equal(snapshot.enabled, true);
        assert.equal(snapshot.postSessionContractEnforced, true);
        assert.equal(snapshot.sessionIdHashSecretPresent, true);
        assert.equal(snapshot.statelessFallbackPossible, false);
        assert.equal(JSON.stringify(snapshot).includes(env.COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET), false);
        assert.equal(
            readMcpHttpStatefulRuntimePolicySnapshot({
                COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'false',
                COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET: 'short',
            }).sessionIdHashSecretPresent,
            false,
        );
    });
});
