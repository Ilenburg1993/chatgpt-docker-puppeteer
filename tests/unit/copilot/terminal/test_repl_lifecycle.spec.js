// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = /** @type {Record<string, (...args: any[]) => void>} */ ({});
const fakeRl = {
    closed: false,
    line: '',
    on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return fakeRl;
    }),
    setPrompt: vi.fn(),
    prompt: vi.fn(),
};

const mocks = vi.hoisted(() => ({
    addAttachment: vi.fn(),
    beginTerminalRenderLock: vi.fn(),
    buildUserPrompt: vi.fn(() => 'você› '),
    buildWaitingPrompt: vi.fn(() => 'LLM-B pensando '),
    cancelScheduledTerminalPromptRedraw: vi.fn(),
    clearReservedInlineStatus: vi.fn(),
    dispatchCmd: vi.fn(),
    endTerminalRenderLock: vi.fn(),
    enqueueRuntimeInterventionMailbox: vi.fn(() => ({ runtimeId: 'default', merged: false, queueSize: 1, dropped: 0 })),
    extractAtReferences: vi.fn(() => ({ paths: [], strippedMessage: '' })),
    getBusy: vi.fn(() => false),
    getTerminalInterventionPolicy: vi.fn(() => ({
        allowQueueFallback: true,
        allowTextDirectives: true,
        defaultMode: 'zero-pr',
    })),
    getTurnQueueDepth: vi.fn(() => 0),
    isReadlineOpen: vi.fn(() => true),
    log: vi.fn(),
    parkTerminalPromptForContinuation: vi.fn(),
    println: vi.fn(),
    readRuntimeInterventionMailboxSummary: vi.fn(() => ({ queueSize: 0, dropped: 0 })),
    resetStatusRowState: vi.fn(),
    scheduleTerminalPromptRedraw: vi.fn(),
    sendTurn: vi.fn(async () => 'ok'),
    setRl: vi.fn(),
    setTerminalCommandRouterInjectPort: vi.fn(),
    setupAgentListeners: vi.fn(() => vi.fn()),
    setupTerminalLiveStatusLine: vi.fn(() => vi.fn()),
    suppressInlineStatusForSubmit: vi.fn(),
    terminalThemeRow: vi.fn((label, detail) => `${label} ${detail}`),
    terminalThemeText: vi.fn((_role, text) => text),
    tryAnswerTerminalPendingQuestionInput: vi.fn(() => null),
}));

vi.mock('node:readline', () => ({
    default: {
        createInterface: vi.fn(() => fakeRl),
    },
}));

vi.mock('#copilot/config', () => ({
    getTerminalInterventionPolicy: mocks.getTerminalInterventionPolicy,
}));

vi.mock('#copilot/observability', () => ({
    log: mocks.log,
}));

vi.mock('../../../../src/copilot/presentation/files/index.js', () => ({
    extractAtReferences: mocks.extractAtReferences,
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    addAttachment: mocks.addAttachment,
    enqueueRuntimeInterventionMailbox: mocks.enqueueRuntimeInterventionMailbox,
    getBusy: mocks.getBusy,
    readRuntimeInterventionMailboxSummary: mocks.readRuntimeInterventionMailboxSummary,
    setRl: mocks.setRl,
}));

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    beginTerminalRenderLock: mocks.beginTerminalRenderLock,
    buildUserPrompt: mocks.buildUserPrompt,
    buildWaitingPrompt: mocks.buildWaitingPrompt,
    cancelScheduledTerminalPromptRedraw: mocks.cancelScheduledTerminalPromptRedraw,
    clearReservedInlineStatus: mocks.clearReservedInlineStatus,
    endTerminalRenderLock: mocks.endTerminalRenderLock,
    getTurnQueueDepth: mocks.getTurnQueueDepth,
    parkTerminalPromptForContinuation: mocks.parkTerminalPromptForContinuation,
    println: mocks.println,
    resetStatusRowState: mocks.resetStatusRowState,
    scheduleTerminalPromptRedraw: mocks.scheduleTerminalPromptRedraw,
    sendTurn: mocks.sendTurn,
    suppressInlineStatusForSubmit: mocks.suppressInlineStatusForSubmit,
}));

vi.mock('../../../../src/copilot/terminal/state/repl-runtime/index.js', () => ({
    shouldConsumeTerminalPendingAnswerInput: vi.fn(() => false),
    tryAnswerTerminalPendingQuestionInput: mocks.tryAnswerTerminalPendingQuestionInput,
}));

vi.mock('../../../../src/copilot/terminal/state/repl/index.js', () => ({
    terminalThemeRow: mocks.terminalThemeRow,
    terminalThemeText: mocks.terminalThemeText,
}));

vi.mock('../../../../src/copilot/terminal/stores/index.js', () => ({
    resolve: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/repl/auto-brief.js', () => ({
    renderTerminalAutoBrief: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/repl/live-status-line.js', () => ({
    setupTerminalLiveStatusLine: mocks.setupTerminalLiveStatusLine,
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-banner.js', () => ({
    buildTerminalReplBanner: vi.fn(() => 'banner'),
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-command-parser.js', () => ({
    parseTerminalReplCommand: vi.fn(() => null),
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-command-router.js', () => ({
    CMD_ROUTES: [],
    dispatchCmd: mocks.dispatchCmd,
    isReadlineOpen: mocks.isReadlineOpen,
    setTerminalCommandRouterInjectPort: mocks.setTerminalCommandRouterInjectPort,
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-input-routing.js', () => ({
    formatTerminalQueuedTurnNotice: vi.fn(() => 'turno enfileirado'),
    isTerminalEscapeCommand: vi.fn(() => false),
    isTerminalImmediateCommand: vi.fn(() => false),
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-listeners.js', () => ({
    setupAgentListeners: mocks.setupAgentListeners,
}));

vi.mock('../../../../src/copilot/terminal/repl/repl-multiline.js', () => ({
    createTerminalMultilineInputState: vi.fn(() => ({
        acceptLine: vi.fn((line) => ({ complete: true, line, wasBuffered: false })),
        reset: vi.fn(),
    })),
}));

const { runReplLifecycle } = await import('../../../../src/copilot/terminal/repl/repl-lifecycle.js');

describe('terminal/repl-lifecycle', () => {
    beforeEach(() => {
        for (const key of Object.keys(handlers)) delete handlers[key];
        vi.clearAllMocks();
        fakeRl.closed = false;
        fakeRl.line = '';
    });

    it('estaciona prompt de espera antes de encaminhar intervenção ociosa como turno', async () => {
        await runReplLifecycle(/** @type {any} */ ({ close: vi.fn() }), { injectPort: 3010 });

        handlers['line']?.('teste canônico');
        await new Promise((resolve) => setImmediate(resolve));

        expect(mocks.parkTerminalPromptForContinuation).toHaveBeenCalled();
        expect(fakeRl.setPrompt).toHaveBeenCalledWith('LLM-B pensando ');
        expect(mocks.println).toHaveBeenCalledWith(
            expect.stringContaining('modelo ocioso; encaminhada como novo turno'),
            {
                redrawPrompt: false,
            },
        );
        expect(mocks.sendTurn).toHaveBeenCalledWith('teste canônico', 'user');
        expect(mocks.scheduleTerminalPromptRedraw).not.toHaveBeenCalledWith(fakeRl, 'você› ');
    });
});
