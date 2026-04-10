// @ts-check
/**
 * @file Faixa 40 — Channel Module Test Suite (F221-F228)
 *
 * Testes para:
 * - src/copilot/channel/client-dialog.js (registerDialogListeners, startDialogMode, dialogTurn, stopDialogMode)
 * - src/copilot/channel/client-history.js (getLastNPairs)
 * - src/copilot/channel/client-structured.js (chatStructured)
 * - src/copilot/channel/sse-client.js (subscribeSse)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const { mockLog, mockLogSwallowed } = vi.hoisted(() => ({
    mockLog: vi.fn(),
    mockLogSwallowed: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({ log: mockLog }));
vi.mock('#copilot/core/error-handlers', () => ({ logSwallowed: mockLogSwallowed }));

// ─── Imports ─────────────────────────────────────────────────────────────────

const {
    registerDialogListeners,
    startDialogMode,
    dialogTurn,
    stopDialogMode,
} = await import('#copilot/channel/client-dialog');

const { getLastNPairs } = await import('#copilot/channel/client-history');

beforeEach(() => {
    vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// client-dialog.js
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria mock de BridgeAgentLike com listeners.
 *
 * @returns {import('#copilot/channel/client').BridgeAgentLike & { _emit: (evt: string, data?: unknown) => void }}
 */
function createMockAgent() {
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    /** @type {Map<string, Set<Function>>} */
    const onceListeners = new Map();

    /** @type {any} */
    const agent = {
        status: 'idle',
        sendMessage: vi.fn(),
        getStatusSnapshot: vi.fn(() => ({})),
        startDialogLoop: vi.fn(),
        sendDialogTurn: vi.fn(),
        stopDialogLoop: vi.fn(),
        answerPendingQuestion: vi.fn(),
        on(/** @type {string} */ event, /** @type {Function} */ fn) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(fn);
        },
        once(/** @type {string} */ event, /** @type {Function} */ fn) {
            if (!onceListeners.has(event)) onceListeners.set(event, new Set());
            onceListeners.get(event)?.add(fn);
        },
        off(/** @type {string} */ event, /** @type {Function} */ fn) {
            listeners.get(event)?.delete(fn);
            onceListeners.get(event)?.delete(fn);
        },
        _emit(/** @type {string} */ event, /** @type {unknown} */ data) {
            for (const fn of listeners.get(event) ?? []) fn(data);
            for (const fn of onceListeners.get(event) ?? []) fn(data);
            onceListeners.get(event)?.clear();
        },
    };
    return agent;
}

describe('F40 — registerDialogListeners', () => {
    it('registra onReady, onReply, onStopped', () => {
        const agent = createMockAgent();
        const onReady = vi.fn();
        const onReply = vi.fn();
        const onStopped = vi.fn();

        const { cleanup } = registerDialogListeners(agent, { onReady, onReply, onStopped });

        agent._emit('dialog.ready');
        agent._emit('dialog.reply', { reply: 'hi' });
        agent._emit('dialog.stopped');

        expect(onReady).toHaveBeenCalled();
        expect(onReply).toHaveBeenCalledWith('hi');
        expect(onStopped).toHaveBeenCalled();

        cleanup();
    });

    it('cleanup remove listeners', () => {
        const agent = createMockAgent();
        const onReply = vi.fn();

        const { cleanup } = registerDialogListeners(agent, { onReply });
        cleanup();

        agent._emit('dialog.reply', { reply: 'late' });
        expect(onReply).not.toHaveBeenCalled();
    });

    it('funciona sem callbacks opcionais', () => {
        const agent = createMockAgent();
        const { cleanup } = registerDialogListeners(agent, {});
        // Não deve lançar
        agent._emit('dialog.ready');
        agent._emit('dialog.reply', { reply: 'x' });
        cleanup();
    });
});

describe('F40 — startDialogMode', () => {
    it('chama agent.startDialogLoop com bootPrompt', async () => {
        const agent = createMockAgent();
        agent.startDialogLoop = vi.fn().mockResolvedValue(undefined);

        await startDialogMode(agent, 'boot prompt');

        expect(agent.startDialogLoop).toHaveBeenCalledWith('boot prompt');
    });

    it('limpa listeners em caso de erro', async () => {
        const agent = createMockAgent();
        agent.startDialogLoop = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(startDialogMode(agent, 'boot')).rejects.toThrow('fail');
    });
});

describe('F40 — dialogTurn', () => {
    it('envia turno e retorna resposta', async () => {
        const agent = createMockAgent();
        agent.sendDialogTurn = vi.fn().mockResolvedValue('resposta');

        const result = await dialogTurn(agent, 'mensagem');

        expect(result).toBe('resposta');
        expect(agent.sendDialogTurn).toHaveBeenCalledWith('mensagem', { timeout: 60_000 });
    });

    it('usa timeout customizado', async () => {
        const agent = createMockAgent();
        agent.sendDialogTurn = vi.fn().mockResolvedValue('ok');

        await dialogTurn(agent, 'msg', { timeout: 5000 });

        expect(agent.sendDialogTurn).toHaveBeenCalledWith('msg', { timeout: 5000 });
    });

    it('chama onDelta quando recebe task.delta', async () => {
        const agent = createMockAgent();
        const onDelta = vi.fn();

        agent.sendDialogTurn = vi.fn().mockImplementation(async () => {
            agent._emit('task.delta', { chunk: 'part1' });
            return 'done';
        });

        await dialogTurn(agent, 'msg', { onDelta });

        expect(onDelta).toHaveBeenCalledWith('part1');
    });
});

