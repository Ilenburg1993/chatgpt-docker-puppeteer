// @ts-check
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// Stub logger antes de importar o módulo

/** @type {string} */
const TEST_SNAPSHOT_DIR = join(import.meta.dirname, '.tmp-test-snapshots');

// Setar env antes do import
process.env['AGENT_SNAPSHOT_DIR'] = TEST_SNAPSHOT_DIR;

// Stub state-io readState — retorna null por default
/** @type {() => null} */
const _readStateStub = () => null;

describe('session-snapshot', async () => {
    /** @type {typeof import('../../../src/copilot/agent/session/snapshot.js')} */
    let mod;

    before(async () => {
        mod = await import('../../../src/copilot/agent/session/snapshot.js');
    });

    beforeEach(() => {
        // Limpar diretório de snapshots
        if (existsSync(TEST_SNAPSHOT_DIR)) {
            rmSync(TEST_SNAPSHOT_DIR, { recursive: true, force: true });
        }
    });

    after(() => {
        if (existsSync(TEST_SNAPSHOT_DIR)) {
            rmSync(TEST_SNAPSHOT_DIR, { recursive: true, force: true });
        }
        delete process.env['AGENT_SNAPSHOT_DIR'];
    });

    describe('createSnapshot()', () => {
        it('cria snapshot com campos obrigatórios', () => {
            const snap = mod.createSnapshot({
                sessionId: 'test-session-1',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 42,
                dialogLoopActive: true,
                dialogPaused: false,
                pendingQuestion: null,
            });

            assert.ok(snap.snapshotId.startsWith('snap-'));
            assert.equal(snap.sessionId, 'test-session-1');
            assert.equal(snap.model, 'gpt-4.1');
            assert.equal(snap.status, 'idle');
            assert.equal(snap.sendCount, 42);
            assert.equal(snap.dialogLoopActive, true);
            assert.equal(snap.dialogPaused, false);
            assert.equal(snap.pendingQuestion, null);
            assert.equal(snap.reason, 'manual');
            assert.ok(snap.createdAt > 0);
        });

        it('inclui prMetrics quando fornecido', () => {
            const snap = mod.createSnapshot({
                sessionId: null,
                model: 'claude-sonnet-4',
                status: 'processing',
                sendCount: 10,
                dialogLoopActive: false,
                dialogPaused: true,
                pendingQuestion: 'What is your name?',
                prMetrics: { boots: 3, resumesWithPR: 1, resumesZeroPR: 5, totalPR: 4 },
                reason: 'handoff',
            });

            assert.deepEqual(snap.prMetrics, { boots: 3, resumesWithPR: 1, resumesZeroPR: 5, totalPR: 4 });
            assert.equal(snap.reason, 'handoff');
        });
    });

    describe('saveSnapshot() + loadSnapshot()', () => {
        it('salva e carrega snapshot por ID', () => {
            const snap = mod.createSnapshot({
                sessionId: 'sess-abc',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });

            const path = mod.saveSnapshot(snap);
            assert.ok(existsSync(path));

            const loaded = mod.loadSnapshot(snap.snapshotId);
            assert.ok(loaded);
            assert.equal(loaded.snapshotId, snap.snapshotId);
            assert.equal(loaded.sessionId, 'sess-abc');
        });

        it('retorna null para snapshot inexistente', () => {
            const loaded = mod.loadSnapshot('nonexistent-id');
            assert.equal(loaded, null);
        });
    });

    describe('listSnapshots()', () => {
        it('lista snapshots ordenados do mais recente', () => {
            const s1 = mod.createSnapshot({
                sessionId: '1',
                model: 'a',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            s1.createdAt = 1000;
            mod.saveSnapshot(s1);

            const s2 = mod.createSnapshot({
                sessionId: '2',
                model: 'b',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            s2.createdAt = 2000;
            mod.saveSnapshot(s2);

            const list = mod.listSnapshots();
            assert.equal(list.length, 2);
            assert.equal(list[0].createdAt, 2000);
            assert.equal(list[1].createdAt, 1000);
        });

        it('retorna array vazio se diretório não existe', () => {
            // Não criar o diretório
            const list = mod.listSnapshots();
            assert.deepEqual(list, []);
        });
    });

    describe('loadLatestSnapshot()', () => {
        it('carrega o snapshot mais recente', () => {
            const s1 = mod.createSnapshot({
                sessionId: 'old',
                model: 'a',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            s1.createdAt = 1000;
            mod.saveSnapshot(s1);

            const s2 = mod.createSnapshot({
                sessionId: 'new',
                model: 'b',
                status: 'idle',
                sendCount: 5,
                dialogLoopActive: true,
                dialogPaused: false,
                pendingQuestion: null,
            });
            s2.createdAt = 2000;
            mod.saveSnapshot(s2);

            const latest = mod.loadLatestSnapshot();
            assert.ok(latest);
            assert.equal(latest.sessionId, 'new');
        });

        it('retorna null sem snapshots', () => {
            assert.equal(mod.loadLatestSnapshot(), null);
        });
    });

    describe('pruneSnapshots()', () => {
        it('remove snapshots antigos mantendo keep', () => {
            // Criar 5 snapshots
            for (let i = 0; i < 5; i++) {
                const s = mod.createSnapshot({
                    sessionId: `s${i}`,
                    model: 'a',
                    status: 'idle',
                    sendCount: i,
                    dialogLoopActive: false,
                    dialogPaused: false,
                    pendingQuestion: null,
                });
                s.createdAt = 1000 + i;
                mod.saveSnapshot(s);
            }

            assert.equal(mod.listSnapshots().length, 5);

            // Prunar mantendo 2
            const removed = mod.pruneSnapshots(2);
            assert.equal(removed, 3);
            assert.equal(mod.listSnapshots().length, 2);
        });

        it('não remove nada se count <= keep', () => {
            const s = mod.createSnapshot({
                sessionId: 's1',
                model: 'a',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            mod.saveSnapshot(s);

            const removed = mod.pruneSnapshots(5);
            assert.equal(removed, 0);
        });
    });
});
