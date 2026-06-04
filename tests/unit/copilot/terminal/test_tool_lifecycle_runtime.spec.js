// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordToolCall = vi.fn();
const getShowToolActivity = vi.fn(() => true);
const broadcastSse = vi.fn();
const clearInlineStatus = vi.fn();
const println = vi.fn();
const writeInlineStatus = vi.fn();
const readTerminalRuntimeState = vi.fn(() => ({ status: 'idle', pendingQuestionKind: null }));
const completeTerminalTurnToolCall = vi.fn();
const recordTerminalActivity = vi.fn();
const recordTerminalToolLifecycleDiagnostic = vi.fn();
const recordTerminalTurnFileActivity = vi.fn();
const recordTerminalTurnToolActivity = vi.fn();

vi.mock('../../../../src/copilot/observability/index.js', () => ({
    recordToolCall,
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getShowToolActivity,
}));

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse,
    clearInlineStatus,
    println,
    writeInlineStatus,
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/index.js', () => ({
    readTerminalRuntimeState,
}));

vi.mock('../../../../src/copilot/terminal/events/human-question-renderer.js', () => ({
    printTerminalHumanQuestionCard: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/events/intent-renderer.js', () => ({
    renderTerminalIntent: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/state/events/index.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        completeTerminalTurnToolCall,
        getTerminalDetailLevel: vi.fn(() => 'compact'),
        recordTerminalActivity,
        recordTerminalToolLifecycleDiagnostic,
        recordTerminalTurnFileActivity,
        recordTerminalTurnToolActivity,
        terminalThemeRow: vi.fn((label, detail) => `${label} ${detail}`),
        terminalThemeStatus: vi.fn((success) => (success ? 'ok' : 'falhou')),
        terminalThemeText: vi.fn((_role, text) => text),
        withTerminalTurnCorrelation: vi.fn((payload) => payload),
    };
});

describe('terminal/tool-lifecycle-runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getShowToolActivity.mockReturnValue(true);
        readTerminalRuntimeState.mockReturnValue({ status: 'idle', pendingQuestionKind: null });
    });

    it('mantém falha de ask_user como pergunta ao operador em vez de tool genérica', async () => {
        const { createToolCallRegistry } = await import(
            '../../../../src/copilot/terminal/state/tool-call-registry.js'
        );
        const { buildTerminalToolActivityPresentation } = await import(
            '../../../../src/copilot/terminal/events/tool-activity-presenter.js'
        );
        const { handleTerminalNativeToolComplete } = await import(
            '../../../../src/copilot/terminal/events/tool-lifecycle-runtime.js'
        );

        const registry = createToolCallRegistry();
        const args = { question: 'ASK-CANONICAL: responda SIM para fechar o teste' };
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'ask_user',
            args,
            toolCallId: 'chatcmpl-tool-ask',
        });
        registry.register('chatcmpl-tool-ask', 'ask_user', 'native', {
            canonicalName: presentation.canonicalToolName ?? 'ask_user',
            rawArgs: args,
            presentation,
        });

        handleTerminalNativeToolComplete({
            registry,
            evt: {
                toolCallId: 'chatcmpl-tool-ask',
                success: false,
            },
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Tool falhou',
            expect.objectContaining({
                detail: expect.stringContaining('aguardando decisão humana falhou'),
                severity: 'error',
                toolName: 'request_user_input',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Pergunta ao operador'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('tool genérica'));
        expect(completeTerminalTurnToolCall).toHaveBeenCalledWith({
            toolCallId: 'chatcmpl-tool-ask',
            success: false,
        });
    });
});
