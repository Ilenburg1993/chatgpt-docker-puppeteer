// @ts-check
import { describe, it } from 'node:test';
/**
 * tests/unit/copilot/terminal/test_commands_session.spec.js
 *
 * Testes para commands/session.js — comandos REPL de sessão (/status, /history, /who, etc). Usa mocks dos singletons;
 * testa saída via println mock.
 */

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: {
        status: 'idle',
        model: 'gpt-4.1',
        reasoningEffort: 'high',
        dialogLoopActive: false,
        sessionId: 'test-session-id',
        getStatusSnapshot: () => ({
            status: 'idle',
            model: 'gpt-4.1',
            reasoningEffort: 'high',
            sendCount: 5,
            dialogPaused: false,
            pendingQuestion: null,
            contextWindow: 128000,
        }),
        dialogPrMetrics: null,
        answerPendingQuestion: vi.fn((/** @type {string} */ _arg) => true),
    },
    createSnapshot: vi.fn((/** @type {Record<string, unknown>} */ data) => ({
        snapshotId: 'snap-001',
        createdAt: Date.now(),
        ...data,
    })),
    saveSnapshotAsync: vi.fn(async () => '/tmp/snap-001.json'),
    listSnapshotsAsync: vi.fn(async () => [
        { snapshotId: 'snap-001', createdAt: Date.now(), model: 'gpt-4.1', reason: 'manual' },
    ]),
    loadSnapshotAsync: vi.fn(async (/** @type {string} */ id) => {
        if (id === 'snap-001') {
            return {
                snapshotId: 'snap-001',
                createdAt: Date.now(),
                sessionId: 'sess',
                model: 'gpt-4.1',
                status: 'idle',
                sendCount: 5,
                dialogLoopActive: false,
                dialogPaused: false,
                pendingQuestion: null,
                prMetrics: null,
            };
        }
        return null;
    }),
}));

vi.mock('#copilot/channel/client', () => ({
    llmBridgeClient: {
        turnCount: 12,
        history: [
            { role: 'user', content: 'hello world', timestamp: Date.now() },
            { role: 'assistant', content: 'hi', timestamp: Date.now() },
        ],
        clearHistory: vi.fn(),
    },
}));

vi.mock('#copilot/conversation-hub/store', () => ({
    conversationStore: {
        readTurns: vi.fn((_id, _opts) => [
            { role: 'user', content: 'a', created_at: Date.now() },
            { role: 'llm_b', content: 'b', created_at: Date.now() },
        ]),
        countTurns: vi.fn(() => 2),
        listHubSessions: vi.fn(() => [
            { id: 'abc-123', status: 'active', title: 'Test Session', created_at: Date.now() },
        ]),
        recallMemories: vi.fn(() => []),
    },
}));

const {
    cmdStatus,
    cmdHistory,
    cmdDbHistory,
    cmdDbSessions,
    cmdWho,
    cmdCount,
    cmdClear,
    cmdAnswer,
    cmdSessionSave,
    cmdSessionList,
    cmdSessionRestore,
} = await import('../../../../src/copilot/terminal/commands/session.js');

/**
 * @returns {{ println: import('vitest').Mock; output: () => string }}
 */
function mockCtx() {
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/session — sync commands', () => {
    it('cmdStatus imprime status do agente', () => {
        const ctx = mockCtx();
        cmdStatus({ hubSessionId: 'hub-1', injectPort: 3009, println: ctx.println });
        expect(ctx.println).toHaveBeenCalled();
        expect(ctx.output()).toContain('gpt-4.1');
    });

    it('cmdHistory imprime histórico', () => {
        const ctx = mockCtx();
        cmdHistory({ println: ctx.println }, 5);
        expect(ctx.println).toHaveBeenCalled();
        expect(ctx.output()).toContain('hello world');
    });

    it('cmdWho imprime atores com porta', () => {
        const ctx = mockCtx();
        cmdWho({ injectPort: 3009, println: ctx.println });
        expect(ctx.output()).toContain('3009');
        expect(ctx.output()).toContain('LLM-A');
    });

    it('cmdClear chama clearHistory', async () => {
        const ctx = mockCtx();
        cmdClear({ println: ctx.println });
        const { llmBridgeClient } = await import('#copilot/channel/client');
        expect(llmBridgeClient.clearHistory).toHaveBeenCalled();
    });

    it('cmdAnswer envia resposta pendente', () => {
        const ctx = mockCtx();
        cmdAnswer({ println: ctx.println }, 'sim');
        expect(ctx.output()).toContain('Resposta enviada');
    });

    it('cmdDbHistory sem hubSessionId avisa', () => {
        const ctx = mockCtx();
        cmdDbHistory({ hubSessionId: null, println: ctx.println });
        expect(ctx.output()).toContain('não disponível');
    });

    it('cmdDbHistory com hubSessionId exibe turnos', () => {
        const ctx = mockCtx();
        cmdDbHistory({ hubSessionId: 'hub-1', println: ctx.println });
        expect(ctx.println).toHaveBeenCalled();
    });

    it('cmdDbSessions lista sessions', () => {
        const ctx = mockCtx();
        cmdDbSessions({ hubSessionId: 'abc-123', println: ctx.println });
        expect(ctx.output()).toContain('Test Session');
    });

    it('cmdCount sem hubSessionId avisa', () => {
        const ctx = mockCtx();
        cmdCount({ hubSessionId: null, println: ctx.println });
        expect(ctx.output()).toContain('Nenhuma hub session');
    });

    it('cmdCount com hubSessionId exibe estatísticas', () => {
        const ctx = mockCtx();
        cmdCount({ hubSessionId: 'hub-1', println: ctx.println });
        expect(ctx.output()).toContain('Turnos');
    });
});

describe('commands/session — async commands', () => {
    it('cmdSessionSave salva e imprime path', async () => {
        const ctx = mockCtx();
        await cmdSessionSave({ println: ctx.println }, 'test-reason');
        expect(ctx.output()).toContain('Snapshot salvo');
    });

    it('cmdSessionList lista snapshots', async () => {
        const ctx = mockCtx();
        await cmdSessionList({ println: ctx.println });
        expect(ctx.output()).toContain('snap-001');
    });

    it('cmdSessionRestore sem id mostra uso', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, '');
        expect(ctx.output()).toContain('/session restore');
    });

    it('cmdSessionRestore com id válido mostra detalhes', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, 'snap-001');
        expect(ctx.output()).toContain('snap-001');
        expect(ctx.output()).toContain('gpt-4.1');
    });

    it('cmdSessionRestore com id inválido mostra erro', async () => {
        const ctx = mockCtx();
        await cmdSessionRestore({ println: ctx.println }, 'nonexistent');
        expect(ctx.output()).toContain('não encontrado');
    });
});
