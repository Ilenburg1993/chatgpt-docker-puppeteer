// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('../../../src/copilot/agent/ports/index.js', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    log: vi.fn(),
    startSpan: vi.fn(async (_name, _attrs, fn) => fn()),
}));

/* ── SUT ── */
import { cleanupStaleSessions } from '../../../src/copilot/agent/session/lifecycle/cleanup.js';

/**
 * @param {{
 *     listSessions?: ReturnType<typeof vi.fn>;
 *     deleteSession?: ReturnType<typeof vi.fn>;
 *     getForegroundSessionId?: ReturnType<typeof vi.fn>;
 *     getLastSessionId?: ReturnType<typeof vi.fn>;
 * }} [overrides]
 */
function createClient(overrides = {}) {
    return /** @type {any} */ ({
        listSessions: overrides.listSessions ?? vi.fn(async () => []),
        deleteSession: overrides.deleteSession ?? vi.fn(async () => undefined),
        getForegroundSessionId: overrides.getForegroundSessionId ?? vi.fn(async () => undefined),
        getLastSessionId: overrides.getLastSessionId ?? vi.fn(async () => undefined),
    });
}

describe('cleanupStaleSessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retorna resultado vazio quando listSessions retorna não-array', async () => {
        const client = createClient({ listSessions: vi.fn(async () => /** @type {any} */ ('not-array')) });
        const r = await cleanupStaleSessions(client);
        expect(r.total).toBe(0);
        expect(r.deleted).toBe(0);
    });

    it('deleta sessões expiradas e preserva sessão atual', async () => {
        const now = Date.now();
        const old = new Date(now - 100_000_000).toISOString(); // ~27h
        const recent = new Date(now - 1000).toISOString(); // 1s

        const client = createClient({
            listSessions: vi.fn(
                async () =>
                    /** @type {any} */ ([
                        { sessionId: 'old-1', startTime: old },
                        { sessionId: 'current', startTime: old },
                        { sessionId: 'recent', startTime: recent },
                    ]),
            ),
            deleteSession: vi.fn(async () => undefined),
        });

        const r = await cleanupStaleSessions(client, { currentSessionId: 'current' });

        expect(r.total).toBe(3);
        expect(r.deleted).toBe(1);
        expect(r.deletedIds).toContain('old-1');
        expect(r.kept).toBe(2); // current + recent
    });

    it('preserva foreground/last-session mesmo quando estão expiradas', async () => {
        const old = new Date(Date.now() - 100_000_000).toISOString();
        const client = createClient({
            listSessions: vi.fn(
                async () =>
                    /** @type {any} */ ([
                        { sessionId: 'fg', startTime: old },
                        { sessionId: 'last', startTime: old },
                        { sessionId: 'old-1', startTime: old },
                    ]),
            ),
            deleteSession: vi.fn(async () => undefined),
            getForegroundSessionId: vi.fn(async () => 'fg'),
            getLastSessionId: vi.fn(async () => 'last'),
        });

        const r = await cleanupStaleSessions(client);

        expect(r.protectedIds.sort()).toEqual(['fg', 'last']);
        expect(r.deletedIds).toEqual(['old-1']);
        expect(r.kept).toBe(2);
    });

    it('pula sessões sem startTime válido', async () => {
        const client = createClient({
            listSessions: vi.fn(
                async () => /** @type {any} */ ([{ sessionId: 's1', startTime: null }, { sessionId: 's2' }]),
            ),
        });

        const r = await cleanupStaleSessions(client);
        expect(r.deleted).toBe(0);
        expect(r.kept).toBe(2);
    });

    it('registra erros de delete sem interromper', async () => {
        const old = new Date(Date.now() - 100_000_000).toISOString();
        const client = createClient({
            listSessions: vi.fn(async () => /** @type {any} */ ([{ sessionId: 'fail-1', startTime: old }])),
            deleteSession: vi.fn(async () => {
                throw new Error('network');
            }),
        });

        const r = await cleanupStaleSessions(client);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toMatch(/network/);
    });

    it('trata erro em listSessions', async () => {
        const client = createClient({
            listSessions: vi.fn(async () => {
                throw new Error('boom');
            }),
        });
        const r = await cleanupStaleSessions(client);
        expect(r.errors).toHaveLength(1);
        expect(r.total).toBe(0);
    });
});
