// @ts-check
/**
 * tests/unit/copilot/test_session_cleanup.spec.js
 *
 * Testes unitários para F43.1: cleanupStaleSessions — limpeza de sessões expiradas no boot.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cleanupStaleSessions } from '../../../src/copilot/agent/session/lifecycle/cleanup.js';

describe('cleanupStaleSessions', () => {
    /**
     * @param {{ sessionId: string; startTime: Date }[]} sessions
     * @returns {any}
     */
    function mockClient(sessions) {
        return /** @type {any} */ ({
            listSessions: async () => sessions,
            deleteSession: async () => {},
        });
    }

    it('deve retornar resultado zerado quando não há sessões', async () => {
        const client = mockClient([]);
        const result = await cleanupStaleSessions(client);
        assert.equal(result.total, 0);
        assert.equal(result.deleted, 0);
        assert.equal(result.kept, 0);
    });

    it('deve preservar sessão atual', async () => {
        const client = mockClient([{ sessionId: 'current-1', startTime: new Date(Date.now() - 48 * 3600_000) }]);
        const result = await cleanupStaleSessions(client, { currentSessionId: 'current-1' });
        assert.equal(result.deleted, 0);
        assert.equal(result.kept, 1);
    });

    it('deve preservar sessões protegidas por foreground/last-session', async () => {
        const now = Date.now();
        /** @type {string[]} */
        const deleted = [];
        const client = /** @type {any} */ ({
            listSessions: async () => [
                { sessionId: 'foreground-1', startTime: new Date(now - 48 * 3600_000) },
                { sessionId: 'last-1', startTime: new Date(now - 48 * 3600_000) },
                { sessionId: 'old-1', startTime: new Date(now - 48 * 3600_000) },
            ],
            getForegroundSessionId: async () => 'foreground-1',
            getLastSessionId: async () => 'last-1',
            deleteSession: async (/** @type {string} */ id) => {
                deleted.push(id);
            },
        });
        const result = await cleanupStaleSessions(client, { maxAgeMs: 24 * 3600_000 });
        assert.deepEqual(result.protectedIds.sort(), ['foreground-1', 'last-1']);
        assert.deepEqual(deleted, ['old-1']);
        assert.equal(result.deleted, 1);
        assert.equal(result.kept, 2);
    });

    it('deve deletar sessões mais velhas que maxAgeMs', async () => {
        const now = Date.now();
        const deleted = [];
        const client = /** @type {any} */ ({
            listSessions: async () => [
                { sessionId: 'old-1', startTime: new Date(now - 48 * 3600_000) },
                { sessionId: 'recent-1', startTime: new Date(now - 1 * 3600_000) },
            ],
            deleteSession: async (/** @type {string} */ id) => {
                deleted.push(id);
            },
        });
        const result = await cleanupStaleSessions(client, {
            maxAgeMs: 24 * 3600_000,
            currentSessionId: null,
        });
        assert.equal(result.deleted, 1);
        assert.ok(result.deletedIds.includes('old-1'));
        assert.equal(result.kept, 1);
    });

    it('deve preservar sessões sem startTime', async () => {
        const client = mockClient([{ sessionId: 'no-time', startTime: /** @type {any} */ (undefined) }]);
        const result = await cleanupStaleSessions(client);
        assert.equal(result.deleted, 0);
        assert.equal(result.kept, 1);
    });

    it('deve lidar com erro de deleteSession gracefully', async () => {
        const client = /** @type {any} */ ({
            listSessions: async () => [{ sessionId: 'fail-1', startTime: new Date(Date.now() - 48 * 3600_000) }],
            deleteSession: async () => {
                throw new Error('API error');
            },
        });
        const result = await cleanupStaleSessions(client, { maxAgeMs: 24 * 3600_000 });
        assert.equal(result.deleted, 0);
        assert.equal(result.errors.length, 1);
        assert.ok(result.errors[0]?.includes('API error'));
    });
});
