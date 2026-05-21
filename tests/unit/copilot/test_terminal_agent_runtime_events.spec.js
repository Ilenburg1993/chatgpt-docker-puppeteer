// @ts-check
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
const scheduleTerminalPromptRedraw = vi.fn((/** @type {any} */ rl, /** @type {string} */ prompt) => {
    rl?.setPrompt?.(prompt);
    rl?.prompt?.();
});
const writeInlineStatus = vi.fn();
const recordTerminalActivity = vi.fn();
const getShowToolActivity = vi.fn(() => true);
const getShowUsage = vi.fn(() => true);
const getShowStreaming = vi.fn(() => true);
const getShowIntentActivity = vi.fn(() => true);
const getShowSessionActivity = vi.fn(() => false);
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
const readConfiguredByokSummary = vi.fn(() => ({ enabled: false }));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    SEPARATOR: '---',
    println,
    printlnBlock,
    buildUserPrompt,
    broadcastSse,
    isTerminalRenderLocked,
    scheduleTerminalPromptRedraw,
    writeInlineStatus,
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    getShowToolActivity,
    getShowUsage,
    getShowStreaming,
    getShowIntentActivity,
    getShowSessionActivity,
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
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalAgentRuntimeEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        expect(typeof mod.setupTerminalAgentRuntimeEventListeners).toBe('function');
    });

    it('apresenta tools de arquivo com alvo e operação durante streaming', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } = await import(
            '../../../src/copilot/terminal/state/turn-materialization-state.js'
        );
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
            'Executando tool',
            expect.objectContaining({
                detail: 'lendo arquivo · arquivo: src/copilot/terminal/repl/repl.js',
                toolName: 'workspace.read_file',
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
            'question.pending reconciliado pelo ask_user SDK',
            expect.objectContaining({ detail: expect.stringContaining('Confirme se deseja abrir') }),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('LLM-B perguntou'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('abrindo arquivo grande'));
        expect(writeInlineStatus).toHaveBeenCalledWith(expect.stringContaining('workspace.read_file'));
        expect(writeInlineStatus).toHaveBeenCalledWith(expect.stringContaining('abrindo arquivo grande'));
    });

    it('mantém heartbeat de tool longa visível no histórico mesmo em modo compact', async () => {
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

        expect(println).toHaveBeenCalledWith(expect.stringContaining('ainda executando · 10s · tool-long-compact'));
        expect(writeInlineStatus).toHaveBeenCalledWith(
            expect.stringContaining('ainda executando · 10s · tool-long-compact'),
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
        expect(println.mock.calls.filter(([line]) => String(line).includes('read_file_content'))).toHaveLength(1);
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
            'Executando tool',
            expect.objectContaining({
                toolName: 'patch_file',
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

        expect(printlnBlock).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('INTENT')]));
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
        const { __test__: terminalIntentRendererTestHarness } = await import(
            '../../../src/copilot/terminal/events/intent-renderer.js'
        );
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
            'question.pending reconciliado pelo ask_user SDK',
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
            'Executando tool',
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
            'Tool em andamento',
            expect.objectContaining({
                toolName: 'exec_command',
                detail: expect.stringContaining('10s ativos'),
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('ainda executando · 10s · bash-long'));

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
            'Agente em background concluído',
            expect.objectContaining({ detail: 'investigar sessão SDK · status=completed', source: 'agent' }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Shell concluído',
            expect.objectContaining({ detail: 'npm run lint:copilot · exit=0', source: 'agent' }),
        );
        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('Background agent concluído: investigar sessão SDK'),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Shell concluído: npm run lint:copilot · exit=0'));
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
            'Tarefa interna concluída',
            expect.objectContaining({
                detail: 'Persist latest PR consumption snapshot · status=completed',
                recordHistory: false,
                updateCurrent: false,
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
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } = await import(
            '../../../src/copilot/terminal/state/turn-materialization-state.js'
        );
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
            'Premium Request classificada com divergência de modelo',
            expect.objectContaining({
                detail: 'modeloCfg=gpt-5 · modeloEfetivo=gpt-5-mini · modeloCobrado=gpt-5-mini · custo=0.0123',
                severity: 'warn',
                source: 'agent',
                recordHistory: true,
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('PR'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('modeloCobrado=gpt-5-mini'));
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
            'Premium Request classificada com divergência de modelo',
            expect.any(Object),
        );
        expect(println).not.toHaveBeenCalledWith(expect.stringContaining('PR'));
        expect(broadcastSse).toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });

    it('narra llm.usage sem Premium Request separadamente de pr.consumed', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/events/agent-runtime-events.js');
        const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } = await import(
            '../../../src/copilot/terminal/state/turn-materialization-state.js'
        );
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
            'Telemetria LLM sem Premium Request',
            expect.objectContaining({
                detail: 'modelo=gpt-5.4 · custo=0.0123 · classe=ask_user_continuation · motivo=user_input_completed_continuation · tokens=10→4',
                source: 'agent',
                recordHistory: true,
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('LLM'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('ask_user_continuation'));
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
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Boot recovery sem fallback PR'));
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
                detail: 'gpt-5 → gpt-5-mini',
                severity: 'warn',
                source: 'agent',
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('Fallback de modelo: gpt-5 → gpt-5-mini'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'pr.fallback_model',
            expect.objectContaining({ from: 'gpt-5', to: 'gpt-5-mini' }),
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
        expect(println.mock.calls.filter(([line]) => String(line).includes('MODEL'))).toHaveLength(1);
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                errorContext: 'model_call',
                recoverable: true,
                operatorMeaning: expect.stringContaining('sem Premium Request confirmada'),
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
        const { beginTerminalTurnMaterialization, readTerminalTurnMaterialization, clearTerminalTurnMaterialization } = await import(
            '../../../src/copilot/terminal/state/turn-materialization-state.js'
        );
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
            'Erro de provider BYOK',
            expect.objectContaining({
                severity: 'warn',
                detail: expect.stringContaining('fallback para Copilot auto bloqueado por contrato'),
                recordHistory: true,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Erro de provider BYOK',
            expect.objectContaining({
                detail: expect.not.stringContaining('auto é a única recuperação permitida'),
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.error',
            expect.objectContaining({
                byokEnabled: true,
                byokProviderType: 'gemini',
                operatorMeaning: expect.stringContaining('sem Premium Request'),
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
        const { clearTerminalTurnMaterialization } = await import(
            '../../../src/copilot/terminal/state/turn-materialization-state.js'
        );
        const { clearByokProviderModelHealth, readByokProviderModelHealth } = await import(
            '../../../src/copilot/terminal/state/byok-provider-health.js'
        );
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
                detail: expect.stringContaining('sem Premium Request'),
            }),
        );
        expect(reviseRecentTerminalTurnTraceStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
            }),
        );
        expect(completeTerminalTurnTrace).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(readByokProviderModelHealth({ profile: 'mistral-free', provider: 'mistral', model: 'codestral-latest' })).toEqual(
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

        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('LLM-B perguntou: "Qual arquivo devo revisar agora?"'),
        );
        expect(
            println.mock.calls.some(([line]) => String(line).includes('OPTIONS') && String(line).includes('A | B')),
        ).toBe(true);
        expect(println).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[1] A   [2] B'));
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

        expect(println).toHaveBeenCalledTimes(5);
        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('LLM-B perguntou: "Qual arquivo devo revisar agora?"'),
        );
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

        expect(println).toHaveBeenCalledWith(
            expect.stringContaining('LLM-B perguntou: "Você confirma aplicar o patch mínimo?"'),
        );
        expect(
            println.mock.calls.some(([line]) => String(line).includes('OPTIONS') && String(line).includes('sim | não')),
        ).toBe(true);
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[1] sim   [2] não'));
        expect(rl.pause).toHaveBeenCalled();
        expect(rl.resume).toHaveBeenCalled();
    });
});
