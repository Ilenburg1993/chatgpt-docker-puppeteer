// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass
/**
 * tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
 *
 * Contrato: terminal/events/agent-runtime-events.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const println = vi.fn();
const printlnBlock = vi.fn((/** @type {string[]} */ lines) => println(lines.join('\n')));
const buildUserPrompt = vi.fn(() => 'prompt> ');
const broadcastSse = vi.fn();
const isTerminalRenderLocked = vi.fn(() => false);
const parkTerminalPromptForContinuation = vi.fn();
const scheduleTerminalPromptRedraw = vi.fn((/** @type {any} */ rl, /** @type {string} */ prompt) => {
    rl?.setPrompt?.(prompt);
    rl?.prompt?.();
});
const writeInlineStatus = vi.fn();
const recordTerminalActivity = vi.fn();
const getShowToolActivity = vi.fn(() => true);
const getShowUsage = vi.fn(() => true);
const getShowStreaming = vi.fn(() => true);
const getShowThinking = vi.fn(() => false);
const getShowIntentActivity = vi.fn(() => true);
const getShowSessionActivity = vi.fn(() => false);
const getRl = vi.fn(() => null);
const getHubSessionId = vi.fn(() => null);
const getBusy = vi.fn(() => false);
const getSdkSessionMode = vi.fn(() => 'default');
const setShowToolActivity = vi.fn();
const setShowUsage = vi.fn();
const setShowStreaming = vi.fn();
const setShowThinking = vi.fn();
const setShowIntentActivity = vi.fn();
const setShowSessionActivity = vi.fn();
const readTerminalRuntimeState = vi.fn(
    () =>
        /** @type {any} */ ({
            pendingQuestion: null,
            pendingQuestionKind: null,
        }),
);
const recordTerminalTurnToolActivity = vi.fn();
const completeTerminalTurnToolCall = vi.fn();
const completeTerminalTurnTrace = vi.fn();
const reviseRecentTerminalTurnTraceStatus = vi.fn(() => null);
const readTerminalTurnTraceProjection = vi.fn(() => ({ current: null, recent: [] }));
const getTerminalDetailLevel = vi.fn(() => 'detailed');
const recordToolCall = vi.fn();
const defaultErrorTracker = {
    trackError: vi.fn(),
};
const readConfiguredByokSummary = vi.fn(() => ({ enabled: false }));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    SEPARATOR: '---',
    println,
    printlnBlock,
    buildUserPrompt,
    broadcastSse,
    isTerminalRenderLocked,
    parkTerminalPromptForContinuation,
    scheduleTerminalPromptRedraw,
    writeInlineStatus,
}));

vi.mock('../../../src/copilot/terminal/dialog/io/index.js', () => ({
    SEPARATOR: '---',
    broadcastSse,
    buildUserPrompt,
    isTerminalRenderLocked,
    parkTerminalPromptForContinuation,
    println,
    printlnBlock,
    scheduleTerminalPromptRedraw,
    writeInlineStatus,
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    CRITICAL_EVENTS: new Set(),
    getBusy,
    getHubSessionId,
    getRl,
    getSdkSessionMode,
    getShowToolActivity,
    getShowUsage,
    getShowStreaming,
    getShowThinking,
    getShowIntentActivity,
    getShowSessionActivity,
    setShowToolActivity,
    setShowUsage,
    setShowStreaming,
    setShowThinking,
    setShowIntentActivity,
    setShowSessionActivity,
}));

vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalRuntimeState,
}));

vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    recordTerminalTurnToolActivity,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    reviseRecentTerminalTurnTraceStatus,
    readTerminalTurnTraceProjection,
}));

vi.mock('../../../src/copilot/observability/index.js', () => ({
    recordToolCall,
    defaultErrorTracker,
}));

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        .../** @type {Record<string, unknown>} */ (actual),
        readConfiguredByokSummary,
    };
});

vi.mock('../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel,
}));