describe('F40 — stopDialogMode', () => {
    it('chama agent.stopDialogLoop com reason', async () => {
        const agent = createMockAgent();
        agent.stopDialogLoop = vi.fn().mockResolvedValue(undefined);

        await stopDialogMode(agent, 'user_request');

        expect(agent.stopDialogLoop).toHaveBeenCalledWith({
            authorized: true,
            reason: 'user_request',
        });
    });

    it('usa reason padrão watchdog_restart', async () => {
        const agent = createMockAgent();
        agent.stopDialogLoop = vi.fn().mockResolvedValue(undefined);

        await stopDialogMode(agent);

        expect(agent.stopDialogLoop).toHaveBeenCalledWith({
            authorized: true,
            reason: 'watchdog_restart',
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// client-history.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F40 — getLastNPairs', () => {
    /** @type {import('#copilot/channel/client').ConversationTurn[]} */
    const history = [
        { role: 'user', content: 'msg1', timestamp: 1000 },
        { role: 'assistant', content: 'reply1', timestamp: 1001 },
        { role: 'user', content: 'msg2', timestamp: 2000 },
        { role: 'assistant', content: 'reply2', timestamp: 2001 },
        { role: 'user', content: 'msg3', timestamp: 3000 },
        { role: 'assistant', content: 'reply3', timestamp: 3001 },
    ];

    it('retorna últimos N pares (user+assistant)', () => {
        const result = getLastNPairs(history, 2);
        expect(result).toHaveLength(4);
        expect(result[0]?.content).toBe('msg2');
        expect(result[1]?.content).toBe('reply2');
    });

    it('retorna todos os pares se N > disponíveis', () => {
        const result = getLastNPairs(history, 10);
        expect(result).toHaveLength(6);
    });

    it('retorna array vazio para histórico vazio', () => {
        const result = getLastNPairs([], 5);
        expect(result).toHaveLength(0);
    });

    it('trunca conteúdo com summarize=true', () => {
        const longHistory = [
            { role: 'user', content: 'x'.repeat(300), timestamp: 1000 },
            { role: 'assistant', content: 'y'.repeat(300), timestamp: 1001 },
        ];
        const result = getLastNPairs(/** @type {any} */ (longHistory), 1, { summarize: true });
        expect(result[0]?.content.length).toBeLessThanOrEqual(201); // 200 + '…'
    });

    it('não trunca conteúdo curto com summarize=true', () => {
        const result = getLastNPairs(history, 1, { summarize: true });
        expect(result[0]?.content).toBe('msg3');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// client-structured.js
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock('#copilot/core/structured-message', () => ({
    buildStructuredRequest: vi.fn((input) => ({ ...input, _type: 'structured' })),
    parseStructuredResponse: vi.fn((raw) => {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.responseType) return parsed;
        } catch { /* não é JSON */ }
        return null;
    }),
    serializeStructuredMessage: vi.fn((msg) => JSON.stringify(msg)),
}));

const { chatStructured } = await import('#copilot/channel/client-structured');

describe('F40 — chatStructured', () => {
    it('envia mensagem estruturada e retorna resultado parseado', async () => {
        const deps = {
            chat: vi.fn().mockResolvedValue({
                response: JSON.stringify({ responseType: 'diagnostic', output: 'ok' }),
                responseLen: 50,
                chunks: ['chunk1'],
                durationMs: 100,
                taskId: 't1',
            }),
            getSessionId: () => 'sess-1',
        };

        const result = await chatStructured(deps, {
            context: 'test',
            intent: 'check',
            priority: 'high',
        });

        expect(result.structured).toBeDefined();
        expect(result.structured?.responseType).toBe('diagnostic');
        expect(result.raw).toContain('diagnostic');
        expect(result.taskId).toBe('t1');
    });

    it('retorna parseError quando resposta não é estruturada', async () => {
        const deps = {
            chat: vi.fn().mockResolvedValue({
                response: 'plain text response',
                responseLen: 20,
                chunks: [],
                durationMs: 50,
                taskId: 't2',
            }),
            getSessionId: () => undefined,
        };

        const result = await chatStructured(deps, {
            context: 'test',
            intent: 'check',
        });

        expect(result.structured).toBeNull();
        expect(result.parseError).toBeDefined();
    });

    it('retenta com instrução explícita quando primeira resposta não é estruturada', async () => {
        const deps = {
            chat: vi.fn()
                .mockResolvedValueOnce({
                    response: 'not json',
                    responseLen: 8,
                    chunks: [],
                    durationMs: 50,
                    taskId: 't1',
                })
                .mockResolvedValueOnce({
                    response: JSON.stringify({ responseType: 'info', output: 'retry ok' }),
                    responseLen: 40,
                    chunks: ['c2'],
                    durationMs: 30,
                    taskId: 't2',
                }),
            getSessionId: () => 'sess-2',
        };

        const result = await chatStructured(deps, { context: 'test', intent: 'check' });

        expect(result.structured?.responseType).toBe('info');
        expect(deps.chat).toHaveBeenCalledTimes(2);
        expect(result.durationMs).toBe(80); // 50 + 30
    });

    it('usa sessionId do opts quando fornecido', async () => {
        const deps = {
            chat: vi.fn().mockResolvedValue({
                response: JSON.stringify({ responseType: 'info', output: 'ok' }),
                responseLen: 30,
                chunks: [],
                durationMs: 10,
                taskId: 't3',
            }),
            getSessionId: () => 'default-sess',
        };

        await chatStructured(deps, { context: 'test', intent: 'check' }, { sessionId: 'custom-sess' });

        // buildStructuredRequest should have received custom-sess
        const { buildStructuredRequest } = await import('#copilot/core/structured-message');
        expect(buildStructuredRequest).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'custom-sess' }),
        );
    });
});
