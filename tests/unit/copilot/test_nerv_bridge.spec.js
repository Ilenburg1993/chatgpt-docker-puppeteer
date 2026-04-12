// @ts-check
/**
 * tests/unit/copilot/test_nerv_bridge.spec.js
 *
 * Testes unitários para src/copilot/nerv-bridge.js (Upgrade 5: NERV Metrics).
 *
 * Valida:
 *
 * - mount() injeta NERV e ativa listeners nos eventos do AlwaysAliveAgent
 * - unmount() remove listeners e desativa o bridge
 * - isMounted() reflete o estado correto
 * - emitNerv() emite envelopes corretamente; é no-op sem NERV
 * - Eventos do alwaysAliveAgent são repassados ao NERV com actionCode correto
 * - Falhas no NERV.emitEvent não propagam exceção (safe emit)
 * - mount() é idempotente (desmonta e remonta em sequência)
 */

import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';
import {
    copilotNervBridge,
    emitNerv,
    isMounted,
    mount,
    registerNervBridgeAgent,
    unmount,
} from '../../../src/copilot/bridges/nerv-bridge.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cria um mock NERV mínimo com rastreamento de envelopes emitidos.
 *
 * @returns {{ emitEvent: (envelope: any) => Promise<void>; calls: any[] }}
 */
function makeMockNerv() {
    /** @type {any[]} */
    const calls = [];
    return {
        calls,
        emitEvent: async (envelope) => {
            calls.push(envelope);
        },
    };
}

// ─── Suite principal ──────────────────────────────────────────────────────────