describe('terminal/events/agent-runtime-events.js — contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        getTerminalDetailLevel.mockReturnValue('detailed');
        getShowUsage.mockReturnValue(true);
        getShowSessionActivity.mockReturnValue(false);
        readConfiguredByokSummary.mockReturnValue({ enabled: false });
        reviseRecentTerminalTurnTraceStatus.mockReturnValue(null);
        isTerminalRenderLocked.mockReturnValue(false);
        parkTerminalPromptForContinuation.mockClear();
        delete process.env['COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT'];
        printlnBlock.mockImplementation((/** @type {string[]} */ lines) => println(lines.join('\n')));
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: null,
                pendingQuestionKind: null,
            }),
        );
        readTerminalTurnTraceProjection.mockReturnValue({ current: null, recent: [] });
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env['COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT'];
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalAgentRuntimeEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        expect(typeof mod.setupTerminalAgentRuntimeEventListeners).toBe('function');
    });

    it('renderiza falha BYOK recuperável com vocabulário humano e sem mensagem crua do SDK', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('error')?.[0]?.({
            hookType: 'errorOccurred',
            errorContext: 'model_call',
            recoverable: true,
            errorMessage: 'Erro do SDK sem mensagem estruturada.',
            byokEnabled: true,
            byokProviderType: 'openai',
            byokProfile: 'kilo',
            byokModel: 'kilo-auto/free',
        });

        const rendered = println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                detail: expect.stringContaining('falha sem mensagem estruturada do SDK'),
                severity: 'warn',
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                detail: expect.not.stringContaining('Erro do SDK sem mensagem estruturada'),
            }),
        );
        expect(rendered).toContain('BYOK');
        expect(rendered).toContain('falha do provedor');
        expect(rendered).toContain('falha sem mensagem estruturada do SDK');
        expect(rendered).toContain('Recuperação');
        expect(rendered).not.toContain('Provedor BYOK');
        expect(rendered).not.toContain('Fallback');
        expect(rendered).not.toContain('Erro do SDK sem mensagem estruturada');
        expect(rendered).not.toContain('Premium Request');
    });

    it('materializa lifecycle SDK em activity e SSE sem imprimir quando atividade de sessao esta oculta', async () => {
        getShowSessionActivity.mockReturnValue(false);
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent) });
        listeners.get('sdk.lifecycle')?.[0]?.({
            type: 'session.foreground',
            sessionId: 'sdk-session-1',
            metadata: {
                summary: 'Sessao viva',
                authorization: 'Bearer very-secret-token-value',
                modifiedTime: '2026-05-22T00:00:00.000Z',
            },
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Sessão SDK em foreground',
            expect.objectContaining({
                detail: expect.stringContaining('sessão sdk-session-1'),
                source: 'sdk.lifecycle',
                recordHistory: true,
                updateCurrent: true,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Sessão SDK em foreground',
            expect.objectContaining({
                detail: expect.not.stringContaining('id='),
            }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Sessão SDK em foreground'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'sdk.lifecycle',
            expect.objectContaining({
                type: 'session.foreground',
                sessionId: 'sdk-session-1',
                visible: true,
                label: 'Sessão SDK em foreground',
                metadata: expect.objectContaining({
                    summary: 'Sessao viva',
                    authorization: '[redacted]',
                }),
                source: 'agent/sdk.lifecycle',
            }),
        );
    });

    it('imprime lifecycle SDK visivel quando atividade de sessao esta habilitada', async () => {
        getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent) });
        listeners.get('sdk.lifecycle')?.[0]?.({
            type: 'session.created',
            sessionId: 'sdk-created-1',
            metadata: { startTime: '2026-05-22T00:00:00.000Z' },
        });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('Sessão SDK criada: sessão sdk-created-1'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('id='));
        expect(broadcastSse).toHaveBeenCalledWith(
            'sdk.lifecycle',
            expect.objectContaining({
                type: 'session.created',
                sessionId: 'sdk-created-1',
                visible: true,
            }),
        );
    });

    it('mantem session.updated como lifecycle discreto para nao poluir streaming', async () => {
        getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent) });
        listeners.get('sdk.lifecycle')?.[0]?.({
            type: 'session.updated',
            sessionId: 'sdk-updated-1',
            metadata: { modifiedTime: '2026-05-22T00:00:00.000Z' },
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Sessão SDK atualizada',
            expect.objectContaining({
                recordHistory: false,
                updateCurrent: false,
            }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Sessão SDK atualizada'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'sdk.lifecycle',
            expect.objectContaining({
                type: 'session.updated',
                sessionId: 'sdk-updated-1',
                visible: false,
            }),
        );
    });

    it('materializa comandos SDK executados como evento de comando sem duplicar resposta da LLM', async () => {
        getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent) });
        listeners.get('sdk.command.executed')?.[0]?.({
            commandName: 'terminal_session',
            localCommand: '/session sdk',
            sessionId: 'sdk-session-1',
            args: ['recent'],
            safe: true,
            description: 'Mostra sessao',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Comando SDK executado',
            expect.objectContaining({
                detail: expect.stringContaining('terminal_session'),
                source: 'sdk.command',
                recordHistory: true,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Comando SDK executado',
            expect.objectContaining({
                detail: expect.stringContaining('comando local /session sdk'),
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Comando SDK executado',
            expect.objectContaining({
                detail: expect.not.stringContaining('session='),
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Comando SDK'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('terminal_session'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('SDK command:'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'sdk.command.executed',
            expect.objectContaining({
                commandName: 'terminal_session',
                localCommand: '/session sdk',
                sessionId: 'sdk-session-1',
                args: ['recent'],
                safe: true,
                source: 'agent/sdk.command',
            }),
        );
    });

    it('apresenta tools de arquivo com alvo e operação durante streaming', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } =
            await import('../../../src/copilot/terminal/state/turn-materialization-state.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'turn-tool-1', timestamp: 1000 });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'tool-1',
            toolName: 'workspace.read_file',
            args: { path: 'src/copilot/terminal/repl/repl.js' },
        });
        listeners.get('tool.execution_progress')?.[0]?.({
            toolCallId: 'tool-1',
            progressMessage: 'abrindo arquivo',
        });
        listeners.get('tool.execution_complete')?.[0]?.({
            toolCallId: 'tool-1',
            result: {
                success: true,
                path: 'src/copilot/terminal/repl/repl.js',
                returnedLines: { start: 12, end: 19 },
            },
            success: true,
        });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('lendo arquivo'));
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Ferramenta em uso',
            expect.objectContaining({
                detail: 'lendo arquivo · arquivo: src/copilot/terminal/repl/repl.js',
                toolName: 'Ler arquivo',
            }),
        );
        expect(recordTerminalTurnToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'workspace.read_file',
                operation: 'read',
                path: 'src/copilot/terminal/repl/repl.js',
                toolCallId: 'tool-1',
            }),
        );
        expect(completeTerminalTurnToolCall).toHaveBeenCalledWith({ toolCallId: 'tool-1', success: true });
        expect(recordToolCall).not.toHaveBeenCalled();
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'start',
                toolName: 'workspace.read_file',
                operation: 'read',
                path: 'src/copilot/terminal/repl/repl.js',
                traceId: 'turn:turn-tool-1',
                turnId: 'turn-tool-1',
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'complete',
                operation: 'read',
                lineRange: { start: 12, end: 19 },
                path: 'src/copilot/terminal/repl/repl.js',
                success: true,
                toolCallId: 'tool-1',
                toolName: 'workspace.read_file',
                traceId: 'turn:turn-tool-1',
                turnId: 'turn-tool-1',
            }),
        );
        clearTerminalTurnMaterialization();
    });

    it('usa progresso inline e pergunta compacta quando detalhe terminal está em compact', async () => {
        getTerminalDetailLevel.mockReturnValue('compact');
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });
        listeners.get('question.pending')?.[0]?.({
            question:
                'Confirme se deseja abrir o arquivo src/copilot/terminal/dialog/output.js e resumir as mudanças mais recentes com bastante detalhe',
            choices: ['sim, abrir e resumir', 'não agora'],
        });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'tool-compact',
            toolName: 'workspace.read_file',
            args: { path: 'src/copilot/terminal/dialog/output.js' },
        });
        listeners.get('tool.execution_progress')?.[0]?.({
            toolCallId: 'tool-compact',
            progressMessage: 'abrindo arquivo grande',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador reconciliada',
            expect.objectContaining({ detail: expect.stringContaining('Confirme se deseja abrir') }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('LLM-B perguntou'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('abrindo arquivo grande'));
        expect(writeInlineStatus).toHaveBeenCalledWith(expect.stringContaining('Ler arquivo'));
        expect(writeInlineStatus).not.toHaveBeenCalledWith(expect.stringContaining('workspace.read_file'));
        expect(writeInlineStatus).toHaveBeenCalledWith(expect.stringContaining('abrindo arquivo grande'));
    });

    it('mantém heartbeat de tool longa visível só na linha viva por padrão', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-18T10:00:00.000Z'));
        getTerminalDetailLevel.mockReturnValue('compact');
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        const cleanup = setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'tool-long-compact',
            toolName: 'exec_command',
        });
        println.mockClear();
        writeInlineStatus.mockClear();
        isTerminalRenderLocked.mockReturnValue(false);

        await vi.advanceTimersByTimeAsync(10_000);

        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('ainda trabalhando · 10s sem novo progresso'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('tool-long-compact'));
        expect(writeInlineStatus).toHaveBeenCalledWith(
            expect.stringContaining('ainda trabalhando · 10s sem novo progresso'),
        );

        cleanup();
    });

    it('não renderiza heartbeat de pergunta humana como tool longa', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-18T10:00:00.000Z'));
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        const cleanup = setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'chatcmpl-tool-80d5a00b25801fef',
            toolName: 'external_tool',
            canonicalName: 'request_user_input',
            detail: 'request_user_input ainda executando · 44s · chatcmpl-tool-80d5a00b25801fef',
        });
        println.mockClear();
        writeInlineStatus.mockClear();
        recordTerminalActivity.mockClear();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(recordTerminalActivity).not.toHaveBeenCalledWith(
            'tool',
            'Ferramenta em andamento',
            expect.anything(),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('ainda trabalhando'));
        expect(writeInlineStatus).not.toHaveBeenCalledWith(expect.stringContaining('ainda trabalhando'));
        expect(writeInlineStatus).not.toHaveBeenCalledWith(expect.stringContaining('chatcmpl-tool'));

        cleanup();
    });

    it('permite heartbeat durável de tool longa apenas por opt-in explícito', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-18T10:00:00.000Z'));
        process.env['COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT'] = 'true';
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        const cleanup = setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'tool-long-durable',
            toolName: 'exec_command',
        });
        println.mockClear();
        writeInlineStatus.mockClear();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(println).toHaveBeenCalledWith(expect.stringContaining('Executar comando'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('ainda trabalhando · 10s sem novo progresso'));
        expect(writeInlineStatus).toHaveBeenCalledWith(
            expect.stringContaining('ainda trabalhando · 10s sem novo progresso'),
        );

        cleanup();
    });

    it('deduplica tool.execution_start repetido com o mesmo toolCallId', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'dup-1',
            toolName: 'read_file_content',
            args: { path: 'src/copilot/tools/file/read-tools.js', startLine: 1, endLine: 120 },
        });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'dup-1',
            toolName: 'read_file_content',
            args: { path: 'src/copilot/tools/file/read-tools.js', startLine: 1, endLine: 120 },
        });

        expect(
            broadcastSse.mock.calls.filter(
                ([event, payload]) => event === 'tool.lifecycle' && payload?.type === 'start',
            ),
        ).toHaveLength(1);
        expect(println.mock.calls.filter(([line]) => String(line).includes('Ler arquivo'))).toHaveLength(1);
        expect(println.mock.calls.some(([line]) => String(line).includes('read_file_content'))).toBe(false);
    });

    it('preserva alvo da tool quando completion chega sem toolName e com toolCallId divergente', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'start-call',
            toolName: 'read_file_content',
            args: { path: 'package.json' },
        });
        println.mockClear();
        listeners.get('tool.execution_complete')?.[0]?.({
            toolCallId: 'complete-call-from-sdk',
            success: true,
        });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('package.json'));
        expect(completeTerminalTurnToolCall).toHaveBeenCalledWith({ toolCallId: 'start-call', success: true });
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'complete',
                path: 'package.json',
                toolCallId: 'start-call',
                toolName: 'read_file_content',
            }),
        );
    });

    it('normaliza nome genérico de tool a partir de payload aninhado antes de registrar lifecycle', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'generic-nested-1',
            toolName: 'unknown',
            data: {
                toolName: 'patch_file',
                args: { path: 'src/copilot/terminal/dialog/engine.js' },
            },
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Ferramenta em uso',
            expect.objectContaining({
                toolName: 'Editar arquivo',
                detail: expect.stringContaining('editando arquivo'),
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'start',
                toolCallId: 'generic-nested-1',
                toolName: 'patch_file',
                operation: 'edit',
            }),
        );
    });

    it('promove report_intent_local para intent persistente e visível no terminal', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'intent-tool-1',
            toolName: 'report_intent_local',
            args: {
                intent: 'Vou editar read-tools com leitura incremental.',
                tool: 'patch_file',
                risk: 'high',
            },
        });

        expect(printlnBlock).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('Intenção')]));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Vou editar read-tools'));
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'turn',
            'Intenção da LLM-B',
            expect.objectContaining({
                detail: expect.stringContaining('Vou editar read-tools'),
                source: 'tool/report_intent_local',
                severity: 'warn',
                toolName: 'patch_file',
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'assistant.intent',
            expect.objectContaining({
                intent: 'Vou editar read-tools com leitura incremental.',
                risk: 'high',
                source: 'tool/report_intent_local',
                tool: 'patch_file',
                toolCallId: 'intent-tool-1',
            }),
        );
    });

    it('deduplica visualmente intents equivalentes vindos de assistant.intent e report_intent_local', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { __test__: terminalIntentRendererTestHarness } =
            await import('../../../src/copilot/terminal/events/intent-renderer.js');
        terminalIntentRendererTestHarness.clearRecentIntentHashes();
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('assistant.intent')?.[0]?.({
            intent: 'terminal live canonical deltas tools ask_user usage',
        });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'intent-tool-dup',
            toolName: 'report_intent_local',
            args: {
                intent: 'terminal live canonical deltas tools ask_user usage',
            },
        });

        expect(printlnBlock).toHaveBeenCalledTimes(1);
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'turn',
            'Intenção da LLM-B',
            expect.objectContaining({
                detail: 'terminal live canonical deltas tools ask_user usage',
                source: 'sdk/assistant.intent',
            }),
        );
        const intentActivities = recordTerminalActivity.mock.calls.filter(
            (call) => call[0] === 'turn' && call[1] === 'Intenção da LLM-B',
        );
        expect(intentActivities).toHaveLength(1);
    });

    it('funciona em modo headless sem readline e ainda emite SSE de tools', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'tool-headless',
            toolName: 'workspace.write_file',
            args: { path: 'tmp/live.md' },
        });
        listeners.get('question.pending')?.[0]?.({
            question: 'Confirmar operação?',
            choices: ['sim', 'não'],
        });

        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'start',
                toolCallId: 'tool-headless',
                operation: 'write',
                path: 'tmp/live.md',
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador reconciliada',
            expect.objectContaining({ detail: 'Confirmar operação?' }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('LLM-B perguntou: "Confirmar operação?"'));
        expect(buildUserPrompt).not.toHaveBeenCalled();
    });

    it('suprime tool narration para ask_user protocolar', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'ask-1',
            toolName: 'ask_user',
            args: { prompt: 'READY: aguardando próxima mensagem' },
        });
        listeners.get('tool.execution_complete')?.[0]?.({
            toolCallId: 'ask-1',
            toolName: 'ask_user',
            success: true,
        });

        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('ask_user'));
        expect(broadcastSse).not.toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({ type: 'start', toolCallId: 'ask-1' }),
        );
        expect(recordTerminalActivity).not.toHaveBeenCalledWith(
            'tool',
            'Ferramenta em uso',
            expect.objectContaining({ toolName: 'ask_user' }),
        );
    });

    it('reanuncia automaticamente tool longa sem progresso visível', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-07T22:00:00.000-03:00'));
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        const cleanup = setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('tool.execution_start')?.[0]?.({
            toolCallId: 'bash-long',
            toolName: 'exec_command',
        });
        println.mockClear();
        recordTerminalActivity.mockClear();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Ferramenta em andamento',
            expect.objectContaining({
                toolName: 'Executar comando',
                detail: expect.stringContaining('10s ativos'),
            }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('ainda trabalhando · 10s sem novo progresso'));
        expect(writeInlineStatus).toHaveBeenCalledWith(
            expect.stringContaining('ainda trabalhando · 10s sem novo progresso'),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('bash-long'));

        cleanup();
    });

    it('expõe notificações operacionais de background agent e shell no terminal', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('agent.background.completed')?.[0]?.({
            agentId: 'bg-1',
            agentType: 'explore',
            status: 'completed',
            description: 'investigar sessão SDK',
        });
        listeners.get('agent.shell.completed')?.[0]?.({
            shellId: 'shell-1',
            exitCode: 0,
            description: 'npm run lint:copilot',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano concluída',
            expect.objectContaining({ detail: 'investigar sessão SDK · concluído', source: 'agent' }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Shell concluído',
            expect.objectContaining({ detail: 'npm run lint:copilot · saída 0', source: 'agent' }),
        );
        expect(println).toHaveBeenCalledWith(
            expect.stringMatching(/Tarefa\s+conclu[ií]da · investigar sessão SDK/u),
        );
        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('Shell'),
        );
        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('concluído · npm run lint:copilot · saída 0'),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('exit='));
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.background.completed',
            expect.objectContaining({
                agentId: 'bg-1',
                status: 'completed',
                source: 'agent/background.completed',
                timestamp: expect.any(Number),
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.shell.completed',
            expect.objectContaining({
                shellId: 'shell-1',
                exitCode: 0,
                source: 'agent/shell.completed',
                timestamp: expect.any(Number),
            }),
        );
    });

    it('não narra persistências internas de background como se fossem atividade da LLM-B', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('agent.background.completed')?.[0]?.({
            status: 'completed',
            description: 'Persist latest PR consumption snapshot',
        });
        listeners.get('agent.background.idle')?.[0]?.({
            description: 'always_alive',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano concluída',
            expect.objectContaining({
                detail: 'Persist latest PR consumption snapshot · concluído',
                recordHistory: false,
                updateCurrent: false,
            }),
        );
        expect(recordTerminalActivity).not.toHaveBeenCalledWith(
            'task',
            'Tarefa interna concluída',
            expect.objectContaining({
                detail: expect.stringContaining('status='),
            }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Persist latest PR consumption snapshot'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Background agent ocioso: always_alive'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.background.completed',
            expect.objectContaining({ visible: false, internal: true }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.background.idle',
            expect.objectContaining({ visible: false, internal: true }),
        );
    });

    it('promove pr.consumed para narrativa explícita de uso com SSE dedicada', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } =
            await import('../../../src/copilot/terminal/state/turn-materialization-state.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'turn-usage-1', timestamp: 1000 });
        listeners.get('pr.consumed')?.[0]?.({
            model: 'gpt-5-mini',
            configuredModel: 'gpt-5',
            effectiveModel: 'gpt-5-mini',
            cost: 0.0123,
            modelMismatch: true,
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Pedido premium classificado com divergência de modelo',
            expect.objectContaining({
                detail: 'modelo configurado gpt-5 · modelo efetivo gpt-5-mini · modelo cobrado gpt-5-mini · custo 0.0123',
                severity: 'warn',
                source: 'agent',
                recordHistory: true,
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Pedido premium'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('modelo cobrado gpt-5-mini'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('modeloCobrado='));
        expect(broadcastSse).toHaveBeenCalledWith(
            'pr.consumed',
            expect.objectContaining({
                model: 'gpt-5-mini',
                configuredModel: 'gpt-5',
                cost: 0.0123,
                traceId: 'turn:turn-usage-1',
                turnId: 'turn-usage-1',
                source: 'agent/pr.consumed',
            }),
        );
        clearTerminalTurnMaterialization();
    });

    it('não imprime usage durante lock de renderização do stream live', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };
        isTerminalRenderLocked.mockReturnValue(true);

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('pr.consumed')?.[0]?.({
            model: 'gpt-5-mini',
            configuredModel: 'gpt-5',
            effectiveModel: 'gpt-5-mini',
            cost: 0.0123,
            modelMismatch: true,
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Pedido premium classificado com divergência de modelo',
            expect.any(Object),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('Premium Request'));
        expect(broadcastSse).toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });

    it('narra llm.usage sem pedido premium separadamente de pr.consumed', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } =
            await import('../../../src/copilot/terminal/state/turn-materialization-state.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'turn-llm-usage-1', timestamp: 1000 });
        listeners.get('llm.usage')?.[0]?.({
            model: 'gpt-5.4',
            cost: 0.0123,
            classification: 'ask_user_continuation',
            premiumRequest: false,
            premiumRequestReason: 'user_input_completed_continuation',
            inputTokens: 10,
            outputTokens: 4,
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Uso BYOK sem pedido premium',
            expect.objectContaining({
                detail: 'modelo gpt-5.4 · tokens 10→4 · custo 0.0123',
                source: 'agent',
                recordHistory: true,
                updateCurrent: false,
                focusMode: 'background',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Uso do modelo'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('tokens 10→4'));
        expect(println).not.toHaveBeenCalledWith(expect.stringMatching(/Uso do modelo[\s\S]*modelo gpt-5\.4/u));
        expect(println).not.toHaveBeenCalledWith(expect.stringMatching(/Uso do modelo[\s\S]*sem pedido premium/u));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('ask_user_continuation'));
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('classe='));
        expect(broadcastSse).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'gpt-5.4',
                premiumRequest: false,
                traceId: 'turn:turn-llm-usage-1',
                turnId: 'turn-llm-usage-1',
                source: 'agent/llm.usage',
            }),
        );
        expect(broadcastSse).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
        clearTerminalTurnMaterialization();
    });

    it('humaniza classe e motivo de llm.usage no detalhe técnico com divergência de modelo', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('llm.usage')?.[0]?.({
            model: 'gpt-5.4',
            configuredModel: 'gpt-5',
            effectiveModel: 'gpt-5.4',
            billedModel: 'gpt-5-mini',
            modelMismatch: true,
            cost: 0.0123,
            classification: 'ask_user_continuation',
            premiumRequest: false,
            premiumRequestReason: 'user_input_completed_continuation',
            inputTokens: 10,
            outputTokens: 4,
        });

        const output = println.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
        expect(output).toContain('classe continuação da pergunta humana');
        expect(output).toContain('motivo continuação após resposta humana');
        expect(output).not.toContain('ask_user_continuation');
        expect(output).not.toContain('user_input_completed_continuation');
    });

    it('narra boot recovery quando fallback com PR é bloqueado por política', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('dialog.boot_recovery')?.[0]?.({
            zeroPR: false,
            skippedPrFallback: true,
            reason: 'zero_pr_resume_failed',
            error: 'resume attach failed',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Boot recovery preservou zero-PR',
            expect.objectContaining({
                detail: expect.stringContaining('fallback PR bloqueado'),
                severity: 'warn',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('boot recovery sem fallback PR'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'dialog.boot_recovery',
            expect.objectContaining({ skippedPrFallback: true }),
        );
    });

    it('promove pr.fallback_model para aviso operacional explícito', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('pr.fallback_model')?.[0]?.({ from: 'gpt-5', to: 'gpt-5-mini' });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Fallback de modelo aplicado',
            expect.objectContaining({
                detail: expect.stringContaining('fallback aplicado: gpt-5 → gpt-5-mini · origem agente · 20'),
                severity: 'warn',
                source: 'agent',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Fallback modelo'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('fallback aplicado: gpt-5 → gpt-5-mini'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'pr.fallback_model',
            expect.objectContaining({
                from: 'gpt-5',
                to: 'gpt-5-mini',
                operatorSummary: expect.stringContaining('fallback aplicado: gpt-5 → gpt-5-mini'),
            }),
        );
    });

    it('explica erro recuperável de model_call como evento operacional de modelo', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('error')?.[0]?.({
            hookType: 'errorOccurred',
            errorContext: 'model_call',
            recoverable: true,
            errorMessage: 'Erro do SDK sem mensagem estruturada.',
        });
        listeners.get('error')?.[0]?.({
            hookType: 'errorOccurred',
            errorContext: 'model_call',
            recoverable: true,
            errorMessage: 'Erro do SDK sem mensagem estruturada.',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro recuperável de modelo SDK',
            expect.objectContaining({
                severity: 'warn',
                detail: expect.stringContaining('auto é a única recuperação permitida'),
                recordHistory: true,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro recuperável de modelo SDK',
            expect.objectContaining({
                severity: 'warn',
                detail: expect.not.stringContaining('fallback=auto'),
                recordHistory: false,
            }),
        );
        expect(println.mock.calls.filter(([line]) => String(line).includes('Modelo'))).toHaveLength(1);
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                errorContext: 'model_call',
                recoverable: true,
                operatorMeaning: expect.stringContaining('sem pedido premium confirmado'),
                handledAs: 'recoverable_model_call',
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                errorContext: 'model_call',
                recoverable: true,
                suppressedDuplicate: true,
            }),
        );
    });

    it('explica erro recuperável de model_call BYOK sem sugerir fallback Copilot auto', async () => {
        const { beginTerminalTurnMaterialization, readTerminalTurnMaterialization, clearTerminalTurnMaterialization } =
            await import('../../../src/copilot/terminal/state/turn-materialization-state.js');
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'byok-turn-1', source: 'sdk/assistant.turn_start' });
        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('error')?.[0]?.({
            hookType: 'errorOccurred',
            errorContext: 'model_call',
            recoverable: true,
            errorMessage: 'Provider returned 403',
            byokEnabled: true,
            byokProviderType: 'gemini',
            byokProfile: 'gemini-free',
            byokModel: 'gemini-2.5-flash',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                severity: 'warn',
                detail: expect.stringContaining('fallback para Copilot auto bloqueado por contrato'),
                recordHistory: true,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                detail: expect.not.stringContaining('auto é a única recuperação permitida'),
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                detail: expect.stringContaining('provedor gemini'),
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK',
            expect.objectContaining({
                detail: expect.not.stringContaining('provider='),
            }),
        );
        const rendered = println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(rendered).toContain('BYOK');
        expect(rendered).toContain('Ação');
        expect(rendered).toContain('/byok use');
        expect(rendered).toContain('/byok model');
        expect(rendered).toContain('Recuperação');
        expect(rendered).toContain('provedor gemini · perfil gemini-free · modelo gemini-2.5-flash');
        expect(rendered).not.toContain('Modelo       Provider returned 403 · erro de provider BYOK');
        expect(rendered).not.toContain('retry automático bloqueado para não prender o terminal; troque provider/modelo');
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                byokEnabled: true,
                byokProviderType: 'gemini',
                operatorMeaning: expect.stringContaining('sem pedido premium'),
                handledAs: 'recoverable_model_call',
            }),
        );
        expect(readTerminalTurnMaterialization()).toBeNull();
        expect(completeTerminalTurnTrace).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
            }),
        );
        clearTerminalTurnMaterialization();
    });

    it('classifica session.error query em BYOK como falha de provider e revisa o turno tardio', async () => {
        const { clearTerminalTurnMaterialization } =
            await import('../../../src/copilot/terminal/state/turn-materialization-state.js');
        const { clearByokProviderModelHealth, readByokProviderModelHealth } =
            await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        clearTerminalTurnMaterialization();
        clearByokProviderModelHealth();
        readConfiguredByokSummary.mockReturnValue({
            enabled: true,
            ready: true,
            profile: 'mistral-free',
            preset: 'mistral',
            providerType: 'openai',
            model: 'codestral-latest',
        });
        reviseRecentTerminalTurnTraceStatus.mockReturnValue({ traceId: 'turn:0', status: 'failed' });

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('session.error')?.[0]?.({
            errorType: 'query',
            message:
                'Failed to get response from the AI model; retried 5 times (total retry wait time: 6.55 seconds) Last error: Unknown error',
        });

        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro de sessão BYOK',
            expect.objectContaining({
                severity: 'error',
                detail: expect.stringContaining('sem pedido premium'),
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro de sessão BYOK',
            expect.objectContaining({
                detail: expect.stringContaining('Erro de consulta:'),
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro de sessão BYOK',
            expect.objectContaining({
                detail: expect.not.stringContaining('[query]'),
            }),
        );
        expect(reviseRecentTerminalTurnTraceStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
            }),
        );
        expect(completeTerminalTurnTrace).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(
            readByokProviderModelHealth({
                routeProfile: 'mistral-free',
                providerId: 'mistral',
                providerModel: 'codestral-latest',
            }),
        ).toEqual(
            expect.objectContaining({
                lastStatus: 'failed',
                lastErrorContext: 'session.query',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('BYOK'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'session.error',
            expect.objectContaining({
                byokProvider: true,
                byokProfile: 'mistral-free',
                byokProviderType: 'mistral',
                byokModel: 'codestral-latest',
                handledAs: 'byok_session_error',
            }),
        );
        clearByokProviderModelHealth();
    });

    it('reanuncia pergunta pendente viva ao registrar listeners do terminal', async () => {
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: {
                    question: 'Qual arquivo devo revisar agora?',
                    choices: ['A', 'B'],
                },
                pendingQuestionKind: 'question',
            }),
        );
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('Pergunta ao operador'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('pergunta restaurada'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Qual arquivo devo revisar agora?'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Opções'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[1] A   [2] B'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Atalhos'));
        expect(rl.pause).toHaveBeenCalled();
        expect(rl.resume).toHaveBeenCalled();
        expect(rl.setPrompt).toHaveBeenCalledWith('prompt> ');
        expect(rl.prompt).toHaveBeenCalled();
    });

    it('deduplica pergunta pendente reanunciada imediatamente por replay e evento', async () => {
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: {
                    question: 'Qual arquivo devo revisar agora?',
                    choices: ['A', 'B'],
                },
                pendingQuestionKind: 'question',
            }),
        );
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });
        listeners.get('question.pending')?.[0]?.({
            question: 'Qual arquivo devo revisar agora?',
            choices: ['A', 'B'],
        });

        const output = println.mock.calls.map(([line]) => String(line)).join('\n');
        expect((output.match(/Qual arquivo devo revisar agora\?/gu) ?? []).length).toBe(1);
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Pergunta ao operador'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('pergunta restaurada'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Qual arquivo devo revisar agora?'));
    });

    it('não reanuncia protocolo READY como pergunta visível', async () => {
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: {
                    question: 'READY: aguardando próxima mensagem',
                    choices: [],
                },
                pendingQuestionKind: 'ready',
            }),
        );
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn(),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });

        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('READY: aguardando próxima mensagem'));
        expect(rl.pause).not.toHaveBeenCalled();
        expect(recordTerminalActivity).not.toHaveBeenCalledWith(
            'question',
            expect.any(String),
            expect.objectContaining({ detail: expect.stringContaining('READY: aguardando próxima mensagem') }),
        );
    });

    it('reanuncia pergunta pendente mesmo sem kind explícito em snapshot legado', async () => {
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: {
                    question: 'Você confirma aplicar o patch mínimo?',
                    choices: ['sim', 'não'],
                },
                pendingQuestionKind: null,
            }),
        );
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const rl = {
            pause: vi.fn(),
            resume: vi.fn(),
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };
        const agent = {
            on: vi.fn(),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: /** @type {any} */ (rl) });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('Pergunta ao operador'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('pergunta restaurada'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Você confirma aplicar o patch mínimo?'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Opções'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[1] sim   [2] não'));
        expect(rl.pause).toHaveBeenCalled();
        expect(rl.resume).toHaveBeenCalled();
    });

    it('mantém falha BYOK recuperável fora do ErrorTracker e preserva painel/SSE', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on: vi.fn((event, handler) => {
                const list = listeners.get(event) ?? [];
                list.push(handler);
                listeners.set(event, list);
            }),
            off: vi.fn(),
        };

        setupTerminalAgentRuntimeEventListeners({ agent: /** @type {any} */ (agent), rl: null });
        listeners.get('error')?.[0]?.({
            hookType: 'errorOccurred',
            errorContext: 'model_call',
            recoverable: true,
            errorMessage: 'Erro do SDK sem mensagem estruturada.',
            byokEnabled: true,
            byokProviderType: 'openai',
            byokProfile: 'kilo',
            byokModel: 'kilo-auto/free',
        });

        expect(defaultErrorTracker.trackError).not.toHaveBeenCalled();
        expect(println).toHaveBeenCalledWith(expect.stringContaining('falha do provedor'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                errorContext: 'model_call',
                recoverable: true,
                byokProviderType: 'openai',
                byokProfile: 'kilo',
                byokModel: 'kilo-auto/free',
                handledAs: 'recoverable_model_call',
            }),
        );
    });
});
