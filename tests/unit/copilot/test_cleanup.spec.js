// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/sdk/session', () => ({
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    SESSION_MAX_AGE_MS: 86400_000, // 24h
}));

/* ── SUT ── */
import { deleteSession, listSessions } from '#copilot/sdk/session';
import { cleanupStaleSessions } from '../../../src/copilot/agent/session/cleanup.js';

describe('cleanupStaleSessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retorna resultado vazio quando listSessions retorna não-array', async () => {
        vi.mocked(listSessions).mockResolvedValue(/** @type {any} */ ('not-array'));
        const r = await cleanupStaleSessions(/** @type {any} */ ({}));
        expect(r.total).toBe(0);
        expect(r.deleted).toBe(0);
    });

    it('deleta sessões expiradas e preserva sessão atual', async () => {
        const now = Date.now();
        const old = new Date(now - 100_000_000).toISOString(); // ~27h
        const recent = new Date(now - 1000).toISOString(); // 1s

        vi.mocked(listSessions).mockResolvedValue(
            /** @type {any} */ ([
                { sessionId: 'old-1', startTime: old },
                { sessionId: 'current', startTime: old },
                { sessionId: 'recent', startTime: recent },
            ]),
        );
        vi.mocked(deleteSession).mockResolvedValue(undefined);

        const r = await cleanupStaleSessions(/** @type {any} */ ({}), { currentSessionId: 'current' });

        expect(r.total).toBe(3);
        expect(r.deleted).toBe(1);
        expect(r.deletedIds).toContain('old-1');
        expect(r.kept).toBe(2); // current + recent
    });

    it('pula sessões sem startTime válido', async () => {
        vi.mocked(listSessions).mockResolvedValue(
            /** @type {any} */ ([{ sessionId: 's1', startTime: null }, { sessionId: 's2' }]),
        );

        const r = await cleanupStaleSessions(/** @type {any} */ ({}));
        expect(r.deleted).toBe(0);
        expect(r.kept).toBe(2);
    });

    it('registra erros de delete sem interromper', async () => {
        const old = new Date(Date.now() - 100_000_000).toISOString();
        vi.mocked(listSessions).mockResolvedValue(/** @type {any} */ ([{ sessionId: 'fail-1', startTime: old }]));
        vi.mocked(deleteSession).mockRejectedValue(new Error('network'));

        const r = await cleanupStaleSessions(/** @type {any} */ ({}));
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toMatch(/network/);
    });

    it('trata erro em listSessions', async () => {
        vi.mocked(listSessions).mockRejectedValue(new Error('boom'));
        const r = await cleanupStaleSessions(/** @type {any} */ ({}));
        expect(r.errors).toHaveLength(1);
        expect(r.total).toBe(0);
    });
});
