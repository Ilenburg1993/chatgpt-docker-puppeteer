// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    SNAPSHOT_DIR: null,
    MAX_SNAPSHOTS: 3,
}));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    readState: vi.fn(() => ({ key: 'value' })),
}));

/* fs mock — módulo nativo */
vi.mock('node:fs', () => ({
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
}));

/* ── SUT ── */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
    createSnapshot,
    listSnapshots,
    loadLatestSnapshot,
    loadSnapshot,
    pruneSnapshots,
    saveSnapshot,
} from '../../../src/copilot/agent/session/snapshot.js';

describe('snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdirSync).mockReturnValue([]);
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

    describe('saveSnapshot', () => {
        it('cria diretório se não existe e escreve JSON', () => {
            vi.mocked(existsSync).mockReturnValue(false);
            vi.mocked(readdirSync).mockReturnValue([]);

            const snap = createSnapshot({
                sessionId: null,
                model: 'gpt-4o',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });

            const path = saveSnapshot(snap);

            expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(expect.any(String), { recursive: true });
            expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);
            expect(path).toContain(snap.snapshotId);
        });
    });

    describe('listSnapshots', () => {
        it('retorna array vazio se diretório não existe', () => {
            vi.mocked(existsSync).mockReturnValue(false);
            expect(listSnapshots()).toEqual([]);
        });

        it('lista e ordena por createdAt desc', () => {
            vi.mocked(readdirSync).mockReturnValue(['snap-1.json', 'snap-2.json']);
            vi.mocked(readFileSync)
                .mockReturnValueOnce(JSON.stringify({ snapshotId: 'snap-1', createdAt: 100, model: 'gpt-4o' }))
                .mockReturnValueOnce(JSON.stringify({ snapshotId: 'snap-2', createdAt: 200, model: 'gpt-4o' }));

            const list = listSnapshots();
            expect(list).toHaveLength(2);
            expect(list[0].snapshotId).toBe('snap-2'); // mais recente primeiro
        });
    });

    describe('loadSnapshot', () => {
        it('carrega snapshot por ID exato', () => {
            const data = { snapshotId: 'snap-abc', createdAt: 100 };
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));

            const snap = loadSnapshot('snap-abc');
            expect(snap).toEqual(data);
        });

        it('retorna null se não encontrado', () => {
            vi.mocked(existsSync).mockReturnValue(false);
            expect(loadSnapshot('nope')).toBeNull();
        });
    });

    describe('loadLatestSnapshot', () => {
        it('retorna null se não há snapshots', () => {
            vi.mocked(readdirSync).mockReturnValue([]);
            expect(loadLatestSnapshot()).toBeNull();
        });
    });

    describe('pruneSnapshots', () => {
        it('remove snapshots antigos além do limite', () => {
            const snaps = [
                { snapshotId: 's1', createdAt: 300, model: 'm' },
                { snapshotId: 's2', createdAt: 200, model: 'm' },
                { snapshotId: 's3', createdAt: 100, model: 'm' },
                { snapshotId: 's4', createdAt: 50, model: 'm' },
            ];
            vi.mocked(readdirSync).mockReturnValue(snaps.map((s) => `${s.snapshotId}.json`));
            vi.mocked(readFileSync).mockImplementation(
                /** @param {string} p */
                (p) => {
                    const id = String(p).split('/').pop()?.replace('.json', '');
                    const s = snaps.find((x) => x.snapshotId === id);
                    return JSON.stringify(s ?? {});
                },
            );

            const removed = pruneSnapshots(2);
            expect(removed).toBe(2);
            expect(vi.mocked(rmSync)).toHaveBeenCalledTimes(2);
        });

        it('não remove nada se dentro do limite', () => {
            vi.mocked(readdirSync).mockReturnValue(['s1.json']);
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ snapshotId: 's1', createdAt: 100, model: 'm' }));

            const removed = pruneSnapshots(5);
            expect(removed).toBe(0);
        });
    });
});
