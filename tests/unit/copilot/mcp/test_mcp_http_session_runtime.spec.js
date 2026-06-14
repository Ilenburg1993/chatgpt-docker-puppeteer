// @ts-check
/**
 * Tests for MCP Streamable HTTP process-local session runtime and redacted SQLite metadata store.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';

import {
    createMcpHttpSessionRuntime,
    createSqliteMcpHttpSessionStoreForDb,
    hashMcpHttpSessionId,
    previewMcpHttpSessionId,
    readMcpHttpStatefulSessionPolicy,
} from '#copilot/mcp/control-plane';

describe('MCP HTTP stateful session runtime', () => {
    it('keeps raw session IDs process-local and exposes only redacted metadata', () => {
        let now = 1_000;
        const runtime = createMcpHttpSessionRuntime({ now: () => now, ttlMs: 10_000, maxSessions: 2, store: null, sessionIdSecret: 'unit-secret' });
        const transport = { closed: 0, close() { this.closed += 1; } };
        const server = { closed: 0, close() { this.closed += 1; } };

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
        assert.equal(snapshot.activeSessions, 1);
        assert.equal(JSON.stringify(snapshot).includes('session-abc-123'), false);

        now += 500;
        const touched = runtime.touch('session-abc-123');
        assert.equal(touched?.lastSeenAtMs, 1_500);
        assert.equal(touched?.expiresAtMs, 11_500);

        assert.equal(runtime.terminate('session-abc-123', 'client_delete'), true);
        assert.equal(transport.closed, 1);
        assert.equal(server.closed, 1);
        assert.equal(runtime.snapshot().activeSessions, 0);
    });

    it('expires idle sessions and enforces maxSessions', () => {
        let now = 10;
        const runtime = createMcpHttpSessionRuntime({ now: () => now, ttlMs: 10_000, maxSessions: 1, store: null });
        runtime.register({ sessionId: 'a', transport: {}, server: {} });

        assert.throws(() => runtime.register({ sessionId: 'b', transport: {}, server: {} }), /session limit/u);

        now = 10_011;
        assert.equal(runtime.get('a'), null);
        assert.equal(runtime.snapshot().activeSessions, 0);
        runtime.register({ sessionId: 'b', transport: {}, server: {} });
        assert.equal(runtime.snapshot().activeSessions, 1);
    });

    it('persists only redacted session metadata in SQLite', () => {
        const db = new Database(':memory:');
        try {
            const store = createSqliteMcpHttpSessionStoreForDb(db);
            let now = 100;
            const runtime = createMcpHttpSessionRuntime({ now: () => now, ttlMs: 10_000, maxSessions: 2, store, sessionIdSecret: 'unit-secret' });
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
            assert.equal(runtime.get('raw-session-secret'), null);
            const expired = store.readSession(hash);
            assert.equal(expired?.status, 'expired');
            assert.equal(expired?.terminateReason, 'ttl_expired');
        } finally {
            db.close();
        }
    });

    it('enables stateful policy only when explicitly requested and not in stateless fallback', () => {
        assert.deepEqual(
            readMcpHttpStatefulSessionPolicy({ COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true' }),
            {
                enabled: true,
                requested: true,
                statelessCompat: false,
                ttlMs: 600_000,
                maxSessions: 256,
                reason: 'stateful-session-runtime-enabled-by-policy',
            },
        );
        assert.equal(
            readMcpHttpStatefulSessionPolicy({
                COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true',
                COPILOT_MCP_HTTP_STATELESS_COMPAT: 'true',
            }).enabled,
            false,
        );
    });
});
