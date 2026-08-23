// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => {
    const listSnapshotFilesAsync = /** @type {any} */ (vi.fn(async () => []));
    const loadLatestSnapshotFileAsync = /** @type {any} */ (vi.fn(async () => null));
    const loadSnapshotFileAsync = /** @type {any} */ (vi.fn(async () => null));
    const normalizeSnapshotRecord = /** @type {any} */ (vi.fn((value) => value));
    const pruneSnapshotFilesAsync = /** @type {any} */ (vi.fn(async () => 0));
    const saveSnapshotFileAsync = /** @type {any} */ (vi.fn(async (snapshot) => `/tmp/${snapshot.snapshotId}.json`));
    return {
        listSnapshotFilesAsync,
        loadLatestSnapshotFileAsync,
        loadSnapshotFileAsync,
        normalizeSnapshotRecord,
        pruneSnapshotFilesAsync,
        saveSnapshotFileAsync,
    };
});

const stateMocks = vi.hoisted(() => ({
    readState: /** @type {any} */ (vi.fn(() => ({ key: 'value' }))),
}));

/* ── mocks ── */
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('../../../src/copilot/agent/config.js', () => ({
    SNAPSHOT_DIR: null,
    MAX_SNAPSHOTS: 3,
}));

vi.mock('../../../src/copilot/agent/lifecycle/state/index.js', () => ({
    readState: stateMocks.readState,
}));

vi.mock('#copilot/observability/swallowed', () => ({
    logSwallowed: vi.fn(),
}));

vi.mock('#copilot/infra/public/platform/json', () => ({
    parseJsonResult: vi.fn((raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));

vi.mock('../../../src/copilot/agent/state/schemas/index.js', () => ({
    SessionSnapshotDataSchema: { safeParse: vi.fn((d) => ({ success: true, data: d })) },
    SnapshotListItemSchema: { safeParse: vi.fn((d) => ({ success: true, data: d })) },
}));

vi.mock('../../../src/copilot/agent/session/state/store/index.js', () => ({
    listSnapshotFilesAsync: storeMocks.listSnapshotFilesAsync,
    loadLatestSnapshotFileAsync: storeMocks.loadLatestSnapshotFileAsync,
    loadSnapshotFileAsync: storeMocks.loadSnapshotFileAsync,
    normalizeSnapshotRecord: storeMocks.normalizeSnapshotRecord,
    pruneSnapshotFilesAsync: storeMocks.pruneSnapshotFilesAsync,
    saveSnapshotFileAsync: storeMocks.saveSnapshotFileAsync,
}));

/* ── SUT ── */
import {
    createSnapshot,
    listSnapshotsAsync,
    loadSnapshotAsync,
    pruneSnapshotsAsync,
    saveSnapshotAsync,
} from '../../../src/copilot/agent/session/state/snapshot.js';

describe('snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stateMocks.readState.mockReturnValue({ key: 'value' });
        storeMocks.listSnapshotFilesAsync.mockResolvedValue([]);
        storeMocks.loadLatestSnapshotFileAsync.mockResolvedValue(null);
        storeMocks.loadSnapshotFileAsync.mockResolvedValue(null);
        storeMocks.normalizeSnapshotRecord.mockImplementation((/** @type {any} */ value) => value);
        storeMocks.pruneSnapshotFilesAsync.mockResolvedValue(0);
        storeMocks.saveSnapshotFileAsync.mockImplementation(
            async (/** @type {{ snapshotId: string }} */ snapshot) => `/tmp/${snapshot.snapshotId}.json`,
        );
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

            expect(storeMocks.saveSnapshotFileAsync).toHaveBeenCalledWith(snap);
            expect(path).toContain(snap.snapshotId);
        });
    });

    describe('listSnapshotsAsync', () => {
        it('retorna array vazio se diretório não existe', async () => {
            storeMocks.listSnapshotFilesAsync.mockResolvedValue([]);
            expect(await listSnapshotsAsync()).toEqual([]);
        });

        it('lista e ordena por createdAt desc', async () => {
            storeMocks.listSnapshotFilesAsync.mockResolvedValue([
                { snapshotId: 'snap-2', createdAt: 200, model: 'gpt-4o' },
                { snapshotId: 'snap-1', createdAt: 100, model: 'gpt-4o' },
            ]);

            const list = await listSnapshotsAsync();
            expect(list).toHaveLength(2);
            const first = list[0];
            expect(first?.snapshotId).toBe('snap-2'); // mais recente primeiro
        });
    });

    describe('loadSnapshotAsync', () => {
        it('carrega snapshot por ID exato', async () => {
            const data = { snapshotId: 'snap-abc', createdAt: 100, model: 'gpt-4o' };
            storeMocks.loadSnapshotFileAsync.mockResolvedValue(data);

            const snap = await loadSnapshotAsync('snap-abc');
            expect(snap).toEqual(data);
        });

        it('retorna null se não encontrado', async () => {
            storeMocks.loadSnapshotFileAsync.mockResolvedValue(null);
            expect(await loadSnapshotAsync('nope')).toBeNull();
        });
    });

    describe('pruneSnapshotsAsync', () => {
        it('remove snapshots antigos além do limite', async () => {
            storeMocks.pruneSnapshotFilesAsync.mockResolvedValue(2);

            const removed = await pruneSnapshotsAsync(2);
            expect(removed).toBe(2);
            expect(storeMocks.pruneSnapshotFilesAsync).toHaveBeenCalledWith(2);
        });

        it('não remove nada se dentro do limite', async () => {
            storeMocks.pruneSnapshotFilesAsync.mockResolvedValue(0);

            const removed = await pruneSnapshotsAsync(5);
            expect(removed).toBe(0);
        });
    });
});
