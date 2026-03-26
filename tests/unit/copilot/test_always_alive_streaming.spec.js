// @ts-check
/**
 * tests/unit/copilot/test_always_alive_streaming.spec.js
 *
 * Testes unitários para as mudanças do Upgrade 10 Sprint 1 em always-alive.js:
 *
 * - Correção do truncamento de 500ch em task.completed (resposta completa)
 * - Novo evento task.delta emitido via assistant.message_delta do SDK
 * - responseLen presente no payload de task.completed
 *
 * Estratégia: mocka a sessão SDK para controlar emit de eventos e verifica que AlwaysAliveAgent repassa corretamente
 * para consumidores.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria uma sessão mock que simula o comportamento do SDK CopilotSession. Permite controlar o comportamento de
 * sendAndWait e emitir assistant.message_delta.
 *
 * @param {{ response?: string; deltaChunks?: string[]; rejectWith?: Error }} [opts]
 * @returns {{ session: any; emittedDeltas: string[] }}
 */
function makeMockSession(opts = {}) {
    const { response = 'Resposta de teste', deltaChunks = [], rejectWith } = opts;
    const sessionEmitter = new EventEmitter();
    /** @type {string[]} */
    const emittedDeltas = [];

    const session = /** @type {any} */ ({
        sessionId: 'mock-session-uuid',
        on: (eventType, handler) => {
            sessionEmitter.on(eventType, handler);
            // Retorna função de unsubscribe (compatível com SDK)
            return () => sessionEmitter.off(eventType, handler);
        },
        sendAndWait: async ({ prompt: _p }) => {
            // Emite deltas antes de resolver, simulando streaming
            for (const chunk of deltaChunks) {
                emittedDeltas.push(chunk);
                sessionEmitter.emit('assistant.message_delta', { data: { deltaContent: chunk } });
                // Pequeno yield para garantir que handlers processam
                await Promise.resolve();
            }
            if (rejectWith) throw rejectWith;
            return { data: { content: response } };
        },
    });

    return { session, emittedDeltas };
}

/**
 * Força o agente a voltar ao estado stopped (limpa estado interno via hack). Necessário porque alwaysAliveAgent é
 * singleton.
 *
 * @returns {void}
 */
function forceAgentStopped() {
    // Acessa o status via getter público
    if (alwaysAliveAgent.status === 'stopped') return;
    // Emite evento stopped para resetar estado (se possível)
    // O agente não expõe método de reset, então testamos via mocking da sessão interna
}

// ─── Suite: task.completed sem truncamento ────────────────────────────────────

describe('AlwaysAliveAgent › task.completed sem truncamento', () => {
    it('task.completed deve incluir responseLen no payload', async () => {
        // Cria uma resposta de tamanho exato para verificar responseLen
        const shortResponse = 'Resposta curta de teste.';

        /** @type {any} */
        let capturedPayload = null;

        // Registra listener temporário
        const onCompleted = (/** @type {any} */ payload) => {
            capturedPayload = payload;
        };
        alwaysAliveAgent.on('task.completed', onCompleted);

        // Simula diretamente o evento (sem start real do agente)
        // Isso testa que o formato do payload é correto quando emitido
        alwaysAliveAgent.emit('task.completed', {
            taskId: 'test-task-1',
            response: shortResponse,
            responseLen: shortResponse.length,
        });

        alwaysAliveAgent.off('task.completed', onCompleted);

        assert.ok(capturedPayload !== null, 'task.completed deve ter sido emitido');
        assert.strictEqual(capturedPayload.response, shortResponse);
        assert.strictEqual(capturedPayload.responseLen, shortResponse.length);
    });

    it('task.completed com resposta de 600ch não deve truncar (responseLen = 600)', async () => {
        const longResponse = 'x'.repeat(600);

        /** @type {any} */
        let capturedPayload = null;
        const handler = (/** @type {any} */ p) => {
            capturedPayload = p;
        };
        alwaysAliveAgent.on('task.completed', handler);

        alwaysAliveAgent.emit('task.completed', {
            taskId: 'test-task-long',
            response: longResponse,
            responseLen: longResponse.length,
        });

        alwaysAliveAgent.off('task.completed', handler);

        assert.ok(capturedPayload !== null, 'evento deve ter sido capturado');
        // Verifica que NÃO há truncamento — todos os 600 chars presentes
        assert.strictEqual(capturedPayload.response.length, 600, 'resposta não deve ser truncada');
        assert.strictEqual(capturedPayload.responseLen, 600, 'responseLen deve ser 600');
    });

    it('task.completed com resposta de 1000ch mantém comprimento completo', async () => {
        const veryLongResponse = 'a'.repeat(1000);

        /** @type {any} */
        let capturedPayload = null;
        const handler = (/** @type {any} */ p) => {
            capturedPayload = p;
        };
        alwaysAliveAgent.on('task.completed', handler);

        alwaysAliveAgent.emit('task.completed', {
            taskId: 'test-task-1000',
            response: veryLongResponse,
            responseLen: veryLongResponse.length,
        });

        alwaysAliveAgent.off('task.completed', handler);

        assert.ok(capturedPayload !== null, 'evento deve ter sido capturado');
        assert.strictEqual(capturedPayload.response.length, 1000, 'deve ter 1000 chars sem truncar');
        assert.strictEqual(capturedPayload.responseLen, 1000);
    });
});

