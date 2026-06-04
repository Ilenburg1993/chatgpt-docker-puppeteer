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
const printTerminalHumanQuestionCard = vi.fn();

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
    printTerminalHumanQuestionCard,
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
            'question',
            'Pergunta falhou',
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

    it('renderiza tool.user_requested de request_user_input como pergunta humana sem linha Tool crua', async () => {
        const { handleTerminalToolUserRequested } = await import(
            '../../../../src/copilot/terminal/events/tool-lifecycle-runtime.js'
        );

        handleTerminalToolUserRequested({
            toolName: 'request_user_input',
            requestId: 'chatcmpl-tool-80d5a00b25801fef',
            args: {
                question: 'Como você quer continuar?',
                choices: ['seguir', 'pausar'],
            },
        });

        expect(recordTerminalTurnToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'request_user_input',
                operation: 'ask',
                target: 'Como você quer continuar?',
                status: 'user_requested',
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador aguardando resposta',
            expect.objectContaining({
                detail: expect.stringContaining('Como você quer continuar?'),
                toolName: 'request_user_input',
                toolTarget: 'Como você quer continuar?',
            }),
        );
        expect(printTerminalHumanQuestionCard).toHaveBeenCalledWith(
            println,
            expect.objectContaining({
                question: 'Como você quer continuar?',
                choices: ['seguir', 'pausar'],
                allowFreeform: true,
                source: 'tool',
                state: 'aguardando resposta',
            }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Tool'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('chatcmpl-tool'));
    });

    it('reconcilia postToolUse com exitCode não zero como falha visual da tool', async () => {
        const { createToolCallRegistry } = await import(
            '../../../../src/copilot/terminal/state/tool-call-registry.js'
        );
        const { buildTerminalToolActivityPresentation } = await import(
            '../../../../src/copilot/terminal/events/tool-activity-presenter.js'
        );
        const { reconcileTerminalPostToolUseResult } = await import(
            '../../../../src/copilot/terminal/events/tool-lifecycle-runtime.js'
        );

        const registry = createToolCallRegistry();
        const args = {
            command: "node -e \"console.error('RECOVERABLE-TOOL-ERROR'); process.exit(7)\"",
            timeoutSeconds: 10,
        };
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'exec_command',
            args,
            toolCallId: 'chatcmpl-tool-exec',
        });
        registry.register('chatcmpl-tool-exec', 'exec_command', 'native', {
            canonicalName: presentation.canonicalToolName ?? 'exec_command',
            rawArgs: args,
            presentation,
        });

        reconcileTerminalPostToolUseResult({
            registry,
            evt: {
                toolName: 'exec_command',
                toolArgs: args,
                toolResult: {
                    resultType: 'success',
                    textResultForLlm: JSON.stringify({
                        success: false,
                        exitCode: 7,
                        stderr: 'RECOVERABLE-TOOL-ERROR\n',
                        durationMs: 264,
                    }),
                },
            },
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Integração externa falhou',
            expect.objectContaining({
                detail: expect.stringContaining('executando comando falhou'),
                severity: 'error',
                toolName: 'Executar comando',
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Integração externa falhou',
            expect.objectContaining({
                detail: expect.stringContaining('saída 7'),
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Falhou'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Falhou falhou'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Concluído'));
        expect(completeTerminalTurnToolCall).toHaveBeenCalledWith({
            toolCallId: 'chatcmpl-tool-exec',
            success: false,
        });
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                success: false,
                toolName: 'exec_command',
            }),
        );
    });

    it('não imprime sucesso provisório de external_completed para exec_command sem resultado estruturado', async () => {
        const { createToolCallRegistry } = await import(
            '../../../../src/copilot/terminal/state/tool-call-registry.js'
        );
        const { buildTerminalToolActivityPresentation } = await import(
            '../../../../src/copilot/terminal/events/tool-activity-presenter.js'
        );
        const { handleTerminalExternalToolCompleted } = await import(
            '../../../../src/copilot/terminal/events/tool-lifecycle-runtime.js'
        );

        const registry = createToolCallRegistry();
        const args = { command: 'node -e "process.exit(7)"', timeoutSeconds: 10 };
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'exec_command',
            args,
            toolCallId: 'chatcmpl-tool-exec',
        });
        registry.register('chatcmpl-tool-exec', 'exec_command', 'native', {
            canonicalName: presentation.canonicalToolName ?? 'exec_command',
            rawArgs: args,
            presentation,
        });

        handleTerminalExternalToolCompleted({
            registry,
            evt: {
                toolName: 'external_tool',
                requestId: 'req-exec',
                toolCallId: 'chatcmpl-tool-exec',
                success: true,
                data: { toolName: 'exec_command' },
            },
        });

        expect(registry.getEntry('chatcmpl-tool-exec')).not.toBeNull();
        expect(recordTerminalActivity).not.toHaveBeenCalledWith(
            'tool',
            'Integração externa concluída',
            expect.anything(),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Concluído'));
        expect(broadcastSse).not.toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'external_completed',
                success: true,
            }),
        );
    });
});
