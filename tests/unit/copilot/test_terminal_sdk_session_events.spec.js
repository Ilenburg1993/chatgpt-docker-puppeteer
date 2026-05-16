// @ts-check
/**
 * tests/unit/copilot/test_terminal_sdk_session_events.spec.js
 *
 * Contrato: terminal/events/sdk-session-events.js
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    broadcastSse: vi.fn(),
    println: vi.fn(),
    setLastSdkPlanOperation: vi.fn(),
    setSdkSessionMode: vi.fn(),
    getBusy: vi.fn(() => false),
    getShowSessionActivity: vi.fn(() => false),
    consumeRuntimeInterventionMailbox: /** @type {any} */ (vi.fn(() => null)),
    enqueueRuntimeInterventionMailbox: vi.fn(),
    readRuntimeInterventionMailboxSummary: vi.fn(() => ({ queueSize: 0, dropped: 0, runtimeId: 'default' })),
    answerTerminalPendingQuestion: vi.fn(() => true),
    beginTerminalTurnTrace: vi.fn(),
    completeTerminalTurnTrace: vi.fn(),
    recordTerminalTurnFileActivity: vi.fn(),
    recordTerminalTurnToolActivity: vi.fn(),
    getTerminalDetailLevel: vi.fn(() => 'detailed'),
    recordTerminalUserInputRequested: vi.fn((evt) => ({
        id: evt?.requestId ?? 'ui-1',
        question: evt?.question ?? '(sem pergunta)',
        kind: 'question',
    })),
    recordTerminalUserInputCompleted: vi.fn(() => null),
    renderTerminalAssistantTranscript: vi.fn(() => true),
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity: mocks.recordTerminalActivity,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse: mocks.broadcastSse,
    println: mocks.println,
}));

vi.mock('../../../src/copilot/presentation/state/index.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        setLastSdkPlanOperation: mocks.setLastSdkPlanOperation,
        setSdkSessionMode: mocks.setSdkSessionMode,
        getBusy: mocks.getBusy,
        getShowSessionActivity: mocks.getShowSessionActivity,
        consumeRuntimeInterventionMailbox: mocks.consumeRuntimeInterventionMailbox,
        enqueueRuntimeInterventionMailbox: mocks.enqueueRuntimeInterventionMailbox,
        readRuntimeInterventionMailboxSummary: mocks.readRuntimeInterventionMailboxSummary,
    };
});

vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    answerTerminalPendingQuestion: mocks.answerTerminalPendingQuestion,
}));

vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    beginTerminalTurnTrace: mocks.beginTerminalTurnTrace,
    completeTerminalTurnTrace: mocks.completeTerminalTurnTrace,
    recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity: mocks.recordTerminalTurnToolActivity,
}));

vi.mock('../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel: mocks.getTerminalDetailLevel,
}));

vi.mock('../../../src/copilot/terminal/state/sdk-interactions.js', async () => {
    const actual = await vi.importActual('../../../src/copilot/terminal/state/sdk-interactions.js');
    return {
        ...actual,
        recordTerminalUserInputRequested: mocks.recordTerminalUserInputRequested,
        recordTerminalUserInputCompleted: mocks.recordTerminalUserInputCompleted,
    };
});

vi.mock('../../../src/copilot/terminal/events/assistant-transcript-renderer.js', () => ({
    renderTerminalAssistantTranscript: mocks.renderTerminalAssistantTranscript,
}));

function createAgentHost() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();

    return {
        on(/** @type {string} */ event, /** @type {(...args: any[]) => void} */ handler) {
            const arr = listeners.get(event) ?? [];
            arr.push(handler);
            listeners.set(event, arr);
        },
        off(/** @type {string} */ event, /** @type {(...args: any[]) => void} */ handler) {
            const arr = listeners.get(event) ?? [];
            const index = arr.indexOf(handler);
            if (index >= 0) arr.splice(index, 1);
            listeners.set(event, arr);
        },
        emit(/** @type {string} */ event, /** @type {unknown} */ payload) {
            for (const handler of listeners.get(event) ?? []) handler(payload);
        },
        count(/** @type {string} */ event) {
            return (listeners.get(event) ?? []).length;
        },
    };
}

