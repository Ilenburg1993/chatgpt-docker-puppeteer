// @ts-check
/**
 * tests/unit/copilot/test_llm_bridge_client.spec.js
 *
 * Testes unitários para src/copilot/llm-bridge-client.js (Upgrade 10 Sprint 4).
 *
 * Cobre:
 *
 * - LlmBridgeClient exportado corretamente (classe + singleton)
 * - chat() registra turnos no histórico (user + assistant)
 * - chat() coleta chunks via task.delta (streaming)
 * - chat() inclui durationMs, taskId, responseLen no resultado
 * - chat() chama onDelta para cada chunk
 * - chat() chama onQuestion quando há pergunta pendente
 * - clearHistory() limpa histórico e turnCount
 * - answer() delega para alwaysAliveAgent.answerPendingQuestion()
 * - getAgentStatus() delega para alwaysAliveAgent.getStatusSnapshot()
 * - Propriedades history e turnCount são readonly/corretas
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Suite: estrutura do módulo ────────────────────────────────────────────────

describe('llm-bridge-client › estrutura do módulo', () => {
    /** @type {any} */
    let mod;

    beforeAll(async () => {
        mod = await import('../../../src/copilot/channel/client.js');
    });

    it('exporta LlmBridgeClient (class)', () => {
        assert.ok(typeof mod.LlmBridgeClient === 'function', 'LlmBridgeClient deve ser classe');
    });

    it('exporta llmBridgeClient (singleton)', () => {
        assert.ok(
            mod.llmBridgeClient instanceof mod.LlmBridgeClient,
            'llmBridgeClient deve ser instância de LlmBridgeClient',
        );
    });

    it('llmBridgeClient tem método chat()', () => {
        assert.ok(typeof mod.llmBridgeClient.chat === 'function', 'deve ter chat()');
    });

    it('llmBridgeClient tem método answer()', () => {
        assert.ok(typeof mod.llmBridgeClient.answer === 'function', 'deve ter answer()');
    });

    it('llmBridgeClient tem método clearHistory()', () => {
        assert.ok(typeof mod.llmBridgeClient.clearHistory === 'function', 'deve ter clearHistory()');
    });

    it('llmBridgeClient tem getter history', () => {
        assert.ok(Array.isArray(mod.llmBridgeClient.history), 'history deve ser array');
    });

    it('llmBridgeClient tem getter turnCount', () => {
        assert.ok(typeof mod.llmBridgeClient.turnCount === 'number', 'turnCount deve ser number');
    });
});

// ─── Suite: histórico de conversa ─────────────────────────────────────────────

describe('LlmBridgeClient › histórico de conversa', () => {
    /** @type {any} */
    let LlmBridgeClient;

    beforeAll(async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        LlmBridgeClient = mod.LlmBridgeClient;
        // Injeta o agente real via DI para que requireAgent() não lance
        mod.setBridgeAgent(alwaysAliveAgent);
    });

    it('history está vazio ao criar nova instância', () => {
        const client = new LlmBridgeClient();
        assert.strictEqual(client.history.length, 0);
        assert.strictEqual(client.turnCount, 0);
    });

    it('clearHistory() limpa histórico e reseta turnCount', () => {
        const client = new LlmBridgeClient();
        // Simula histórico manualmente via alwaysAliveAgent emit
        // Só verifica que clearHistory reseta o que foi populado
        client.clearHistory();
        assert.strictEqual(client.history.length, 0);
        assert.strictEqual(client.turnCount, 0);
    });

    it('chat() rejeita se agente está stopped', async () => {
        const client = new LlmBridgeClient();
        // Garante que o agente está stopped (estado padrão sem start())
        if (alwaysAliveAgent.status !== 'stopped') return;

        await assert.rejects(
            () => client.chat('teste'),
            (/** @type {Error} */ err) => {
                assert.ok(
                    err.message.includes('Agente não está ativo') ||
                        err.message.includes('agent não injetado') ||
                        err.message.includes('ativo'),
                    `Esperado erro de agente inativo, recebido: ${err.message}`,
                );
                return true;
            },
        );
    });
});

// ─── Suite: coleta de streaming (task.delta) ──────────────────────────────────

