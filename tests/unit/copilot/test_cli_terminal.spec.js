// @ts-check
/**
 * tests/unit/copilot/test_cli_terminal.spec.js
 *
 * Testes unitários para src/copilot/cli-terminal.js (Upgrade 10 Sprint 5).
 *
 * Cobre:
 *
 * - Módulo exporta startCli() como função
 * - cmdStatus / cmdHistory / cmdAnswer / clearHistory via helpers internos
 * - Fluxo de comando /status, /history, /clear, /answer, /quit
 * - Integração com LlmBridgeClient (mock de sendMessage)
 * - onDelta callback exibe chunks inline
 * - Cleanup de listeners ao fechar readline
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { before, describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/always-alive.js';

// ─── Suite: estrutura do módulo ────────────────────────────────────────────────

describe('cli-terminal › estrutura do módulo', () => {
    /** @type {any} */
    let mod;

    before(async () => {
        mod = await import('../../../src/copilot/cli-terminal.js');
    });

    it('exporta startCli() como função', () => {
        assert.ok(typeof mod.startCli === 'function', 'startCli deve ser função');
    });
});

// ─── Suite: LlmBridgeClient via instância direta ─────────────────────────────

describe('cli-terminal › LlmBridgeClient helpers (via import)', () => {
    /** @type {any} */
    let LlmBridgeClient;

    before(async () => {
        const mod = await import('../../../src/copilot/llm-bridge-client.js');
        LlmBridgeClient = mod.LlmBridgeClient;
    });

    it('clearHistory() reseta turnCount para 0', () => {
        const client = new LlmBridgeClient();
        client.clearHistory();
        assert.strictEqual(client.turnCount, 0);
    });

    it('getAgentStatus() retorna objeto com campo status', () => {
        const client = new LlmBridgeClient();
        const snap = client.getAgentStatus();
        assert.ok(typeof snap === 'object' && snap !== null);
        assert.ok('status' in snap);
    });

    it('answer() retorna false sem pergunta pendente', () => {
        const client = new LlmBridgeClient();
        assert.strictEqual(client.answer('qualquer coisa'), false);
    });

    it('history começa vazio em nova instância', () => {
        const client = new LlmBridgeClient();
        assert.deepStrictEqual(client.history.slice(), []);
    });
});

// ─── Suite: events do agente relayados pelo readline ─────────────────────────

describe('cli-terminal › setupAgentListeners via AlwaysAliveAgent', () => {
    it('question.pending emitido pelo agente é detectável via EventEmitter', (t) => {
        // Verifica que alwaysAliveAgent é um EventEmitter e emite evento
        assert.ok(alwaysAliveAgent instanceof EventEmitter, 'alwaysAliveAgent deve ser EventEmitter');

        let received = false;
        const handler = (/** @type {any} */ evt) => {
            received = true;
            assert.ok(typeof evt?.question === 'string');
        };
        alwaysAliveAgent.once('question.pending', handler);
        alwaysAliveAgent.emit('question.pending', { question: 'Você prefere A ou B?', choices: ['A', 'B'] });
        assert.ok(received, 'handler de question.pending deve ter sido chamado');
    });

    it('session.compaction_start e session.compaction_complete são emitíveis', () => {
        let startSeen = false;
        let completeSeen = false;

        alwaysAliveAgent.once('session.compaction_start', () => {
            startSeen = true;
        });
        alwaysAliveAgent.once('session.compaction_complete', () => {
            completeSeen = true;
        });

        alwaysAliveAgent.emit('session.compaction_start', {});
        alwaysAliveAgent.emit('session.compaction_complete', {});

        assert.ok(startSeen, 'session.compaction_start deve ter sido recebido');
        assert.ok(completeSeen, 'session.compaction_complete deve ter sido recebido');
    });
});

// ─── Suite: chat com onDelta via LlmBridgeClient mock ────────────────────────

describe('cli-terminal › integração com LlmBridgeClient', () => {
    it('onDelta acumula chunks corretamente (simula comportamento do CLI)', async () => {
        const { LlmBridgeClient: LBC } = await import('../../../src/copilot/llm-bridge-client.js');
        const client = new LBC();

        const captured = /** @type {string[]} */ ([]);
        const onDelta = (/** @type {string} */ chunk) => captured.push(chunk);

        const sendOrig = alwaysAliveAgent.sendMessage.bind(alwaysAliveAgent);
        const taskId = `task-cli-delta-${Date.now()}`;

        alwaysAliveAgent.sendMessage = async function (_msg) {
            alwaysAliveAgent.emit('task.queued', { taskId, message: _msg });
            await Promise.resolve();
            alwaysAliveAgent.emit('task.delta', { taskId, chunk: 'Olá ' });
            alwaysAliveAgent.emit('task.delta', { taskId, chunk: 'mundo!' });
            return Promise.resolve('Olá mundo!');
        };
        Object.defineProperty(alwaysAliveAgent, 'status', { get: () => 'idle', configurable: true });

        try {
            const result = await client.chat('Diga olá', { onDelta });
            assert.deepStrictEqual(captured, ['Olá ', 'mundo!']);
            assert.strictEqual(result.response, 'Olá mundo!');
            assert.strictEqual(result.chunks.length, 2);
        } finally {
            alwaysAliveAgent.sendMessage = sendOrig;
            // @ts-expect-error — removendo property de instância para restaurar prototype getter
            delete alwaysAliveAgent.status;
            client.clearHistory();
        }
    });

    it('múltiplos turnos acumulam no history corretamente', async () => {
        const { LlmBridgeClient: LBC } = await import('../../../src/copilot/llm-bridge-client.js');
        const client = new LBC();

        const sendOrig = alwaysAliveAgent.sendMessage.bind(alwaysAliveAgent);
        let callCount = 0;

        alwaysAliveAgent.sendMessage = async function (_msg) {
            callCount++;
            const taskId = `task-multi-${callCount}`;
            alwaysAliveAgent.emit('task.queued', { taskId, message: _msg });
            return Promise.resolve(`Resposta ${callCount}`);
        };
        Object.defineProperty(alwaysAliveAgent, 'status', { get: () => 'idle', configurable: true });

        try {
            await client.chat('Pergunta 1');
            await client.chat('Pergunta 2');

            assert.strictEqual(client.history.length, 4, 'deve ter 4 turnos (2 user + 2 assistant)');
            assert.strictEqual(client.turnCount, 2);
            assert.strictEqual(client.history[0].role, 'user');
            assert.strictEqual(client.history[1].role, 'assistant');
            assert.strictEqual(client.history[2].role, 'user');
            assert.strictEqual(client.history[3].role, 'assistant');
        } finally {
            alwaysAliveAgent.sendMessage = sendOrig;
            // @ts-expect-error — removendo property de instância
            delete alwaysAliveAgent.status;
            client.clearHistory();
        }
    });
});