describe('copilotNervBridge', () => {
    before(() => {
        registerNervBridgeAgent(alwaysAliveAgent);
    });

    afterEach(() => {
        // Garante que o bridge é desmontado após cada teste
        if (isMounted()) unmount();
    });

    // ── 1. Estado inicial ──────────────────────────────────────────────────

    describe('estado inicial', () => {
        it('isMounted() deve retornar false antes de mount()', () => {
            assert.equal(isMounted(), false);
        });

        it('emitNerv() sem NERV montado não lança exceção (no-op)', () => {
            assert.doesNotThrow(() => {
                emitNerv('ANY_ACTION', { foo: 'bar' });
            });
        });
    });

    // ── 2. mount / unmount ─────────────────────────────────────────────────

    describe('mount() / unmount()', () => {
        it('mount() deve setar isMounted() para true', () => {
            const nerv = makeMockNerv();
            mount(nerv);
            assert.equal(isMounted(), true);
        });

        it('unmount() deve setar isMounted() para false', () => {
            const nerv = makeMockNerv();
            mount(nerv);
            unmount();
            assert.equal(isMounted(), false);
        });

        it('mount() é idempotente — segunda chamada substitui o NERV anterior', () => {
            const nerv1 = makeMockNerv();
            const nerv2 = makeMockNerv();
            mount(nerv1);
            mount(nerv2); // não deve lançar; substitui nerv1
            assert.equal(isMounted(), true);
        });

        it('unmount() sem NERV montado não lança exceção', () => {
            assert.doesNotThrow(() => unmount());
        });
    });

    // ── 3. emitNerv() ─────────────────────────────────────────────────────

    describe('emitNerv()', () => {
        it('emite envelope com actor COPILOT e actionCode correto', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            emitNerv('COPILOT_TEST_EVENT', { key: 'value' });

            // Aguarda microtask da Promise interna
            await new Promise((r) => setImmediate(r));

            assert.equal(nerv.calls.length, 1);
            const env = nerv.calls[0];
            assert.equal(env.actor, 'COPILOT');
            assert.equal(env.actionCode, 'COPILOT_TEST_EVENT');
            assert.equal(env.messageType, 'EVENT');
            assert.deepEqual(env.payload, { key: 'value' });
        });

        it('payload não-objeto é encapsulado em { value }', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            emitNerv('COPILOT_TEST', /** @type {any} */ ('string-value'));
            await new Promise((r) => setImmediate(r));
            assert.equal(nerv.calls[0].payload.value, 'string-value');
        });

        it('falha no NERV.emitEvent não propaga exceção', async () => {
            /** @type {any} */
            const badNerv = {
                emitEvent: async () => {
                    throw new Error('NERV down');
                },
            };
            mount(badNerv);
            assert.doesNotThrow(() => emitNerv('BROKEN', { x: 1 }));
            // Aguarda resolução da Promise rejeitada internamente
            await new Promise((r) => setTimeout(r, 50));
        });
    });

    // ── 4. Repasse de eventos do AlwaysAliveAgent ──────────────────────────

    describe('eventos do AlwaysAliveAgent → NERV', () => {
        it('evento "status" é repassado ao NERV como COPILOT_AGENT_STATUS', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            alwaysAliveAgent.emit('status', 'idle');
            await new Promise((r) => setImmediate(r));
            const sent = nerv.calls.find((c) => c.actionCode === 'COPILOT_AGENT_STATUS');
            assert.ok(sent, 'Esperava COPILOT_AGENT_STATUS no NERV');
        });

        it('evento "task.completed" é repassado como COPILOT_TASK_COMPLETED', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            alwaysAliveAgent.emit('task.completed', { taskId: 'abc', response: 'ok' });
            await new Promise((r) => setImmediate(r));
            const sent = nerv.calls.find((c) => c.actionCode === 'COPILOT_TASK_COMPLETED');
            assert.ok(sent);
            assert.equal(sent.payload.taskId, 'abc');
        });

        it('evento "question.pending" é repassado como COPILOT_QUESTION_PENDING', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            alwaysAliveAgent.emit('question.pending', { question: 'Qual o próximo passo?' });
            await new Promise((r) => setImmediate(r));
            const sent = nerv.calls.find((c) => c.actionCode === 'COPILOT_QUESTION_PENDING');
            assert.ok(sent);
        });

        it('após unmount(), eventos do agente NÃO são mais repassados', async () => {
            const nerv = makeMockNerv();
            mount(nerv);
            unmount();
            alwaysAliveAgent.emit('task.started', { taskId: 'x' });
            await new Promise((r) => setImmediate(r));
            const sent = nerv.calls.find((c) => c.actionCode === 'COPILOT_TASK_STARTED');
            assert.equal(sent, undefined, 'Não deveria repassar evento após unmount');
        });
    });

    // ── 5. Objeto de conveniência copilotNervBridge ────────────────────────

    describe('copilotNervBridge (objeto de conveniência)', () => {
        it('expõe mount, unmount, isMounted e emitNerv', () => {
            assert.equal(typeof copilotNervBridge.mount, 'function');
            assert.equal(typeof copilotNervBridge.unmount, 'function');
            assert.equal(typeof copilotNervBridge.isMounted, 'function');
            assert.equal(typeof copilotNervBridge.emitNerv, 'function');
        });

        it('copilotNervBridge.mount/unmount compartilha estado com exports nomeadas', () => {
            const nerv = makeMockNerv();
            copilotNervBridge.mount(nerv);
            assert.equal(isMounted(), true);
            copilotNervBridge.unmount();
            assert.equal(isMounted(), false);
        });
    });

    // ── 6. F34.6: Inbound NERV → agent round-trip ─────────────────────────

    describe('F34.6: NERV → agent inbound commands (round-trip)', () => {
        it('COPILOT_COMMAND com comando desconhecido não lança erro', async () => {
            /** @type {Map<string, (envelope: any) => void>} */
            const subs = new Map();
            const nerv = {
                ...makeMockNerv(),
                onEvent: (/** @type {string} */ actionCode, /** @type {(env: any) => void} */ handler) => {
                    subs.set(actionCode, handler);
                    return () => subs.delete(actionCode);
                },
            };
            mount(nerv);
            const handler = subs.get('COPILOT_COMMAND');
            assert.ok(handler, 'handler COPILOT_COMMAND deve ser registrado');
            // Enviar comando desconhecido — deve ser no-op sem crash
            assert.doesNotThrow(() => handler({ payload: { command: 'nonexistent' } }));
        });

        it('COPILOT_COMMAND sem campo command é no-op', async () => {
            /** @type {Map<string, (envelope: any) => void>} */
            const subs = new Map();
            const nerv = {
                ...makeMockNerv(),
                onEvent: (/** @type {string} */ actionCode, /** @type {(env: any) => void} */ handler) => {
                    subs.set(actionCode, handler);
                    return () => subs.delete(actionCode);
                },
            };
            mount(nerv);
            const handler = subs.get('COPILOT_COMMAND');
            assert.ok(handler);
            assert.doesNotThrow(() => handler({ payload: {} }));
            assert.doesNotThrow(() => handler({ payload: { command: 42 } }));
        });

        it('outbound round-trip: agent event → NERV → agent listener pode reagir', async () => {
            /** @type {any[]} */
            const captured = [];
            const nerv = {
                ...makeMockNerv(),
                emitEvent: async (/** @type {any} */ envelope) => {
                    captured.push(envelope);
                },
            };
            mount(nerv);

            // Agent emite task.queued → nerv-bridge repassa para NERV como COPILOT_TASK_QUEUED
            alwaysAliveAgent.emit('task.queued', { taskId: 'rt-1' });
            await new Promise((r) => setImmediate(r));

            const envelope = captured.find((c) => c.actionCode === 'COPILOT_TASK_QUEUED');
            assert.ok(envelope, 'envelope COPILOT_TASK_QUEUED deve existir no NERV');
            assert.equal(envelope.payload.taskId, 'rt-1');
            assert.equal(envelope.actor, 'COPILOT');
            assert.equal(envelope.messageType, 'EVENT');
            assert.ok(typeof envelope.timestamp === 'number');
        });

        it('unmount() limpa inbound subscription (onEvent unsub é chamado)', () => {
            let unsubCalled = false;
            const nerv = {
                ...makeMockNerv(),
                onEvent: (/** @type {string} */ _ac, /** @type {any} */ _h) => {
                    return () => {
                        unsubCalled = true;
                    };
                },
            };
            mount(nerv);
            unmount();
            assert.ok(unsubCalled, 'unsub do onEvent deve ter sido chamado ao unmount');
        });

        it('mount() → unmount() → mount() não duplica listeners', async () => {
            const nerv1 = makeMockNerv();
            const nerv2 = makeMockNerv();
            mount(nerv1);
            unmount();
            mount(nerv2);

            alwaysAliveAgent.emit('task.started', { taskId: 'dup-check' });
            await new Promise((r) => setImmediate(r));

            // Deve aparecer somente no nerv2 (não no nerv1)
            assert.equal(nerv1.calls.length, 0, 'nerv1 não deve receber após unmount');
            const found = nerv2.calls.find((c) => c.actionCode === 'COPILOT_TASK_STARTED');
            assert.ok(found, 'nerv2 deve receber o evento');
        });
    });
});
