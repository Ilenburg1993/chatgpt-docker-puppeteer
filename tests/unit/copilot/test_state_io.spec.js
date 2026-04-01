// @ts-check
/**
 * tests/unit/copilot/test_state_io.spec.js
 *
 * Testes unitários para src/copilot/agent/state-io.js.
 *
 * Cobre:
 *
 * - G2-TEST-14: writeStateAsync() com escritas concorrentes (mutex serial)
 * - G2-DX-15: readState() valida JSON — rejeita arrays e primitivos
 * - clearState() invalida cache
 * - writeState() síncrono persiste e atualiza cache
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// Configurar AGENT_STATE_FILE antes de importar state-io para usar um diretório temporário
const TEST_STATE_DIR = join(import.meta.dirname, '.tmp-state-io-test');
const TEST_STATE_FILE = join(TEST_STATE_DIR, 'test-state.json');
process.env.AGENT_STATE_FILE = TEST_STATE_FILE;

// Importar após definir env
const { readState, writeState, writeStateAsync, clearState } = await import('../../../src/copilot/agent/state-io.js');

describe('state-io', () => {
    before(() => {
        mkdirSync(TEST_STATE_DIR, { recursive: true });
    });

    after(() => {
        delete process.env.AGENT_STATE_FILE;
        if (existsSync(TEST_STATE_DIR)) {
            rmSync(TEST_STATE_DIR, { recursive: true, force: true });
        }
    });

    // ---------------------------------------------------------------------------
    // readState() básico
    // ---------------------------------------------------------------------------
    describe('readState()', () => {
        it('retorna null quando arquivo não existe', () => {
            clearState();
            if (existsSync(TEST_STATE_FILE)) rmSync(TEST_STATE_FILE);
            const result = readState();
            assert.equal(result, null);
        });

        it('G2-DX-15: rejeita array como estado inválido', () => {
            clearState();
            writeFileSync(TEST_STATE_FILE, JSON.stringify([1, 2, 3]), 'utf8');
            const result = readState();
            assert.equal(result, null, 'array não é um estado válido');
        });

        it('G2-DX-15: rejeita null literal como estado inválido', () => {
            clearState();
            writeFileSync(TEST_STATE_FILE, 'null', 'utf8');
            const result = readState();
            assert.equal(result, null, 'null literal não é estado válido');
        });

        it('G2-DX-15: rejeita primitivo (string) como estado inválido', () => {
            clearState();
            writeFileSync(TEST_STATE_FILE, '"hello"', 'utf8');
            const result = readState();
            assert.equal(result, null, 'string não é estado válido');
        });

        it('retorna estado válido quando arquivo contém objeto', () => {
            clearState();
            const state = {
                sessionId: 's-1',
                startedAt: 100,
                resumedAt: 100,
                resumeCount: 0,
                sendCount: 5,
                model: 'gpt-4.1',
                pendingQuestion: null,
            };
            writeFileSync(TEST_STATE_FILE, JSON.stringify(state), 'utf8');
            const result = readState();
            assert.equal(result?.sendCount, 5);
            assert.equal(result?.sessionId, 's-1');
        });
    });

    // ---------------------------------------------------------------------------
    // writeState() síncrono
    // ---------------------------------------------------------------------------
    describe('writeState()', () => {
        it('persiste e atualiza cache', () => {
            clearState();
            const result = writeState({ sendCount: 42 });
            assert.equal(result.sendCount, 42);
            // Cache deve estar populado
            const cached = readState();
            assert.equal(cached?.sendCount, 42);
        });
    });

    // ---------------------------------------------------------------------------
    // G2-TEST-14: writeStateAsync concorrente (mutex)
    // ---------------------------------------------------------------------------
    describe('writeStateAsync() concorrente (G2-TEST-14)', () => {
        it('escritas concorrentes são serializadas — resultado final reflete última escrita', async () => {
            clearState();
            writeState({
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
            writeState({
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
        it('remove arquivo e invalida cache', () => {
            writeState({ sendCount: 99 });
            assert.ok(existsSync(TEST_STATE_FILE));
            clearState();
            assert.ok(!existsSync(TEST_STATE_FILE), 'arquivo deve ter sido removido');
            assert.equal(readState(), null, 'cache deve estar invalidado');
        });
    });
});
