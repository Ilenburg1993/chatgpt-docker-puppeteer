// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(), LOG_DIR: '/tmp/test-logs', getRecentLogs: vi.fn(() => []), }));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    SNAPSHOT_DIR: null,
    MAX_SNAPSHOTS: 3,
}));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    readState: vi.fn(() => ({ key: 'value' })),
}));

vi.mock('#copilot/core/error-handlers', () => ({
    logSwallowed: vi.fn(),
}));

vi.mock('#copilot/core/safe-json', () => ({
    safeJsonParse: vi.fn((raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));

vi.mock('#copilot/core/schemas', () => ({
    SessionSnapshotDataSchema: { safeParse: vi.fn((d) => ({ success: true, data: d })) },
    SnapshotListItemSchema: { safeParse: vi.fn((d) => ({ success: true, data: d })) },
}));

/* fs/promises mock */
const mockAccess = vi.fn(() => Promise.resolve());
const mockMkdir = vi.fn(() => Promise.resolve());
const mockReaddir = vi.fn(() => Promise.resolve([]));
const mockReadFile = vi.fn(() => Promise.resolve('{}'));
const mockWriteFile = vi.fn(() => Promise.resolve());
const mockRm = vi.fn(() => Promise.resolve());

vi.mock('node:fs/promises', () => ({
    access: (...args) => mockAccess(...args),
    mkdir: (...args) => mockMkdir(...args),
    readdir: (...args) => mockReaddir(...args),
    readFile: (...args) => mockReadFile(...args),
    writeFile: (...args) => mockWriteFile(...args),
    rm: (...args) => mockRm(...args),
}));

/* ── SUT ── */
import {
    createSnapshot,
    listSnapshotsAsync,
    loadSnapshotAsync,
    pruneSnapshotsAsync,
    saveSnapshotAsync,
} from '../../../src/copilot/agent/session/snapshot.js';

describe('snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockReaddir.mockResolvedValue([]);
    });

    describe('createSnapshot', () => {
        it('gera snapshotId e inclui stateSnapshot', () => {
            const snap = createSnapshot({
                sessionId: 'sess-1',
                model: 'gpt-4o',
                status: 'idle',
                sendCount: 5,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });

            expect(snap.snapshotId).toMatch(/^snap-/);
            expect(snap.sessionId).toBe('sess-1');
            expect(snap.model).toBe('gpt-4o');
            expect(snap.sendCount).toBe(5);
            expect(snap.stateSnapshot).toEqual({ key: 'value' });
            expect(snap.reason).toBe('manual');
        });

        it('aceita reason customizado e prMetrics', () => {
            const metrics = { boots: 1, resumesWithPR: 2, resumesZeroPR: 0, totalPR: 10 };
            const snap = createSnapshot({
                sessionId: null,
                model: 'gpt-4o-mini',
                status: 'active',
                sendCount: 0,
                dialogLoopActive: true,
                dialogPaused: false,
                pendingQuestion: 'test?',
                prMetrics: metrics,
                reason: 'handoff',
            });

            expect(snap.reason).toBe('handoff');
            expect(snap.prMetrics).toEqual(metrics);
            expect(snap.pendingQuestion).toBe('test?');
        });
    });

    describe('saveSnapshotAsync', () => {
        it('cria diretório e escreve JSON', async () => {
            mockReaddir.mockResolvedValue([]);

            const snap = createSnapshot({
                sessionId: null,
                model: 'gpt-4o',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });

            const path = await saveSnapshotAsync(snap);

            expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
            expect(mockWriteFile).toHaveBeenCalledTimes(1);
            expect(path).toContain(snap.snapshotId);
        });
    });

    describe('listSnapshotsAsync', () => {
        it('retorna array vazio se diretório não existe', async () => {
            mockAccess.mockRejectedValue(new Error('ENOENT'));
            expect(await listSnapshotsAsync()).toEqual([]);
        });

        it('lista e ordena por createdAt desc', async () => {
            mockReaddir.mockResolvedValue(['snap-1.json', 'snap-2.json']);
            mockReadFile
                .mockResolvedValueOnce(JSON.stringify({ snapshotId: 'snap-1', createdAt: 100, model: 'gpt-4o' }))
                .mockResolvedValueOnce(JSON.stringify({ snapshotId: 'snap-2', createdAt: 200, model: 'gpt-4o' }));

            const list = await listSnapshotsAsync();
            expect(list).toHaveLength(2);
            expect(list[0].snapshotId).toBe('snap-2'); // mais recente primeiro
        });
    });

    describe('loadSnapshotAsync', () => {
        it('carrega snapshot por ID exato', async () => {
            const data = { snapshotId: 'snap-abc', createdAt: 100 };
            mockReadFile.mockResolvedValue(JSON.stringify(data));

            const snap = await loadSnapshotAsync('snap-abc');
            expect(snap).toEqual(data);
        });

        it('retorna null se não encontrado', async () => {
            mockAccess.mockRejectedValue(new Error('ENOENT'));
            expect(await loadSnapshotAsync('nope')).toBeNull();
        });
    });

    describe('pruneSnapshotsAsync', () => {
        it('remove snapshots antigos além do limite', async () => {
            const snaps = [
                { snapshotId: 's1', createdAt: 300, model: 'm' },
                { snapshotId: 's2', createdAt: 200, model: 'm' },
                { snapshotId: 's3', createdAt: 100, model: 'm' },
                { snapshotId: 's4', createdAt: 50, model: 'm' },
            ];
            mockReaddir.mockResolvedValue(snaps.map((s) => `${s.snapshotId}.json`));
            mockReadFile.mockImplementation(
                /** @param {string} p */
                (p) => {
                    const id = String(p).split('/').pop()?.replace('.json', '');
                    const s = snaps.find((x) => x.snapshotId === id);
                    return Promise.resolve(JSON.stringify(s ?? {}));
                },
            );

            const removed = await pruneSnapshotsAsync(2);
            expect(removed).toBe(2);
            expect(mockRm).toHaveBeenCalledTimes(2);
        });

        it('não remove nada se dentro do limite', async () => {
            mockReaddir.mockResolvedValue(['s1.json']);
            mockReadFile.mockResolvedValue(JSON.stringify({ snapshotId: 's1', createdAt: 100, model: 'm' }));

            const removed = await pruneSnapshotsAsync(5);
            expect(removed).toBe(0);
        });
    });
});