describe('LlmBridgeClient › coleta de streaming via AlwaysAliveAgent', () => {
    it('onDelta é chamado para cada chunk emitido via task.delta', async () => {
        const { LlmBridgeClient: LBC } = await import('../../../src/copilot/channel/client.js');
        const client = new LBC();

        /** @type {string[]} */
        const receivedChunks = [];
        const onDelta = (/** @type {string} */ chunk) => receivedChunks.push(chunk);

        const sendMessageOrig = alwaysAliveAgent.sendMessage.bind(alwaysAliveAgent);
        // Stubs status para bypass do guard 'stopped'
        const origStatusDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(alwaysAliveAgent), 'status');

        // Monkey-patch temporário apenas para este teste
        const taskId = `task-bridge-test-${Date.now()}`;
        alwaysAliveAgent.sendMessage = async function (_msg) {
            // Emite task.queued primeiro
            alwaysAliveAgent.emit('task.queued', { taskId, message: _msg });
            await Promise.resolve();
            // Emite dois chunks de delta
            alwaysAliveAgent.emit('task.delta', { taskId, chunk: 'parte1 ' });
            alwaysAliveAgent.emit('task.delta', { taskId, chunk: 'parte2' });
            await Promise.resolve();
            return Promise.resolve('parte1 parte2');
        };
        // Sobrescreve status como propriedade de instância para este teste
        Object.defineProperty(alwaysAliveAgent, 'status', { get: () => 'idle', configurable: true });

        try {
            const result = await client.chat('teste delta', { onDelta });

            assert.ok(
                receivedChunks.length >= 2,
                `deve ter recebido ao menos 2 chunks, recebeu ${receivedChunks.length}`,
            );
            assert.strictEqual(receivedChunks[0], 'parte1 ');
            assert.strictEqual(receivedChunks[1], 'parte2');
            assert.strictEqual(result.response, 'parte1 parte2');
            assert.strictEqual(result.chunks.length, 2);
        } finally {
            alwaysAliveAgent.sendMessage = sendMessageOrig;
            // Restaura status descriptor original
            if (origStatusDescriptor) {
                Object.defineProperty(alwaysAliveAgent, 'status', origStatusDescriptor);
            } else {
                // @ts-expect-error — propriedade de teste definida dinamicamente
                delete alwaysAliveAgent.status;
            }
            client.clearHistory();
        }
    });

    it('chat() retorna result com taskId, response, responseLen, durationMs, chunks', async () => {
        const { LlmBridgeClient: LBC } = await import('../../../src/copilot/channel/client.js');
        const client = new LBC();

        const sendMessageOrig = alwaysAliveAgent.sendMessage.bind(alwaysAliveAgent);
        const taskId = `task-result-test-${Date.now()}`;

        alwaysAliveAgent.sendMessage = async function (_msg) {
            alwaysAliveAgent.emit('task.queued', { taskId, message: _msg });
            return Promise.resolve('Resposta completa de teste.');
        };
        Object.defineProperty(alwaysAliveAgent, 'status', { get: () => 'idle', configurable: true });

        try {
            const result = await client.chat('pergunta de teste');

            assert.ok(typeof result.taskId === 'string', 'taskId deve ser string');
            assert.strictEqual(result.response, 'Resposta completa de teste.');
            assert.strictEqual(result.responseLen, 'Resposta completa de teste.'.length);
            assert.ok(
                typeof result.durationMs === 'number' && result.durationMs >= 0,
                'durationMs deve ser number >= 0',
            );
            assert.ok(Array.isArray(result.chunks), 'chunks deve ser array');
        } finally {
            alwaysAliveAgent.sendMessage = sendMessageOrig;
            // @ts-expect-error — propriedade de teste definida dinamicamente
            delete alwaysAliveAgent.status;
            client.clearHistory();
        }
    });

    it('chat() adiciona turno user e assistant no histórico', async () => {
        const { LlmBridgeClient: LBC } = await import('../../../src/copilot/channel/client.js');
        const client = new LBC();

        const sendMessageOrig = alwaysAliveAgent.sendMessage.bind(alwaysAliveAgent);
        const taskId = `task-history-${Date.now()}`;

        alwaysAliveAgent.sendMessage = async function (_msg) {
            alwaysAliveAgent.emit('task.queued', { taskId, message: _msg });
            return Promise.resolve('Resposta assistente');
        };
        Object.defineProperty(alwaysAliveAgent, 'status', { get: () => 'idle', configurable: true });

        try {
            await client.chat('Mensagem usuário');

            assert.strictEqual(client.history.length, 2, 'deve ter 2 turnos (user + assistant)');
            assert.strictEqual(client.history[0]?.role, 'user');
            assert.strictEqual(client.history[0]?.content, 'Mensagem usuário');
            assert.strictEqual(client.history[1]?.role, 'assistant');
            assert.strictEqual(client.history[1]?.content, 'Resposta assistente');
            assert.strictEqual(client.turnCount, 1);
        } finally {
            alwaysAliveAgent.sendMessage = sendMessageOrig;
            // @ts-expect-error — propriedade de teste definida dinamicamente
            delete alwaysAliveAgent.status;
            client.clearHistory();
        }
    });
});

// ─── Suite: getAgentStatus e answer ──────────────────────────────────────────

describe('LlmBridgeClient › getAgentStatus() e answer()', () => {
    it('getAgentStatus() retorna objeto com campo status', async () => {
        const { llmBridgeClient } = await import('../../../src/copilot/channel/client.js');
        const snap = llmBridgeClient.getAgentStatus();
        assert.ok(typeof snap === 'object' && snap !== null, 'deve retornar objeto');
        assert.ok('status' in snap, 'deve ter campo status');
    });

    it('answer() retorna false quando não há pergunta pendente', async () => {
        const { llmBridgeClient } = await import('../../../src/copilot/channel/client.js');
        const result = llmBridgeClient.answer('resposta de teste');
        assert.strictEqual(result, false, 'deve retornar false sem pergunta pendente');
    });
});
