// @ts-check
/**
 * tests/unit/copilot/test_structured_client.spec.js
 *
 * Testes para o método chatStructured() de LlmBridgeClient (Sprint A).
 *
 * Verifica:
 *
 * - chatStructured() retorna StructuredChatResult con campo `structured`
 * - chatStructured() parseia resposta JSON válida de LLM-B → structured ≠ null
 * - chatStructured() retorna structured=null quando LLM-B responde texto puro
 * - chatStructured() propaga raw sempre (mesmo sem parse)
 * - chatStructured() inclui taskId, durationMs, chunks, responseLen
 * - chatStructured() delega opts (onDelta, timeoutMs) para chat() subjacente
 * - chatStructured() usa buildStructuredRequest internamente (valida input)
 * - chatStructured() lança ZodError para input inválido
 */

import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

// ─── Setup: mock de alwaysAliveAgent antes dos imports ────────────────────────
//
// O alwaysAliveAgent é um singleton que EventEmitter; precisamos interceptar
// fila de tasks para simular resposta de LLM-B sem depender de rede.

/** @type {Map<string, Function>} */
const _listeners = new Map();

const mockAgent = {
    getStatusSnapshot: () => ({ status: 'idle', sessionId: 'test-session-id', model: 'gpt-4.1', tools: 30 }),
    enqueue: mock.fn((/** @type {string} */ _msg, _opts) => {
        return Promise.resolve('mock-task-id');
    }),
    on: (/** @type {string} */ event, /** @type {Function} */ fn) => {
        _listeners.set(event, fn);
    },
    off: (/** @type {any} */ _event, /** @type {any} */ _fn) => {},
    answerPendingQuestion: mock.fn(),
};

// ─── Helpers de resposta ──────────────────────────────────────────────────────

/**
 * Monta payload de resposta StructuredMessage JSON (como LLM-B retornaria).
 *
 * @param {Partial<{ responseType: string; output: string; priority: string }>} [extra]
 */
