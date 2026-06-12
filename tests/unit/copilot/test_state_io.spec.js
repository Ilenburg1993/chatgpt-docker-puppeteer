// @ts-check
/**
 * tests/unit/copilot/test_state_io.spec.js
 *
 * Testes unitários para src/copilot/agent/state-io.js.
 *
 * Cobre:
 *
 * - G2-TEST-14: writeStateAsync() com escritas concorrentes (mutex serial)
 * - G2-DX-15: readStateAsync() valida JSON — rejeita arrays e primitivos
 * - clearStateAsync() invalida cache
 * - writeStateAsync() persiste e atualiza cache
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

// Configurar AGENT_STATE_FILE antes de importar state-io para usar um diretório temporário
const TEST_STATE_DIR = join(import.meta.dirname, '.tmp-state-io-test');
const TEST_STATE_FILE = join(TEST_STATE_DIR, 'test-state.json');
process.env.AGENT_STATE_FILE = TEST_STATE_FILE;

// Importar após definir env
const { readState, readStateAsync, writeState, writeStateAsync, clearState, clearStateAsync, persistStateWithPolicy } =
    await import('../../../src/copilot/agent/lifecycle/state/state-io.js');
const { stateFileIoTestHarness } = await import('../../../src/copilot/agent/lifecycle/state/state-file-io.js');

describe('state-io', () => {
    beforeAll(() => {
        mkdirSync(TEST_STATE_DIR, { recursive: true });
    });

    afterAll(() => {
        delete process.env.AGENT_STATE_FILE;
        if (existsSync(TEST_STATE_DIR)) {
            rmSync(TEST_STATE_DIR, { recursive: true, force: true });
        }
    });

    afterEach(() => {
        stateFileIoTestHarness.resetStateFileWriter();
    });

    // ---------------------------------------------------------------------------
    // readState() / readStateAsync() básico
    // ---------------------------------------------------------------------------
    describe('readState()', () => {
        it('retorna null quando arquivo não existe', async () => {
            clearState();
            await clearStateAsync();
            if (existsSync(TEST_STATE_FILE)) rmSync(TEST_STATE_FILE);
            const result = readState();
            assert.equal(result, null);
        });

        it('G2-DX-15: rejeita array como estado inválido', async () => {
            clearState();
            await clearStateAsync();
            await writeFile(TEST_STATE_FILE, JSON.stringify([1, 2, 3]), 'utf8');
            const result = await readStateAsync();
            assert.equal(result, null, 'array não é um estado válido');
        });

        it('G2-DX-15: rejeita null literal como estado inválido', async () => {
            clearState();
            await clearStateAsync();
            await writeFile(TEST_STATE_FILE, 'null', 'utf8');
            const result = await readStateAsync();
            assert.equal(result, null, 'null literal não é estado válido');
        });

        it('G2-DX-15: rejeita primitivo (string) como estado inválido', async () => {
            clearState();
            await clearStateAsync();
            await writeFile(TEST_STATE_FILE, '"hello"', 'utf8');
            const result = await readStateAsync();
            assert.equal(result, null, 'string não é estado válido');
        });

        it('retorna estado válido quando arquivo contém objeto', async () => {
            clearState();
            await clearStateAsync();
            const state = {
                sessionId: 's-1',
                startedAt: 100,
                resumedAt: 100,
                resumeCount: 0,
                sendCount: 5,
                model: 'gpt-4.1',
                pendingQuestion: null,
            };
            await writeFile(TEST_STATE_FILE, JSON.stringify(state), 'utf8');
            const result = await readStateAsync();
            assert.equal(result?.sendCount, 5);
            assert.equal(result?.sessionId, 's-1');
        });
    });

    // ---------------------------------------------------------------------------
    // writeStateAsync()
    // ---------------------------------------------------------------------------
    describe('writeState()', () => {
        it('persiste e atualiza cache', async () => {
            clearState();
            await clearStateAsync();
            const result = await writeStateAsync({ sendCount: 42 });
            assert.equal(result.sendCount, 42);
            // Cache deve estar populado
            const cached = readState();
            assert.equal(cached?.sendCount, 42);
        });

        it('persistStateWithPolicy resolve explicitamente com ok=true em caso de sucesso', async () => {
            clearState();
            await clearStateAsync();

            const result = await persistStateWithPolicy({ sendCount: 7 }, { label: 'test.persist.policy' });

            assert.equal(result.ok, true);
            if (result.ok) {
                assert.equal(result.value.sendCount, 7);
            }
        });

        it('cria o diretório configurado e persiste o snapshot atomicamente com modo 0600', async () => {
            await clearStateAsync();
            rmSync(TEST_STATE_DIR, { recursive: true, force: true });

            await writeStateAsync({ sessionId: 'private-state', sendCount: 1 });

            assert.equal(existsSync(TEST_STATE_FILE), true);
            assert.equal((await stat(TEST_STATE_FILE)).mode & 0o777, 0o600);
        });
    });

    // ---------------------------------------------------------------------------
    // G2-TEST-14: writeStateAsync concorrente (mutex)
    // ---------------------------------------------------------------------------
    describe('writeStateAsync() concorrente (G2-TEST-14)', () => {
        it('escritas concorrentes são serializadas — resultado final reflete última escrita', async () => {
            clearState();
            await writeStateAsync({
                sendCount: 0,
                sessionId: 'mutex-test',
                startedAt: 1,
                resumedAt: 1,
                resumeCount: 0,
                model: 'gpt-4.1',
                pendingQuestion: null,
            });

            // Disparar 10 escritas concorrentes incrementando sendCount
            const promises = [];
            for (let i = 1; i <= 10; i++) {
                promises.push(writeStateAsync({ sendCount: i }));
            }

            const results = await Promise.all(promises);

            // A última promise deve ter sendCount = 10 (serialização via mutex)
            const finalState = readState();
            assert.equal(finalState?.sendCount, 10, 'último sendCount deve ser 10');

            // Todas as promises devem ter resolvido com objetos válidos
            for (const r of results) {
                assert.ok(r && typeof r === 'object', 'cada resultado deve ser um objeto');
                assert.ok(typeof r.sendCount === 'number', 'sendCount deve ser number');
            }
        });

        it('escritas concorrentes não corrompem o arquivo', async () => {
            clearState();
            await writeStateAsync({
                sendCount: 0,
                sessionId: 'corruption-test',
                startedAt: 1,
                resumedAt: 1,
                resumeCount: 0,
                model: 'gpt-4.1',
                pendingQuestion: null,
            });

            // Disparar escritas concorrentes com campos diferentes
            await Promise.all([
                writeStateAsync({ sendCount: 100 }),
                writeStateAsync({ resumeCount: 5 }),
                writeStateAsync({ model: 'gpt-5' }),
            ]);

            const finalState = readState();
            assert.ok(finalState, 'estado final deve existir');
            // O estado final deve ser o merge completo (não importa a ordem, o último model='gpt-5')
            assert.equal(finalState?.model, 'gpt-5');
        });
    });

    // ---------------------------------------------------------------------------
    // clearState()
    // ---------------------------------------------------------------------------
    describe('clearState()', () => {
        it('remove arquivo e invalida cache', async () => {
            await writeStateAsync({ sendCount: 99 });
            assert.ok(existsSync(TEST_STATE_FILE));
            await clearStateAsync();
            assert.ok(!existsSync(TEST_STATE_FILE), 'arquivo deve ter sido removido');
            assert.equal(readState(), null, 'cache deve estar invalidado');
        });

        it('aguarda write em voo e impede que ele recrie o arquivo após clear', async () => {
            await clearStateAsync();
            const writerStarted = Promise.withResolvers();
            const releaseWriter = Promise.withResolvers();
            stateFileIoTestHarness.setStateFileWriter(async (filePath, content, options) => {
                writerStarted.resolve(undefined);
                await releaseWriter.promise;
                await stateFileIoTestHarness.writeFileAtomicPortable(filePath, content, options);
            });

            const writePromise = writeStateAsync({ sessionId: 'stale-write', sendCount: 77 });
            await writerStarted.promise;
            const clearPromise = clearStateAsync();
            releaseWriter.resolve(undefined);

            await Promise.all([writePromise, clearPromise]);
            assert.equal(existsSync(TEST_STATE_FILE), false);
            assert.equal(await readStateAsync(), null);
        });

        it('não segue symlink ao ler o arquivo de estado', async () => {
            await clearStateAsync();
            const target = join(TEST_STATE_DIR, 'symlink-target.json');
            await writeFile(
                target,
                JSON.stringify({
                    sessionId: 'forged',
                    startedAt: 1,
                    resumedAt: 1,
                    resumeCount: 0,
                    sendCount: 0,
                    model: 'auto',
                    pendingQuestion: null,
                }),
                'utf8',
            );
            await symlink(target, TEST_STATE_FILE);

            assert.equal(await readStateAsync(), null);
        });
    });
});
