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

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Setup: mock de alwaysAliveAgent antes dos imports ────────────────────────
//
// O alwaysAliveAgent é um singleton que EventEmitter; precisamos interceptar
// fila de tasks para simular resposta de LLM-B sem depender de rede.

/** @type {Map<string, Function>} */
const _listeners = new Map();

const mockAgent = {
    status: 'idle',
    getStatusSnapshot: () => ({ status: 'idle', sessionId: 'test-session-id', model: 'gpt-4.1', tools: 30 }),
    enqueue: vi.fn((/** @type {string} */ _msg, _opts) => {
        return Promise.resolve('mock-task-id');
    }),
    on: (/** @type {string} */ event, /** @type {Function} */ fn) => {
        _listeners.set(event, fn);
    },
    once: (/** @type {string} */ event, /** @type {Function} */ fn) => {
        _listeners.set(event, fn);
    },
    off: (/** @type {any} */ _event, /** @type {any} */ _fn) => {},
    sendMessage: vi.fn(),
    startDialogLoop: vi.fn(async () => undefined),
    sendDialogTurn: vi.fn(async () => 'ok'),
    stopDialogLoop: vi.fn(),
    answerPendingQuestion: vi.fn(),
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

    beforeAll(async () => {
        // Importamos o módulo real — mas substitui a chamada interna de chat() via spy
        const mod = await import('../../../src/copilot/channel/client.js');
        // Injeta mock como bridge agent para que requireAgent() não lance
        mod.setBridgeAgent(/** @type {any} */ (mockAgent));
        bridge = new mod.LlmBridgeClient();
    });

    it('exporta chatStructured como método de LlmBridgeClient', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const instance = new mod.LlmBridgeClient();
        expect(typeof instance.chatStructured === 'function').toBeTruthy(); // chatStructured deve ser método;
    });

    it('chatStructured() retorna shape StructuredChatResult', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        // Spy em chat() para retornar resposta estruturada sem rede
        const mockChat = vi.fn(async (_msg, _opts) => ({
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
        expect('structured' in result).toBeTruthy(); // deve ter campo structured;
        expect('raw' in result).toBeTruthy(); // deve ter campo raw;
        expect('taskId' in result).toBeTruthy(); // deve ter campo taskId;
        expect('durationMs' in result).toBeTruthy(); // deve ter campo durationMs;
        expect('chunks' in result).toBeTruthy(); // deve ter campo chunks;
        expect('responseLen' in result).toBeTruthy(); // deve ter campo responseLen;
    });

    it('parseia resposta JSON de LLM-B → structured ≠ null', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = vi.fn(async () => ({
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

        expect(result.structured).not.toBe(null); // structured deve ser parseado
        expect(result.structured?.responseType).toBe('plan');
        expect(result.structured?.output).toBe('Plano A concluído.');
    });

    it('retorna structured=null quando LLM-B responde texto puro', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = vi.fn(async () => ({
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

        expect(result.structured).toBe(null); // structured deve ser null para texto puro
        expect(result.raw.length > 0).toBeTruthy(); // raw deve ter conteúdo mesmo sem parse;
    });

    it('propaga raw sempre (JSON e texto puro)', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const responseText = structuredJsonResponse();
        const mockChat = vi.fn(async () => ({
            taskId: 'task-3',
            response: responseText,
            responseLen: responseText.length,
            chunks: [responseText],
            durationMs: 10,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' });
        expect(result.raw).toBe(responseText); // raw deve ser a resposta original
    });

    it('inclui taskId, durationMs, chunks, responseLen no resultado', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        const mockChat = vi.fn(async () => ({
            taskId: 'specific-task-id',
            response: structuredJsonResponse(),
            responseLen: 999,
            chunks: ['chunk1', 'chunk2'],
            durationMs: 1234,
        }));
        b.chat = mockChat;

        const result = await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' });
        expect(result.taskId).toBe('specific-task-id');
        expect(result.durationMs).toBe(1234);
        expect(result.responseLen).toBe(999);
        expect(result.chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('passa onDelta para chat() como opção', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        /** @type {any} */
        let capturedOpts = null;
        const mockChat = vi.fn(async (_msg, opts) => {
            capturedOpts = opts;
            return { taskId: '', response: structuredJsonResponse(), responseLen: 10, chunks: [], durationMs: 5 };
        });
        b.chat = mockChat;

        const onDelta = (/** @type {any} */ _chunk) => {};
        await b.chatStructured({ context: 'c', intent: 'i', responseType: 'diagnostic' }, { onDelta });

        expect(capturedOpts !== null).toBeTruthy(); // opts deve ter sido passado para chat();
        expect(capturedOpts.onDelta).toBe(onDelta); // onDelta deve ser passado adiante
    });

    it('serializa input como JSON com instrução de protocolo antes de enviar', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        /** @type {string} */
        let capturedMsg = '';
        const mockChat = vi.fn(async (msg) => {
            capturedMsg = msg;
            return { taskId: '', response: structuredJsonResponse(), responseLen: 10, chunks: [], durationMs: 5 };
        });
        b.chat = mockChat;

        await b.chatStructured({
            context: 'Sprint A.',
            intent: 'Confirmar',
            responseType: 'diagnostic',
        });

        expect(capturedMsg.includes('STRUCTURED_PROTOCOL_V1:')).toBeTruthy(); // deve incluir instrução de protocolo;
        expect(capturedMsg.includes('"context"')).toBeTruthy(); // deve incluir campo context serializado;
        expect(capturedMsg.includes('"intent"')).toBeTruthy(); // deve incluir campo intent serializado;
    });

    it('lança ZodError para input inválido (context vazio)', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        await expect(() =>
            b.chatStructured({ context: '', intent: 'i', responseType: 'diagnostic' }),
        ).rejects.toThrow();
    });

    it('lança ZodError para responseType inválido', async () => {
        const mod = await import('../../../src/copilot/channel/client.js');
        const b = new mod.LlmBridgeClient();

        await expect(
            // @ts-expect-error — teste deliberado de tipo inválido
            () => b.chatStructured({ context: 'c', intent: 'i', responseType: 'invalid_type' }),
        ).rejects.toThrow();
    });
});