function structuredJsonResponse(extra = {}) {
    return JSON.stringify({
        version: '1.0',
        context: 'Sprint A validado.',
        intent: 'Confirmar diagnóstico',
        priority: extra.priority ?? 'high',
        responseType: extra.responseType ?? 'diagnostic',
        output: extra.output ?? '1419 testes passando. 0 falhas.',
    });
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('LlmBridgeClient › chatStructured()', () => {
    /** @type {import('../../../src/copilot/channel/client.js').LlmBridgeClient} */
    let bridge;

    before(async () => {
        // Importamos o módulo real — mas substitui a chamada interna de chat() via spy
        const mod = await import('../../../src/copilot/channel/client.js');
        bridge = new mod.LlmBridgeClient();
    });

    it('exporta chatStructured como método de LlmBridgeClient', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const instance = new mod.LlmBridgeClient();
        assert.ok(typeof instance.chatStructured === 'function', 'chatStructured deve ser método');
    });

    it('chatStructured() retorna shape StructuredChatResult', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        // Spy em chat() para retornar resposta estruturada sem rede
        const mockChat = mock.fn(async (_msg, _opts) => ({
            taskId: 'task-abc',
            response: structuredJsonResponse(),
            responseLen: structuredJsonResponse().length,
            chunks: [structuredJsonResponse()],
            durationMs: 42,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({
            context: 'Sprint A implementado.',
            intent: 'Confirmar testes',
            priority: 'high',
            responseType: 'diagnostic',
        });

        // Deve ter todos os campos de StructuredChatResult
        assert.ok('structured' in result, 'deve ter campo structured');
        assert.ok('raw' in result, 'deve ter campo raw');
        assert.ok('taskId' in result, 'deve ter campo taskId');
        assert.ok('durationMs' in result, 'deve ter campo durationMs');
        assert.ok('chunks' in result, 'deve ter campo chunks');
        assert.ok('responseLen' in result, 'deve ter campo responseLen');
    });

    it('parseia resposta JSON de LLM-B → structured ≠ null', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = mock.fn(async () => ({
            taskId: 'task-1',
            response: structuredJsonResponse({ responseType: 'plan', output: 'Plano A concluído.' }),
            responseLen: 100,
            chunks: [],
            durationMs: 50,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({
            context: 'ctx',
            intent: 'intent',
            responseType: 'plan',
        });

        assert.notEqual(result.structured, null, 'structured deve ser parseado');
        assert.equal(result.structured?.responseType, 'plan');
        assert.equal(result.structured?.output, 'Plano A concluído.');
    });

    it('retorna structured=null quando LLM-B responde texto puro', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = mock.fn(async () => ({
            taskId: 'task-2',
            response: 'Desculpe, não entendi o protocolo. Pode repetir em português?',
            responseLen: 56,
            chunks: [],
            durationMs: 30,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({
            context: 'ctx',
            intent: 'intent',
            responseType: 'question',
        });

        assert.equal(result.structured, null, 'structured deve ser null para texto puro');
        assert.ok(result.raw.length > 0, 'raw deve ter conteúdo mesmo sem parse');
    });

    it('propaga raw sempre (JSON e texto puro)', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const responseText = structuredJsonResponse();
        const mockChat = mock.fn(async () => ({
            taskId: 'task-3',
            response: responseText,
            responseLen: responseText.length,
            chunks: [responseText],
            durationMs: 10,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' });
        assert.equal(result.raw, responseText, 'raw deve ser a resposta original');
    });

    it('inclui taskId, durationMs, chunks, responseLen no resultado', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = mock.fn(async () => ({
            taskId: 'specific-task-id',
            response: structuredJsonResponse(),
            responseLen: 999,
            chunks: ['chunk1', 'chunk2'],
            durationMs: 1234,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' });
        assert.equal(result.taskId, 'specific-task-id');
        assert.equal(result.durationMs, 1234);
        assert.equal(result.responseLen, 999);
        assert.deepEqual(result.chunks, ['chunk1', 'chunk2']);
    });

    it('passa onDelta para chat() como opção', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        /** @type {any} */
        let capturedOpts = null;
        const mockChat = mock.fn(async (_msg, opts) => {
            capturedOpts = opts;
            return { taskId: '', response: structuredJsonResponse(), responseLen: 10, chunks: [], durationMs: 5 };
        });
        b.chat = mockChat;

        const onDelta = (/** @type {any} */ _chunk) => {};
        await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' }, { onDelta });

        assert.ok(capturedOpts !== null, 'opts deve ter sido passado para chat()');
        assert.equal(capturedOpts.onDelta, onDelta, 'onDelta deve ser passado adiante');
    });

    it('serializa input como JSON com instrução de protocolo antes de enviar', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        /** @type {string} */
        let capturedMsg = '';
        const mockChat = mock.fn(async (msg) => {
            capturedMsg = msg;
            return { taskId: '', response: structuredJsonResponse(), responseLen: 10, chunks: [], durationMs: 5 };
        });
        b.chat = mockChat;

        await b.chatStructured({
            context: 'Sprint A.',
            intent: 'Confirmar',
            responseType: 'diagnostic',
        });

        assert.ok(capturedMsg.includes('STRUCTURED_PROTOCOL_V1:'), 'deve incluir instrução de protocolo');
        assert.ok(capturedMsg.includes('"context"'), 'deve incluir campo context serializado');
        assert.ok(capturedMsg.includes('"intent"'), 'deve incluir campo intent serializado');
    });

    it('lança ZodError para input inválido (context vazio)', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        await assert.rejects(
            () => b.chatStructured({ context: '', intent: 'i', responseType: 'diagnostic' }),
            (/** @type {any} */ err) => err.constructor.name === 'ZodError',
        );
    });

    it('lança ZodError para responseType inválido', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        await assert.rejects(
            // @ts-expect-error — teste deliberado de tipo inválido
            () => b.chatStructured({ context: 'c', intent: 'i', responseType: 'invalid_type' }),
            (/** @type {any} */ err) => err.constructor.name === 'ZodError',
        );
    });
});
