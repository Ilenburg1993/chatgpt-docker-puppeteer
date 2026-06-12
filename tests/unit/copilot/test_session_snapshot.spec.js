// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Stub logger antes de importar o módulo

/** @type {string} */
const TEST_SNAPSHOT_DIR = join(import.meta.dirname, '.tmp-test-snapshots');

// Setar env antes do import
process.env['AGENT_SNAPSHOT_DIR'] = TEST_SNAPSHOT_DIR;

describe('session-snapshot', async () => {
    /** @type {typeof import('../../../src/copilot/agent/session/state/snapshot.js')} */
    let mod;

    beforeAll(async () => {
        mod = await import('../../../src/copilot/agent/session/state/snapshot.js');
    });

    beforeEach(() => {
        // Limpar diretório de snapshots
        if (existsSync(TEST_SNAPSHOT_DIR)) {
            rmSync(TEST_SNAPSHOT_DIR, { recursive: true, force: true });
        }
    });

    afterAll(() => {
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
                pendingQuestionMeta: {
                    kind: 'question',
                    askedAt: 123,
                    allowFreeform: true,
                    protocolControlled: false,
                },
                pendingQuestionShadow: {
                    question: 'READY: aguardando próxima mensagem',
                    meta: {
                        kind: 'ready',
                        askedAt: 456,
                        allowFreeform: true,
                        protocolControlled: true,
                    },
                    restoredAt: 789,
                    expiresAt: 999,
                },
                prMetrics: { boots: 3, resumesWithPR: 1, resumesZeroPR: 5, totalPR: 4 },
                reason: 'handoff',
            });

            assert.deepEqual(snap.prMetrics, { boots: 3, resumesWithPR: 1, resumesZeroPR: 5, totalPR: 4 });
            assert.deepEqual(snap.pendingQuestionMeta, {
                kind: 'question',
                askedAt: 123,
                allowFreeform: true,
                protocolControlled: false,
            });
            assert.deepEqual(snap.pendingQuestionShadow, {
                question: 'READY: aguardando próxima mensagem',
                meta: {
                    kind: 'ready',
                    askedAt: 456,
                    allowFreeform: true,
                    protocolControlled: true,
                },
                restoredAt: 789,
                expiresAt: 999,
            });
            assert.equal(snap.reason, 'handoff');
        });
    });

    describe('saveSnapshotAsync() + loadSnapshotAsync()', () => {
        it('salva e carrega snapshot por ID', async () => {
            const snap = mod.createSnapshot({
                sessionId: 'sess-abc',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });

            const path = await mod.saveSnapshotAsync(snap);
            assert.ok(existsSync(path));

            const loaded = await mod.loadSnapshotAsync(snap.snapshotId);
            assert.ok(loaded);
            assert.equal(loaded.snapshotId, snap.snapshotId);
            assert.equal(loaded.sessionId, 'sess-abc');
            assert.equal(statSync(path).mode & 0o777, 0o600);
        });

        it('retorna null para snapshot inexistente', async () => {
            const loaded = await mod.loadSnapshotAsync('nonexistent-id');
            assert.equal(loaded, null);
        });

        it('rejeita snapshotId com traversal no save e no load', async () => {
            const snap = mod.createSnapshot({
                sessionId: 'sess-safe',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            snap.snapshotId = '../snapshot-traversal-target';
            const outsidePath = join(TEST_SNAPSHOT_DIR, '..', 'snapshot-traversal-target.json');
            writeFileSync(outsidePath, JSON.stringify(snap), 'utf8');
            try {
                await assert.rejects(mod.saveSnapshotAsync(snap), /Snapshot ID inválido/u);
                assert.equal(await mod.loadSnapshotAsync('../snapshot-traversal-target'), null);
                assert.equal(existsSync(outsidePath), true);
            } finally {
                rmSync(outsidePath, { force: true });
            }
        });

        it('ignora payload cujo snapshotId diverge do filename', async () => {
            const snap = mod.createSnapshot({
                sessionId: 'sess-safe',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
            writeFileSync(join(TEST_SNAPSHOT_DIR, 'snap-safe-name.json'), JSON.stringify(snap), 'utf8');

            assert.equal((await mod.listSnapshotsAsync()).length, 0);
            assert.equal(await mod.loadSnapshotAsync('snap-safe-name'), null);
        });
    });

    describe('listSnapshotsAsync()', () => {
        it('lista snapshots ordenados do mais recente', async () => {
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
            await mod.saveSnapshotAsync(s1);

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
            await mod.saveSnapshotAsync(s2);

            const list = await mod.listSnapshotsAsync();
            assert.equal(list.length, 2);
            assert.equal(list[0]?.createdAt, 2000);
            assert.equal(list[1]?.createdAt, 1000);
        });

        it('retorna array vazio se diretório não existe', async () => {
            // Não criar o diretório
            const list = await mod.listSnapshotsAsync();
            assert.deepEqual(list, []);
        });
    });

    describe('loadLatestSnapshotAsync()', () => {
        it('carrega o snapshot mais recente', async () => {
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
            await mod.saveSnapshotAsync(s1);

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
            await mod.saveSnapshotAsync(s2);

            const latest = await mod.loadLatestSnapshotAsync();
            assert.ok(latest);
            assert.equal(latest.sessionId, 'new');
        });

        it('retorna null sem snapshots', async () => {
            assert.equal(await mod.loadLatestSnapshotAsync(), null);
        });
    });

    describe('pruneSnapshotsAsync()', () => {
        it('remove snapshots antigos mantendo keep', async () => {
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
                await mod.saveSnapshotAsync(s);
            }

            assert.equal((await mod.listSnapshotsAsync()).length, 5);

            // Prunar mantendo 2
            const removed = await mod.pruneSnapshotsAsync(2);
            assert.equal(removed, 3);
            assert.equal((await mod.listSnapshotsAsync()).length, 2);
        });

        it('não remove nada se count <= keep', async () => {
            const s = mod.createSnapshot({
                sessionId: 's1',
                model: 'a',
                status: 'idle',
                sendCount: 0,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
            });
            await mod.saveSnapshotAsync(s);

            const removed = await mod.pruneSnapshotsAsync(5);
            assert.equal(removed, 0);
        });
    });
});