describe('terminal/events/sdk-session-events.js — contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getBusy.mockReturnValue(false);
        mocks.getShowSessionActivity.mockReturnValue(false);
        mocks.getTerminalDetailLevel.mockReturnValue('detailed');
        mocks.completeTerminalTurnTrace.mockReturnValue(null);
        mocks.consumeRuntimeInterventionMailbox.mockReturnValue(null);
        mocks.enqueueRuntimeInterventionMailbox.mockReturnValue({
            enqueued: true,
            merged: false,
            runtimeId: 'default',
            queueSize: 1,
            dropped: 0,
            entryId: 'iv-requeued',
        });
        mocks.readRuntimeInterventionMailboxSummary.mockReturnValue({ queueSize: 0, dropped: 0, runtimeId: 'default' });
        mocks.answerTerminalPendingQuestion.mockReturnValue(true);
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalSdkSessionEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        expect(typeof mod.setupTerminalSdkSessionEventListeners).toBe('function');
    });

    it('reflete session.mode_changed no estado e no SSE vanilla', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('session.mode_changed', { previousMode: 'interactive', newMode: 'plan' });

        expect(mocks.setSdkSessionMode).toHaveBeenCalledWith('plan');
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Modo SDK alterado',
            expect.objectContaining({ detail: 'interactive → plan', source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.mode_changed',
            expect.objectContaining({ previousMode: 'interactive', newMode: 'plan' }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Modo SDK: interactive → plan'));
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('persiste assistant.message fora de turno ativo e normaliza protocolo REPLY', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('assistant.message', { content: 'REPLY: resposta visível' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'turn',
            'Mensagem da LLM-B recebida',
            expect.objectContaining({ detail: expect.stringContaining('reply'), source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.message',
            expect.objectContaining({ content: 'resposta visível', protocolKind: 'reply' }),
        );
        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'resposta visível',
                source: 'sdk/assistant.message',
                detail: 'reply',
            }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('não duplica assistant.message enquanto um turno ativo já controla o render', async () => {
        mocks.getBusy.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('assistant.message', { content: 'mensagem do turno ativo' });

        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.message',
            expect.objectContaining({ content: 'mensagem do turno ativo', protocolKind: 'question' }),
        );
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
    });

    it('mantém session.model_changed silencioso por default e só narra em modo verbose', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.model_changed', { previousModel: 'auto', newModel: 'gpt-5.4', reasoningEffort: 'high' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Modelo SDK alterado',
            expect.objectContaining({ detail: 'auto → gpt-5.4 · high' }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Modelo SDK: auto → gpt-5.4'));

        mocks.println.mockClear();
        mocks.getShowSessionActivity.mockReturnValue(true);
        agent.emit('session.model_changed', { previousModel: 'gpt-5.4', newModel: 'gpt-5.5', reasoningEffort: 'high' });

        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Modelo SDK: gpt-5.4 → gpt-5.5'));
    });

    it('surfa workspace_file_changed e assistant.turn_start/end para a UX local', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        mocks.completeTerminalTurnTrace.mockReturnValue({
            traceId: 'turn:turn-1',
            turnId: 'turn-1',
            source: 'assistant',
            status: 'completed',
            startedAt: 1,
            updatedAt: 2,
            finishedAt: 3,
            toolCount: 1,
            fileCount: 1,
            tools: [
                {
                    toolName: 'workspace.read_file',
                    operation: 'read',
                    path: 'files/plan.md',
                    target: 'files/plan.md',
                    source: 'sdk',
                    status: 'completed',
                    success: true,
                    count: 1,
                    updatedAt: 2,
                },
            ],
            files: [
                {
                    path: 'files/plan.md',
                    operation: 'edit',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 2,
                },
            ],
        });

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('assistant.turn_start', { turnId: 'turn-1' });
        agent.emit('session.workspace_file_changed', { operation: 'update', path: 'files/plan.md' });
        agent.emit('assistant.turn_end', { turnId: 'turn-1' });

        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.turn_start',
            expect.objectContaining({ turnId: 'turn-1' }),
        );
        expect(mocks.beginTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.completeTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.recordTerminalTurnFileActivity).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'files/plan.md', operation: 'edit', source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.workspace_file_changed',
            expect.objectContaining({ operation: 'update', path: 'files/plan.md' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.turn_end',
            expect.objectContaining({ turnId: 'turn-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Workspace da sessão alterado',
            expect.objectContaining({ detail: 'update · files/plan.md' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('TURN'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('workspace.read_file'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('files/plan.md'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Workspace file update: files/plan.md'));
    });

    it('surfa elicitation, permission e sidechannel SDK como narrativa operacional', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('elicitation.pending', {
            requestId: 'el-1',
            message: 'Informe a branch de destino',
            mode: 'form',
            actionable: true,
        });
        agent.emit('permission.requested', {
            requestId: 'perm-1',
            permissionType: 'file_write',
        });
        agent.emit('permission.mode_changed', {
            mode: 'audit_only',
        });
        agent.emit('user_input.requested', {
            requestId: 'ui-1',
            question: 'Escolha?',
            choices: ['A', 'B'],
            allowFreeform: false,
        });
        agent.emit('user_input.completed', {
            requestId: 'ui-1',
            answer: 'B',
            wasFreeform: false,
        });
        agent.emit('tool.user_requested', {
            toolName: 'workspace.write',
            requestId: 'tool-1',
        });
        agent.emit('mcp.oauth.required', {
            serverName: 'github',
            requestId: 'oauth-1',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Elicitation SDK pendente',
            expect.objectContaining({ severity: 'warn', source: 'sdk' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Permissão SDK solicitada',
            expect.objectContaining({ detail: 'file_write · perm-1', severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Modo de permissão alterado',
            expect.objectContaining({ detail: 'audit_only', source: 'sdk' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'ask_user SDK solicitado',
            expect.objectContaining({ detail: expect.stringContaining('Escolha?'), severity: 'warn' }),
        );
        expect(mocks.recordTerminalUserInputRequested).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'ui-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'ask_user SDK respondido',
            expect.objectContaining({ detail: 'ui-1 · choice/protocolo' }),
        );
        expect(mocks.recordTerminalUserInputCompleted).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'ui-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Tool solicitou ação do usuário',
            expect.objectContaining({ toolName: 'workspace.write', severity: 'warn' }),
        );
        expect(mocks.recordTerminalTurnToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'workspace.write',
                operation: 'run',
                status: 'user_requested',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'elicitation.pending',
            expect.objectContaining({ id: 'el-1', message: 'Informe a branch de destino' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.requested',
            expect.objectContaining({ id: 'perm-1', permissionType: 'file_write' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.mode_changed',
            expect.objectContaining({ mode: 'audit_only' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({ requestId: 'ui-1', allowFreeform: false }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.completed',
            expect.objectContaining({ requestId: 'ui-1', answer: 'B', wasFreeform: false }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'user_requested',
                toolName: 'workspace.write',
                requestId: 'tool-1',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'mcp.oauth.required',
            expect.objectContaining({ serverName: 'github', requestId: 'oauth-1' }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('suprime READY/REPLY protocolar de ask_user da narrativa terminal', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        mocks.recordTerminalActivity.mockClear();
        mocks.broadcastSse.mockClear();
        refreshPromptIfIdle.mockClear();
        agent.emit('user_input.requested', {
            requestId: 'proto-1',
            question: 'READY: aguardando próxima mensagem',
            allowFreeform: true,
        });
        agent.emit('user_input.completed', {
            requestId: 'proto-1',
            answer: 'CONTINUE_DIALOG_LOOP',
            wasFreeform: false,
        });

        expect(mocks.recordTerminalActivity).not.toHaveBeenCalled();
        expect(mocks.broadcastSse).not.toHaveBeenCalled();
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('drena mailbox zero-PR em ask_user humano e responde sem session.send', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();
        mocks.consumeRuntimeInterventionMailbox.mockReturnValueOnce({
            id: 'iv-1',
            ts: Date.now(),
            runtimeId: 'default',
            source: 'llm-a',
            modeHint: 'queue',
            message: 'aplique esta intervenção sem PR',
            mergedCount: 0,
        });
        mocks.readRuntimeInterventionMailboxSummary.mockReturnValueOnce({
            queueSize: 0,
            dropped: 0,
            runtimeId: 'default',
        });

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('user_input.requested', {
            requestId: 'ui-mailbox',
            question: 'Pode confirmar?',
            allowFreeform: true,
        });

        expect(mocks.consumeRuntimeInterventionMailbox).toHaveBeenCalledWith(null);
        expect(mocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('aplique esta intervenção sem PR', null);
        expect(mocks.enqueueRuntimeInterventionMailbox).not.toHaveBeenCalled();
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'intervention.mailbox.applied',
            expect.objectContaining({ entryId: 'iv-1', source: 'llm-a', modeHint: 'queue', queueSize: 0 }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('recoloca entrada no mailbox quando a resposta zero-PR não pode ser aplicada', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        mocks.answerTerminalPendingQuestion.mockReturnValueOnce(false);
        mocks.consumeRuntimeInterventionMailbox.mockReturnValueOnce({
            id: 'iv-2',
            ts: Date.now(),
            runtimeId: 'default',
            source: 'terminal',
            modeHint: 'interrupt',
            message: 'não perder esta substituição',
            mergedCount: 1,
        });

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('user_input.requested', {
            requestId: 'ui-requeue',
            question: 'Pergunta real?',
            allowFreeform: true,
            runtimeId: 'default',
        });

        expect(mocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('não perder esta substituição', 'default');
        expect(mocks.enqueueRuntimeInterventionMailbox).toHaveBeenCalledWith({
            runtimeId: 'default',
            source: 'terminal',
            modeHint: 'interrupt',
            message: 'não perder esta substituição',
        });
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Mailbox zero-PR não aplicado (requeued)',
            expect.objectContaining({ severity: 'warn', source: 'sdk' }),
        );
    });

    it('surfa loaded/background SDK events para atividade e SSE', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.skills_loaded', { count: 3, enabled: 2 });
        agent.emit('session.tools_updated', { count: 92 });
        agent.emit('session.background_tasks_changed', { count: 4 });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Skills SDK carregadas',
            expect.objectContaining({ detail: '2/3 habilitada(s)', recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Tools dinâmicas SDK atualizadas',
            expect.objectContaining({
                detail: '92 tool(s) reportada(s) pelo evento SDK; registry local segue em /tools',
                recordHistory: false,
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Background tasks SDK alteradas',
            expect.objectContaining({ detail: '4 pendente(s)', severity: 'warn' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.skills_loaded',
            expect.objectContaining({ count: 3, enabled: 2 }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.background_tasks_changed',
            expect.objectContaining({ count: 4 }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Skills SDK'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Tools dinâmicas SDK atualizadas'));
    });

    it('mostra narrativa verbose de sessão quando o toggle session está ativo', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.skills_loaded', { count: 3, enabled: 2 });
        agent.emit('session.tools_updated', { count: 92 });

        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Skills SDK: 2/3 habilitadas'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Tools dinâmicas SDK atualizadas: 92'));
    });

    it('cleanup remove listeners vanilla registrados', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const dispose = setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });

        expect(agent.count('session.mode_changed')).toBeGreaterThan(0);
        expect(agent.count('session.workspace_file_changed')).toBeGreaterThan(0);
        expect(agent.count('elicitation.pending')).toBeGreaterThan(0);
        expect(agent.count('permission.requested')).toBeGreaterThan(0);
        expect(agent.count('permission.mode_changed')).toBeGreaterThan(0);
        expect(agent.count('user_input.requested')).toBeGreaterThan(0);
        expect(agent.count('session.skills_loaded')).toBeGreaterThan(0);
        dispose();
        expect(agent.count('session.mode_changed')).toBe(0);
        expect(agent.count('session.workspace_file_changed')).toBe(0);
        expect(agent.count('elicitation.pending')).toBe(0);
        expect(agent.count('permission.requested')).toBe(0);
        expect(agent.count('permission.mode_changed')).toBe(0);
        expect(agent.count('user_input.requested')).toBe(0);
        expect(agent.count('session.skills_loaded')).toBe(0);
    });
});