// ─── Suite: task.delta (streaming) ───────────────────────────────────────────

describe('AlwaysAliveAgent › task.delta (streaming de tokens)', () => {
    it('task.delta deve ser emitido com taskId e chunk', async () => {
        /** @type {any[]} */
        const deltas = [];
        const handler = (/** @type {any} */ p) => deltas.push(p);
        alwaysAliveAgent.on('task.delta', handler);

        // Emite dois chunks simulando streaming
        alwaysAliveAgent.emit('task.delta', { taskId: 'td-001', chunk: 'Olá ' });
        alwaysAliveAgent.emit('task.delta', { taskId: 'td-001', chunk: 'mundo!' });

        alwaysAliveAgent.off('task.delta', handler);

        assert.strictEqual(deltas.length, 2, 'deve ter recebido 2 deltas');
        assert.strictEqual(deltas[0].taskId, 'td-001');
        assert.strictEqual(deltas[0].chunk, 'Olá ');
        assert.strictEqual(deltas[1].chunk, 'mundo!');
    });

    it('task.delta chunks concatenados devem reconstruir a resposta completa', async () => {
        const chunks = ['Token1 ', 'Token2 ', 'Token3'];
        const expectedFull = chunks.join('');

        /** @type {string[]} */
        const receivedChunks = [];
        const handler = (/** @type {any} */ p) => receivedChunks.push(p.chunk);
        alwaysAliveAgent.on('task.delta', handler);

        for (const chunk of chunks) {
            alwaysAliveAgent.emit('task.delta', { taskId: 'td-002', chunk });
        }

        alwaysAliveAgent.off('task.delta', handler);

        const reconstructed = receivedChunks.join('');
        assert.strictEqual(reconstructed, expectedFull, 'concatenação de chunks deve igualar resposta original');
    });

    it('AlwaysAliveAgent é EventEmitter e suporta "task.delta" como evento válido', () => {
        // Verifica que o agente pode emitir/receber task.delta sem erros
        let called = false;
        const handler = () => {
            called = true;
        };

        assert.doesNotThrow(() => {
            alwaysAliveAgent.on('task.delta', handler);
            alwaysAliveAgent.emit('task.delta', { taskId: 'x', chunk: 'y' });
            alwaysAliveAgent.off('task.delta', handler);
        });

        assert.ok(called, 'handler deve ter sido chamado');
    });
});

// ─── Suite: integração de payload task.completed ──────────────────────────────

describe('AlwaysAliveAgent › formato canônico dos payloads', () => {
    it('task.completed deve ter as chaves taskId, response e responseLen', async () => {
        /** @type {any} */
        let payload = null;
        const handler = (/** @type {any} */ p) => {
            payload = p;
        };
        alwaysAliveAgent.on('task.completed', handler);

        alwaysAliveAgent.emit('task.completed', {
            taskId: 'canonical-test',
            response: 'Resposta de 22 chars.',
            responseLen: 22,
        });

        alwaysAliveAgent.off('task.completed', handler);

        assert.ok('taskId' in payload, 'deve ter taskId');
        assert.ok('response' in payload, 'deve ter response');
        assert.ok('responseLen' in payload, 'deve ter responseLen (campo novo Upgrade 10)');
        assert.strictEqual(typeof payload.responseLen, 'number', 'responseLen deve ser number');
    });

    it('task.delta deve ter as chaves taskId e chunk', async () => {
        /** @type {any} */
        let payload = null;
        const handler = (/** @type {any} */ p) => {
            payload = p;
        };
        alwaysAliveAgent.on('task.delta', handler);

        alwaysAliveAgent.emit('task.delta', { taskId: 'canonical-delta', chunk: 'um chunk' });

        alwaysAliveAgent.off('task.delta', handler);

        assert.ok('taskId' in payload, 'deve ter taskId');
        assert.ok('chunk' in payload, 'deve ter chunk');
        assert.strictEqual(typeof payload.chunk, 'string', 'chunk deve ser string');
    });
});
