// @ts-check

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    rl: {
        closed: false,
        line: '',
        setPrompt: vi.fn(),
        prompt: vi.fn(),
        getPrompt: vi.fn(() => 'você› '),
    },
    busy: false,
    runtime: {
        model: 'kilo-auto/free',
        reasoningEffort: 'high',
        status: 'processing',
        sessionId: 's1',
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
        lastPrInfo: null,
    },
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getBusy: vi.fn(() => mocks.busy),
    getRl: vi.fn(() => mocks.rl),
    getSdkSessionMode: vi.fn(() => 'interactive'),
    getShowThinking: vi.fn(() => false),
    getShowStreaming: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    getShowToolActivity: vi.fn(() => true),
    getShowIntentActivity: vi.fn(() => true),
    getShowSessionActivity: vi.fn(() => false),
    setShowThinking: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowUsage: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowIntentActivity: vi.fn(),
    setShowSessionActivity: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'kilo-auto/free', reasoningEffort: 'high' })),
    readTerminalRuntimeState: vi.fn(() => mocks.runtime),
}));

vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
    readTerminalActivitySnapshot: vi.fn(() => ({
        phase: 'tool',
        label: 'Executando tool',
        detail: 'lendo arquivo',
        source: 'sdk',
        severity: 'info',
        progress: null,
        toolName: 'read_file_content',
        startedAt: 1,
        updatedAt: 2,
        ageMs: 1000,
    })),
}));

vi.mock('../../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel: vi.fn(() => 'normal'),
    readTerminalPromptDisplayPolicy: vi.fn(() => ({
        showQueueTag: true,
        showNonCriticalShadowTag: false,
        showWaitingActivity: true,
    })),
}));

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const { clearInlineStatus, redrawTerminalPrompt, scheduleTerminalPromptRedraw, writeInlineStatus } = await import(
    '../../../../src/copilot/terminal/dialog/output.js'
);

describe('terminal/dialog/output inline status', () => {
    /** @type {PropertyDescriptor | undefined} */
    let originalIsTTY;
    /** @type {PropertyDescriptor | undefined} */
    let originalColumns;
    /** @type {string | undefined} */
    let originalMode;

    beforeEach(() => {
        vi.clearAllMocks();
        writeSpy.mockClear();
        originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
        originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
        originalMode = process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
        delete process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        mocks.rl.closed = false;
        mocks.rl.line = '';
    });

    afterEach(() => {
        clearInlineStatus();
        if (originalIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
        if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
        if (originalMode === undefined) delete process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        else process.env['COPILOT_TERMINAL_INLINE_STATUS'] = originalMode;
    });

    it('renderiza a linha viva por default em modo reserved quando stdout é TTY', () => {
        writeInlineStatus('LLM-B tool/Executando tool · lendo arquivo');

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('LLM-B tool/Executando tool');
        expect(output).toContain('\x1b[s');
        expect(mocks.rl.setPrompt).toHaveBeenCalled();
        expect(mocks.rl.prompt).toHaveBeenCalled();
    });

    it('permite desligar a linha viva por env', () => {
        process.env['COPILOT_TERMINAL_INLINE_STATUS'] = 'off';

        writeInlineStatus('LLM-B tool/Executando tool');

        expect(writeSpy).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('não limpa input humano parcialmente digitado por redraw agendado', async () => {
        mocks.rl.line = '/usage now';

        scheduleTerminalPromptRedraw(mocks.rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('suprime repaint idêntico em sequência curta sem limpar a linha', () => {
        redrawTerminalPrompt(mocks.rl, 'você› ');
        redrawTerminalPrompt(mocks.rl, 'você› ');

        expect(mocks.rl.setPrompt).toHaveBeenCalledTimes(1);
        expect(mocks.rl.prompt).toHaveBeenCalledTimes(1);
    });
});
