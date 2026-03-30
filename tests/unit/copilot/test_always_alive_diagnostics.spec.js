// @ts-check
/**
 * tests/unit/copilot/test_always_alive_diagnostics.spec.js
 *
 * Testes unitários para funcionalidades de diagnóstico adicionadas ao AlwaysAliveAgent:
 *
 * - setMaxListeners(50) no construtor (proteção contra MaxListenersExceededWarning)
 * - listenerDiagnostics() — retorna contagem de listeners por evento
 * - getStatusSnapshot() — campos de starvation: oldestTaskWaitMs e starvationAlert
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

describe('AlwaysAliveAgent — diagnósticos de listeners e starvation', () => {
    describe('setMaxListeners', () => {
        it('deve ter maxListeners configurado para 50 (acima do padrão 10)', () => {
            const max = alwaysAliveAgent.getMaxListeners();
            assert.ok(max >= 50, `getMaxListeners() retornou ${max}, esperado >= 50`);
        });

        it('deve aceitar ao menos 12 listeners simultâneos em task.delta sem emitir warning', () => {
            /** @type {(() => void)[]} */
            const handlers = [];
            for (let i = 0; i < 12; i++) {
                const h = () => {};
                handlers.push(h);
                alwaysAliveAgent.on('task.delta', h);
            }
            // Se MaxListeners fosse 10, o Node emitiria MaxListenersExceededWarning.
            // Verificamos apenas a contagem (sem causar warning num ambiente de test).
            assert.ok(alwaysAliveAgent.listenerCount('task.delta') >= 12);
            for (const h of handlers) {
                alwaysAliveAgent.off('task.delta', h);
            }
        });
    });

    describe('listenerDiagnostics()', () => {
        it('deve retornar um objeto com todos os 12 eventos canônicos', () => {
            const diag = alwaysAliveAgent.listenerDiagnostics();
            const expected = [
                'task.queued',
                'task.started',
                'task.completed',
                'task.error',
                'task.delta',
                'question.pending',
                'question.answered',
                'status',
                'stopped',
                'ready',
                'session.compaction_start',
                'session.compaction_complete',
            ];
            for (const evt of expected) {
                assert.ok(Object.prototype.hasOwnProperty.call(diag, evt), `Campo faltando: ${evt}`);
                assert.equal(typeof diag[evt], 'number', `${evt} não é número`);
            }
        });

        it('deve refletir corretamente a adição e remoção de listeners', () => {
            const diagBefore = alwaysAliveAgent.listenerDiagnostics();
            const h1 = () => {};
            const h2 = () => {};
            alwaysAliveAgent.on('ready', h1);
            alwaysAliveAgent.on('ready', h2);

            const diagDuring = alwaysAliveAgent.listenerDiagnostics();
            assert.equal(diagDuring['ready'] ?? 0, (diagBefore['ready'] ?? 0) + 2);

            alwaysAliveAgent.off('ready', h1);
            alwaysAliveAgent.off('ready', h2);

            const diagAfter = alwaysAliveAgent.listenerDiagnostics();
            assert.equal(diagAfter['ready'], diagBefore['ready']);
        });

        it('deve retornar valores numéricos não-negativos para todos os eventos', () => {
            const diag = alwaysAliveAgent.listenerDiagnostics();
            for (const [evt, count] of Object.entries(diag)) {
                assert.ok(count >= 0, `${evt}: count ${count} é negativo`);
            }
        });
    });

    describe('getStatusSnapshot() — starvation detection', () => {
        it('deve incluir oldestTaskWaitMs como número', () => {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            assert.equal(typeof snap.oldestTaskWaitMs, 'number');
            assert.ok(snap.oldestTaskWaitMs >= 0);
        });

        it('deve incluir starvationAlert como booleano', () => {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            assert.equal(typeof snap.starvationAlert, 'boolean');
        });

        it('deve retornar oldestTaskWaitMs === 0 quando a fila está vazia', () => {
            // O agente está stopped, então a fila está vazia.
            const snap = alwaysAliveAgent.getStatusSnapshot();
            assert.equal(snap.queueSize, 0);
            assert.equal(snap.oldestTaskWaitMs, 0);
        });

        it('deve retornar starvationAlert === false quando oldestTaskWaitMs é 0', () => {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            assert.equal(snap.starvationAlert, false);
        });

        it('deve continuar retornando os campos pré-existentes (não houve regressão)', () => {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            assert.ok('status' in snap, 'status ausente');
            assert.ok('sessionId' in snap, 'sessionId ausente');
            assert.ok('model' in snap, 'model ausente');
            assert.ok('queueSize' in snap, 'queueSize ausente');
            assert.ok('pendingQuestion' in snap, 'pendingQuestion ausente');
            assert.ok('isResumed' in snap, 'isResumed ausente');
            assert.ok('resumeCount' in snap, 'resumeCount ausente');
            assert.ok('sendCount' in snap, 'sendCount ausente');
        });
    });
});
