// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
 *
 * Contrato: terminal/agent-runtime-events.js
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const println = vi.fn();
const buildUserPrompt = vi.fn(() => 'prompt> ');
const broadcastSse = vi.fn();
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

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    println,
    buildUserPrompt,
    broadcastSse,
}));

vi.mock('../../../src/copilot/terminal/activity-state.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    getShowToolActivity,
    getShowStreaming,
    getShowIntentActivity,
}));

vi.mock('../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => ({
    readTerminalRuntimeState,
}));

describe('terminal/agent-runtime-events.js — contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                pendingQuestion: null,
                pendingQuestionKind: null,
            }),
        );
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-runtime-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalAgentRuntimeEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-runtime-events.js');
        expect(typeof mod.setupTerminalAgentRuntimeEventListeners).toBe('function');
    });

    it('apresenta tools de arquivo com alvo e operação durante streaming', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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
            args: { path: 'src/copilot/terminal/repl.js' },
        });
        listeners.get('tool.execution_progress')?.[0]?.({
            toolCallId: 'tool-1',
            progressMessage: 'abrindo arquivo',
        });
        listeners.get('tool.execution_complete')?.[0]?.({
            toolCallId: 'tool-1',
            success: true,
        });

        expect(println).toHaveBeenCalledWith(expect.stringContaining('lendo arquivo: src/copilot/terminal/repl.js'));
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Executando tool',
            expect.objectContaining({
                detail: 'lendo arquivo · src/copilot/terminal/repl.js',
                toolName: 'workspace.read_file',
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.start',
            expect.objectContaining({
                toolName: 'workspace.read_file',
                operation: 'read',
                path: 'src/copilot/terminal/repl.js',
            }),
        );
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.complete',
            expect.objectContaining({
                operation: 'read',
                path: 'src/copilot/terminal/repl.js',
                success: true,
            }),
        );
    });

    it('funciona em modo headless sem readline e ainda emite SSE de tools', async () => {
        const { setupTerminalAgentRuntimeEventListeners } =
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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
            'tool.start',
            expect.objectContaining({ toolCallId: 'tool-headless', operation: 'write', path: 'tmp/live.md' }),
        );
        expect(println).toHaveBeenCalledWith('\n⚡ LLM-B perguntou: "Confirmar operação?"');
        expect(buildUserPrompt).not.toHaveBeenCalled();
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
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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

        expect(println).toHaveBeenCalledWith('\n⚡ LLM-B perguntou: "Qual arquivo devo revisar agora?"');
        expect(println).toHaveBeenCalledWith('   Opções: A | B');
        expect(println).toHaveBeenCalledWith('   Escolha rápida: 1) A    2) B');
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
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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
        expect(println).toHaveBeenCalledWith('\n⚡ LLM-B perguntou: "Qual arquivo devo revisar agora?"');
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
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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
            await import('../../../src/copilot/terminal/agent-runtime-events.js');
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

        expect(println).toHaveBeenCalledWith('\n⚡ LLM-B perguntou: "Você confirma aplicar o patch mínimo?"');
        expect(println).toHaveBeenCalledWith('   Opções: sim | não');
        expect(println).toHaveBeenCalledWith('   Escolha rápida: 1) sim    2) não');
        expect(rl.pause).toHaveBeenCalled();
        expect(rl.resume).toHaveBeenCalled();
    });
});
