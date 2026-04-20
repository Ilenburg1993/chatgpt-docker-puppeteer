// @ts-check

import { beforeAll, describe, expect, it, vi } from 'vitest';

const stopDialogMode = vi.fn(async () => {});
const startDialogMode = vi.fn(async () => {});
const dialogTurn = vi.fn(async () => 'ok');
const clearHistory = vi.fn();
const seedHistory = vi.fn();
const pauseDialogLoop = vi.fn(async () => {});
const resumeDialogLoop = vi.fn(async () => {});
const stopDialogLoop = vi.fn(async () => {});
const pingDialogWatchdog = vi.fn();
const attachSocketIO = vi.fn();
const initHub = vi.fn(async () => {});
const notifyTerminalTurn = vi.fn();
const createHubSession = vi.fn(() => 'hub-1');
const getHubSession = vi.fn(() => ({ id: 'hub-1', title: 'Hub' }));
const getTurn = vi.fn(() => ({ turn_number: 7 }));
const writeTurn = vi.fn(async () => 42);

const defaultRuntime = /** @type {any} */ ({
    model: 'gpt-5',
    reasoningEffort: 'high',
    status: 'idle',
    sessionId: 'sdk-live',
    dialogLoopActive: true,
    dialogPaused: false,
    queueSize: 3,
    pendingQuestion: {
        question: 'seguir?',
        choices: ['sim', 'não'],
        kind: 'question',
        allowFreeform: true,
        askedAt: 1,
        protocolControlled: false,
    },
    pendingQuestionShadow: {
        question: 'READY: aguardando próxima mensagem',
        meta: { kind: 'ready', askedAt: 1, allowFreeform: true, protocolControlled: true },
        restoredAt: 2,
        expiresAt: 3,
    },
    pendingQuestionShadowState: 'expired',
    pendingQuestionShadowExpired: true,
    pendingQuestionShadowAgeMs: 1200,
    pendingQuestionShadowExpiresAt: 3,
    pendingQuestionShadowRemainingMs: 0,
    pauseDialogLoop,
    resumeDialogLoop,
    stopDialogLoop,
    pingDialogWatchdog,
    getHandoffManager: () => ({ getHistory: () => [{ fromAgent: 'llm-a', toAgent: 'llm-b', status: 'done' }] }),
});

vi.mock('#copilot/agent', () => ({
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') => (runtimeId === 'default' ? defaultRuntime : null),
    listAgentRuntimes: () => [{ runtimeId: 'default', runtime: defaultRuntime }],
}));

vi.mock('#copilot/channel', () => ({
    llmBridgeClient: {
        turnCount: 12,
        history: [{ role: 'user', content: 'oi' }],
        clearHistory,
        seedHistory,
        stopDialogMode,
        startDialogMode,
        dialogTurn,
    },
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: {
        isReady: true,
        init: initHub,
        attachSocketIO,
        notifyTerminalTurn,
        orchestrator: { kind: 'orchestrator' },
    },
    conversationStore: {
        createHubSession,
        getHubSession,
        getTurn,
        writeTurn,
    },
}));

/** @type {typeof import('../../../src/copilot/terminal/frontend/llm-b-runtime.js')} */
let runtime;

beforeAll(async () => {
    runtime = await import('../../../src/copilot/terminal/frontend/llm-b-runtime.js');
});

describe('terminal/frontend/llm-b-runtime', () => {
    it('projeta o estado canônico do runtime do terminal', () => {
        const state = runtime.readTerminalRuntimeState();

        expect(state.runtimeId).toBe('default');
        expect(state.model).toBe('gpt-5');
        expect(state.reasoningEffort).toBe('high');
        expect(state.dialogLoopActive).toBe(true);
        expect(state.queueSize).toBe(3);
        expect(state.pendingQuestion?.question).toBe('seguir?');
        expect(state.pendingQuestionKind).toBe('question');
        expect(state.pendingQuestionShadowKind).toBe('ready');
        expect(state.pendingQuestionShadowState).toBe('expired');
        expect(state.pendingQuestionShadowExpired).toBe(true);
        expect(state.pendingQuestionShadowAgeMs).toBe(1200);
        expect(state.pendingQuestionShadowExpiresAt).toBe(3);
        expect(state.pendingQuestionShadowRemainingMs).toBe(0);
    });

    it('encapsula operações de dialog mode e histórico do channel', async () => {
        await runtime.startTerminalDialogMode('boot', { onReady: vi.fn() });
        await runtime.runTerminalDialogTurn('mensagem', { timeout: 1000, onDelta: vi.fn() });
        await runtime.stopTerminalDialogMode();
        runtime.clearTerminalHistoryFeed();
        runtime.seedTerminalHistoryFeed('assistant', 'seed');

        expect(startDialogMode).toHaveBeenCalled();
        expect(dialogTurn).toHaveBeenCalled();
        expect(stopDialogMode).toHaveBeenCalled();
        expect(clearHistory).toHaveBeenCalled();
        expect(seedHistory).toHaveBeenCalledWith('assistant', 'seed');
        expect(runtime.readTerminalTurnCount()).toBe(12);
        expect(runtime.readTerminalHistoryFeed()).toHaveLength(1);
    });

    it('encapsula operações do agente e do hub', async () => {
        await runtime.pauseTerminalDialogLoop();
        await runtime.resumeTerminalDialogLoop();
        runtime.pingTerminalDialogWatchdog();
        await runtime.stopTerminalAgentRuntime();
        await runtime.initTerminalConversationHub();
        const hubId = runtime.createTerminalHubSession({ title: 'Terminal' });
        const turnId = await runtime.writeTerminalHubSystemTurn('hub-1', '[SISTEMA] ok');
        runtime.notifyTerminalHubTurn(
            'hub-1',
            { turnId: 1, role: 'user', content: 'olá', turnNumber: 1 },
            { turnId: 2, content: 'oi', turnNumber: 2, durationMs: 16 },
        );
        runtime.attachTerminalHubSocketIO(/** @type {any} */ ({ id: 'io' }));

        expect(runtime.readTerminalHandoffHistory()).toHaveLength(1);
        expect(runtime.readTerminalDialogStreamMeta()).toEqual({ model: 'gpt-5', reasoningEffort: 'high' });
        expect(runtime.isTerminalHubReady()).toBe(true);
        expect(runtime.readTerminalHubOrchestrator()).toEqual({ kind: 'orchestrator' });
        expect(runtime.readTerminalHubStore()).toBeTruthy();
        expect(runtime.readTerminalHubSession('hub-1')?.id).toBe('hub-1');
        expect(runtime.readTerminalHubTurn(42)?.turn_number).toBe(7);
        expect(hubId).toBe('hub-1');
        expect(turnId).toBe(42);
        expect(pauseDialogLoop).toHaveBeenCalled();
        expect(resumeDialogLoop).toHaveBeenCalled();
        expect(pingDialogWatchdog).toHaveBeenCalled();
        expect(stopDialogLoop).toHaveBeenCalledWith({ authorized: true, reason: 'authorized_stop' });
        expect(initHub).toHaveBeenCalled();
        expect(attachSocketIO).toHaveBeenCalled();
        expect(notifyTerminalTurn).toHaveBeenCalled();
    });
});
