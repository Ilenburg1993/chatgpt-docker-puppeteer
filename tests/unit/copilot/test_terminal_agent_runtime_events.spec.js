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
const writeInlineStatus = vi.fn();
const recordTerminalActivity = vi.fn();
const getShowToolActivity = vi.fn(() => true);
const getShowStreaming = vi.fn(() => true);
const getShowIntentActivity = vi.fn(() => true);
const readTerminalRuntimeState = vi.fn(
    () =>
        /** @type {any} */ ({
            pendingQuestion: null,
            pendingQuestionKind: null,
        }),
);
const recordTerminalTurnToolActivity = vi.fn();
const completeTerminalTurnToolCall = vi.fn();
const getTerminalDetailLevel = vi.fn(() => 'detailed');
const recordToolCall = vi.fn();

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    SEPARATOR: '---',
    println,
    printlnBlock,
    buildUserPrompt,
    broadcastSse,
    writeInlineStatus,
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    getShowToolActivity,
    getShowStreaming,
    getShowIntentActivity,
}));

vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalRuntimeState,
}));

vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    recordTerminalTurnToolActivity,
    completeTerminalTurnToolCall,
}));

vi.mock('../../../src/copilot/observability/index.js', () => ({
    recordToolCall,
}));

vi.mock('../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel,
}));

describe('terminal/events/agent-runtime-events.js — contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        getTerminalDetailLevel.mockReturnValue('detailed');
        printlnBlock.mockImplementation((/** @type {string[]} */ lines) => println(lines.join('\n')));
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: null,
                pendingQuestionKind: null,
            }),
        );
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
            }),
        );
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

        expect(println).toHaveBeenCalledWith(expect.stringContaining('ASK'));
        expect(println).toHaveBeenCalledWith(expect.stringContaining('PICK'));
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
        expect(println).toHaveBeenCalledWith(expect.stringContaining('LLM-B perguntou: "Confirmar operação?"'));
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
            expect.objectContaining({ agentId: 'bg-1', status: 'completed' }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'agent.shell.completed',
            expect.objectContaining({ shellId: 'shell-1', exitCode: 0 }),
        );
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
