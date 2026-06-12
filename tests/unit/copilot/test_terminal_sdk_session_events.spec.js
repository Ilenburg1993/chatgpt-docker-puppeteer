// @ts-check
/**
 * tests/unit/copilot/test_terminal_sdk_session_events.spec.js
 *
 * Contrato: terminal/events/sdk-session-events.js
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    recordTerminalTurnDelta,
} from '../../../src/copilot/terminal/state/turn-materialization-state.js';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    markTerminalActivityIdle: vi.fn(),
    observeTerminalModelChangeProjection: vi.fn(),
    broadcastSse: vi.fn(),
    println: vi.fn(),
    printlnBlock: vi.fn(),
    writeInlineStatus: vi.fn(),
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
    readTerminalTurnTraceProjection: vi.fn(() => ({ current: null, recent: [] })),
    recordTerminalTurnFileActivity: vi.fn(),
    recordTerminalTurnToolActivity: vi.fn(),
    recordTerminalTurnUserInputActivity: vi.fn(),
    getTerminalDetailLevel: vi.fn(() => 'detailed'),
    recordTerminalUserInputRequested: vi.fn((evt) => ({
        id: evt?.requestId ?? 'ui-1',
        question: evt?.question ?? '(sem pergunta)',
        kind: 'question',
    })),
    recordTerminalUserInputCompleted: vi.fn(() => null),
    shouldSuppressTerminalAssistantMessageAsUserInputEcho: vi.fn(() => false),
    renderTerminalAssistantTranscript: vi.fn(() => true),
    readSdkSessionHandoffRecords: vi.fn(() => Promise.resolve([])),
    writeSdkSessionConfirmationRecords: vi.fn(() => Promise.resolve({ sdkSessionConfirmations: 1 })),
    consumeTerminalLiveByokModelSwitchConfirmation: vi.fn(() => null),
    runtimePermissionMode: 'approve_all',
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    markTerminalActivityIdle: mocks.markTerminalActivityIdle,
    recordTerminalActivity: mocks.recordTerminalActivity,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    SEPARATOR: '---',
    broadcastSse: mocks.broadcastSse,
    println: mocks.println,
    printlnBlock: mocks.printlnBlock,
    writeInlineStatus: mocks.writeInlineStatus,
}));

vi.mock('../../../src/copilot/terminal/dialog/io/index.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        broadcastSse: mocks.broadcastSse,
        println: mocks.println,
        printlnBlock: mocks.printlnBlock,
        writeInlineStatus: mocks.writeInlineStatus,
    };
});

vi.mock('../../../src/copilot/terminal/state/events/index.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        markTerminalActivityIdle: mocks.markTerminalActivityIdle,
        recordTerminalActivity: mocks.recordTerminalActivity,
        recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
        recordTerminalTurnToolActivity: mocks.recordTerminalTurnToolActivity,
        recordTerminalTurnUserInputActivity: mocks.recordTerminalTurnUserInputActivity,
        recordTerminalUserInputCompleted: mocks.recordTerminalUserInputCompleted,
        recordTerminalUserInputRequested: mocks.recordTerminalUserInputRequested,
        shouldSuppressTerminalAssistantMessageAsUserInputEcho:
            mocks.shouldSuppressTerminalAssistantMessageAsUserInputEcho,
        beginTerminalTurnTrace: mocks.beginTerminalTurnTrace,
        completeTerminalTurnTrace: mocks.completeTerminalTurnTrace,
        readTerminalTurnTraceProjection: mocks.readTerminalTurnTraceProjection,
        getTerminalDetailLevel: mocks.getTerminalDetailLevel,
    };
});

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
    readTerminalRuntimePermissionMode: vi.fn(() => mocks.runtimePermissionMode),
    setTerminalRuntimePermissionMode: vi.fn((mode) => {
        mocks.runtimePermissionMode = mode;
        return mocks.runtimePermissionMode;
    }),
}));

vi.mock('../../../src/copilot/terminal/frontend/projections/index.js', () => ({
    observeTerminalModelChangeProjection: mocks.observeTerminalModelChangeProjection,
}));

vi.mock('#copilot/model-gateway', () => ({
    SqliteModelGatewayCatalogStore: vi.fn(function SqliteModelGatewayCatalogStore() {
        return {
            readSdkSessionHandoffRecords: mocks.readSdkSessionHandoffRecords,
            writeSdkSessionConfirmationRecords: mocks.writeSdkSessionConfirmationRecords,
        };
    }),
}));

vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    beginTerminalTurnTrace: mocks.beginTerminalTurnTrace,
    completeTerminalTurnTrace: mocks.completeTerminalTurnTrace,
    readTerminalTurnTraceProjection: mocks.readTerminalTurnTraceProjection,
    recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity: mocks.recordTerminalTurnToolActivity,
    recordTerminalTurnUserInputActivity: mocks.recordTerminalTurnUserInputActivity,
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
        shouldSuppressTerminalAssistantMessageAsUserInputEcho:
            mocks.shouldSuppressTerminalAssistantMessageAsUserInputEcho,
    };
});

vi.mock('../../../src/copilot/terminal/events/assistant-transcript-renderer.js', () => ({
    renderTerminalAssistantTranscript: mocks.renderTerminalAssistantTranscript,
}));

vi.mock('../../../src/copilot/terminal/byok/live/index.js', () => ({
    consumeTerminalLiveByokModelSwitchConfirmation: mocks.consumeTerminalLiveByokModelSwitchConfirmation,
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
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.runtimePermissionMode = 'approve_all';
        const { setTerminalRuntimePermissionMode } =
            await import('../../../src/copilot/terminal/frontend/gateways/index.js');
        setTerminalRuntimePermissionMode('approve_all');
        mocks.printlnBlock.mockImplementation((/** @type {string[]} */ lines) => mocks.println(lines.join('\n')));
        mocks.getBusy.mockReturnValue(false);
        mocks.getShowSessionActivity.mockReturnValue(false);
        mocks.getTerminalDetailLevel.mockReturnValue('detailed');
        mocks.shouldSuppressTerminalAssistantMessageAsUserInputEcho.mockReturnValue(false);
        mocks.completeTerminalTurnTrace.mockReturnValue(null);
        mocks.readTerminalTurnTraceProjection.mockReturnValue({ current: null, recent: [] });
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
        mocks.consumeTerminalLiveByokModelSwitchConfirmation.mockReturnValue(null);
        clearTerminalTurnMaterialization();
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalSdkSessionEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        expect(typeof mod.setupTerminalSdkSessionEventListeners).toBe('function');
    });

    it('humaniza cancelamento e aviso da sessão antes de renderizar no terminal', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.info', { infoType: 'cancellation', message: 'Operation cancelled by user' });
        agent.emit('session.warning', {
            warningType: 'rate_limit',
            message: 'Provider warning without Premium Request evidence',
        });

        const rendered = mocks.println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Cancelamento',
            expect.objectContaining({
                detail: 'operação cancelada pelo operador',
                source: 'sdk',
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Aviso da sessão · rate limit',
            expect.objectContaining({
                detail: 'provedor warning without pedido premium evidence',
                source: 'sdk',
                severity: 'warn',
            }),
        );
        expect(rendered).toContain('Cancelamento');
        expect(rendered).toContain('operação cancelada pelo operador');
        expect(rendered).toContain('Aviso sessão');
        expect(rendered).not.toContain('Warning SDK');
        expect(rendered).not.toContain('Operation cancelled by user');
        expect(rendered).not.toContain('Premium Request');
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
            expect.objectContaining({ detail: expect.stringContaining('Resposta'), source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.message',
            expect.objectContaining({ content: 'resposta visível', protocolKind: 'reply' }),
        );
        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'resposta visível',
                source: 'sdk/assistant.message',
                detail: 'Resposta',
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

    it('renderiza apenas o sufixo de assistant.message quando delta público já exibiu o prefixo', async () => {
        beginTerminalTurnMaterialization({ turnId: 'turn-prefix', timestamp: 1000, source: 'public-assistant-stream' });
        recordTerminalTurnDelta({
            chunk: 'Vou chamar ask_user ',
            source: 'public-assistant-stream',
            timestamp: 1001,
        });
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('assistant.message', {
            content: 'Vou chamar ask_user e aguardar sua resposta.',
            turnId: 'turn-prefix',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'streaming',
            'assistant.message completou delta público',
            expect.objectContaining({ detail: 'question · stream_suffix', source: 'sdk/assistant.message' }),
        );
        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Complemento da LLM-B',
                content: 'e aguardar sua resposta.',
                source: 'sdk/assistant.message',
                detail: 'stream_suffix',
            }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('renderiza assistant.message normal sem vazar rótulo técnico pós-pergunta', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('assistant.message', { content: 'Mensagem materializada fora do turno ativo.' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'turn',
            'Mensagem da LLM-B recebida',
            expect.objectContaining({ detail: expect.stringContaining('Resposta da LLM-B'), source: 'sdk' }),
        );
        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Resposta da LLM-B',
                content: 'Mensagem materializada fora do turno ativo.',
                source: 'sdk/assistant.message',
                detail: 'Resposta da LLM-B',
            }),
        );
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Resposta pós-pergunta' }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('suprime assistant.message que ecoa resposta humana recém-concluída de ask_user', async () => {
        mocks.shouldSuppressTerminalAssistantMessageAsUserInputEcho.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('assistant.message', { content: 'SIM' });

        expect(mocks.shouldSuppressTerminalAssistantMessageAsUserInputEcho).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'SIM' }),
        );
        expect(mocks.broadcastSse).not.toHaveBeenCalledWith('assistant.message', expect.anything());
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Eco de resposta humana suprimido',
            expect.objectContaining({ source: 'sdk/assistant.message' }),
        );
        expect(refreshPromptIfIdle).not.toHaveBeenCalled();
    });

    it('narra mudança efetiva de modelo por default e mantém confirmação redundante silenciosa', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.model_changed', { previousModel: 'auto', newModel: 'gpt-5.4', reasoningEffort: 'high' });
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.observeTerminalModelChangeProjection).toHaveBeenCalledWith({
            previousModel: 'auto',
            newModel: 'gpt-5.4',
            reasoningEffort: 'high',
        });
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'model',
            'Modelo SDK confirmado',
            expect.objectContaining({
                detail: expect.stringContaining('confirmado: auto → gpt-5.4 · raciocínio high · origem SDK · 20'),
                recordHistory: true,
                updateCurrent: true,
            }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Modelo SDK'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('confirmado: auto → gpt-5.4'));
        expect(mocks.writeSdkSessionConfirmationRecords).toHaveBeenCalledWith([
            expect.objectContaining({
                previousModel: 'auto',
                confirmedModel: 'gpt-5.4',
                reasoningEffort: 'high',
                status: 'observed',
                source: 'terminal-sdk-session-model-changed',
            }),
        ]);

        mocks.println.mockClear();
        agent.emit('session.model_changed', { previousModel: 'gpt-5.4', newModel: 'gpt-5.4', reasoningEffort: 'high' });

        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('gpt-5.4 → gpt-5.4'));

        mocks.getShowSessionActivity.mockReturnValue(true);
        agent.emit('session.model_changed', { previousModel: 'gpt-5.4', newModel: 'gpt-5.4', reasoningEffort: 'high' });

        expect(mocks.println).toHaveBeenCalledWith(
            expect.stringContaining('confirmado sem troca: gpt-5.4 (sem troca)'),
        );
    });

    it('narra confirmação SDK casada com pedido vivo de modelo BYOK', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        mocks.consumeTerminalLiveByokModelSwitchConfirmation.mockReturnValueOnce({
            model: 'anthropic/claude-sonnet-4.5',
            previousModel: 'kilo-auto/free',
            source: 'terminal.byok_model',
            reason: 'solicitação manual /byok model',
            confidence: 'catalog',
            requestedAt: Date.parse('2026-06-05T12:00:00.000Z'),
            detail: 'solicitado: kilo-auto/free → anthropic/claude-sonnet-4.5',
        });

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.model_changed', {
            previousModel: 'kilo-auto/free',
            newModel: 'anthropic/claude-sonnet-4.5',
            reasoningEffort: 'high',
        });

        const rendered = mocks.println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(rendered).toContain('Modelo confirmado');
        expect(rendered).toContain('confirmado: kilo-auto/free → anthropic/claude-sonnet-4.5');
        expect(rendered).toContain('raciocínio high');
        expect(rendered).toContain('solicitação manual /byok model');
        expect(rendered).toContain('confiança catalog');
        expect(rendered).not.toContain('session.model_changed');
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.model_changed',
            expect.objectContaining({
                matchedTerminalRequest: expect.objectContaining({
                    model: 'anthropic/claude-sonnet-4.5',
                    source: 'terminal.byok_model',
                    reason: 'solicitação manual /byok model',
                    confidence: 'catalog',
                    requestedAt: '2026-06-05T12:00:00.000Z',
                }),
            }),
        );
    });

    it('surfa workspace_file_changed e assistant.turn_start/end para a UX local', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const absolutePlanPath = `${process.cwd()}/files/plan.md`;
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
                    path: absolutePlanPath,
                    target: absolutePlanPath,
                    source: 'sdk',
                    status: 'completed',
                    success: true,
                    count: 1,
                    updatedAt: 2,
                },
            ],
            files: [
                {
                    path: absolutePlanPath,
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
            expect.objectContaining({
                turnId: 'turn-1',
                traceId: 'turn:turn-1',
                source: 'sdk/assistant.turn_start',
            }),
        );
        expect(mocks.beginTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.completeTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.recordTerminalTurnFileActivity).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'files/plan.md', operation: 'edit', source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.workspace_file_changed',
            expect.objectContaining({
                operation: 'update',
                path: 'files/plan.md',
                traceId: 'turn:turn-1',
                source: 'sdk/session.workspace_file_changed',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.turn_end',
            expect.objectContaining({
                turnId: 'turn-1',
                traceId: 'turn:turn-1',
                source: 'sdk/assistant.turn_end',
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Workspace da sessão alterado',
            expect.objectContaining({ detail: 'update · files/plan.md' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Turno'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Ações'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Arquivos'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('LER Ler arquivo'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('workspace.read_file'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('files/plan.md'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining(process.cwd()));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Workspace file update: files/plan.md'));
    });

    it('surfa elicitation, permission e sidechannel SDK como narrativa operacional', async () => {
        const { setTerminalRuntimePermissionMode } =
            await import('../../../src/copilot/terminal/frontend/gateways/index.js');
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setTerminalRuntimePermissionMode('selective');
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
            'Formulário SDK pendente',
            expect.objectContaining({ severity: 'warn', source: 'sdk' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Formulário ao operador'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Elicitation'));
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Permissão SDK solicitada',
            expect.objectContaining({ detail: 'file_write · pedido perm-1', severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Modo de permissão alterado',
            expect.objectContaining({ detail: 'auditoria sem prompts', source: 'sdk' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador',
            expect.objectContaining({ detail: expect.stringContaining('Escolha?'), severity: 'info' }),
        );
        expect(mocks.recordTerminalUserInputRequested).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'ui-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Resposta registrada',
            expect.objectContaining({
                detail: expect.stringContaining('resposta registrada; aguardando resposta final da LLM-B'),
            }),
        );
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'question',
            'Resposta do operador',
            expect.objectContaining({ detail: expect.stringContaining('choice/protocolo') }),
        );
        expect(mocks.recordTerminalUserInputCompleted).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'ui-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Ferramenta aguarda operador',
            expect.objectContaining({
                detail: 'escrevendo arquivo',
                toolName: 'workspace.write',
                severity: 'warn',
                source: 'sdk',
            }),
        );
        expect(mocks.recordTerminalTurnToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'workspace.write',
                operation: 'write',
                status: 'user_requested',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'elicitation.pending',
            expect.objectContaining({ id: 'el-1', message: 'Informe a branch de destino' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.requested',
            expect.objectContaining({
                id: 'perm-1',
                permissionType: 'file_write',
                source: 'sdk/permission.requested',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.mode_changed',
            expect.objectContaining({ mode: 'audit_only' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({ requestId: 'ui-1', allowFreeform: true }),
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
            expect.objectContaining({
                serverName: 'github',
                requestId: 'oauth-1',
                source: 'sdk/mcp.oauth.required',
            }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('mantém permissões autoaprovadas fora da superfície visual em approve_all', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('permission.requested', {
            requestId: 'perm-auto-1',
            permissionType: 'file_write',
        });
        agent.emit('permission.completed', {
            requestId: 'perm-auto-1',
            permissionType: 'file_write',
            granted: true,
        });

        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'question',
            'Permissão SDK solicitada',
            expect.anything(),
        );
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'system',
            'Permissão SDK aprovada',
            expect.anything(),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Permissão'));
        expect(refreshPromptIfIdle).not.toHaveBeenCalled();
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.requested',
            expect.objectContaining({
                id: 'perm-auto-1',
                permissionType: 'file_write',
                source: 'sdk/permission.requested',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.completed',
            expect.objectContaining({
                requestId: 'perm-auto-1',
                source: 'sdk/permission.completed',
                decision: 'approved',
            }),
        );
    });

    it('propaga traceId e turnId em user_input.requested/completed durante turno ativo', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('assistant.turn_start', { turnId: 'turn-ui-1' });
        agent.emit('user_input.requested', {
            requestId: 'ui-traced',
            question: 'Confirma?',
            choices: ['sim', 'não'],
            allowFreeform: true,
        });
        agent.emit('user_input.completed', {
            requestId: 'ui-traced',
            answer: 'sim',
            wasFreeform: false,
        });

        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({
                requestId: 'ui-traced',
                traceId: 'turn:turn-ui-1',
                turnId: 'turn-ui-1',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.completed',
            expect.objectContaining({
                requestId: 'ui-traced',
                traceId: 'turn:turn-ui-1',
                turnId: 'turn-ui-1',
            }),
        );
    });

    it('marca pergunta após ação sem síntese pública como contexto operacional', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const now = Date.now();
        mocks.readTerminalTurnTraceProjection.mockReturnValue({
            current: null,
            recent: [
                {
                    traceId: 'turn:prior',
                    turnId: 'prior',
                    source: 'assistant',
                    status: 'completed',
                    startedAt: now - 1_000,
                    updatedAt: now - 500,
                    finishedAt: now - 400,
                    toolCount: 1,
                    fileCount: 1,
                    userInputCount: 0,
                    tools: [],
                    files: [],
                    userInputs: [],
                },
            ],
        });
        beginTerminalTurnMaterialization({ turnId: 'turn-question', source: 'sdk/assistant.turn_start' });
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('user_input.requested', {
            requestId: 'ui-before-public',
            question: 'ASK-CANONICAL: responda SIM para fechar o teste',
            choices: ['SIM'],
            allowFreeform: false,
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador',
            expect.objectContaining({
                severity: 'warn',
                detail: expect.stringContaining('síntese pública'),
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({
                requestId: 'ui-before-public',
                prePublicResponse: true,
                prePublicResponseReason: expect.stringContaining('síntese pública'),
            }),
        );
        const rendered = mocks.println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(rendered).toContain('Contexto');
        expect(rendered).toContain('antes de escrever uma síntese pública');
    });

    it('não marca pergunta após síntese pública materializada depois das ações', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const now = Date.now();
        mocks.readTerminalTurnTraceProjection.mockReturnValue({
            current: null,
            recent: [
                {
                    traceId: 'turn:tools',
                    turnId: 'tools',
                    source: 'assistant',
                    status: 'completed',
                    startedAt: now - 2_000,
                    updatedAt: now - 1_000,
                    finishedAt: now - 900,
                    toolCount: 2,
                    fileCount: 1,
                    userInputCount: 0,
                    tools: [],
                    files: [],
                    userInputs: [],
                },
            ],
        });
        beginTerminalTurnMaterialization({ turnId: 'public-after-tools', timestamp: now - 800 });
        recordTerminalTurnDelta({ chunk: 'DELTA-CANONICAL-1\n', timestamp: now - 700 });
        completeTerminalTurnMaterialization({
            directReply: null,
            directSource: 'sdk/assistant.message',
            timestamp: now - 600,
        });
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('user_input.requested', {
            requestId: 'ui-after-public',
            question: 'ASK-CANONICAL: responda SIM para fechar o teste',
            choices: ['SIM'],
            allowFreeform: false,
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Pergunta ao operador',
            expect.objectContaining({
                severity: 'info',
                detail: expect.not.stringContaining('síntese pública'),
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({
                requestId: 'ui-after-public',
                prePublicResponse: false,
                prePublicResponseReason: null,
            }),
        );
        const rendered = mocks.println.mock.calls.map(([line]) => String(line)).join('\n');
        expect(rendered).not.toContain('antes de escrever uma síntese pública');
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
            'Fila de intervenção aguardando próxima oportunidade',
            expect.objectContaining({
                detail: 'pergunta humana ainda não aceita resposta; intervenção preservada',
                severity: 'warn',
                source: 'sdk',
            }),
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
            expect.objectContaining({ detail: '2/3 habilitadas', recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Ferramentas dinâmicas do SDK atualizadas',
            expect.objectContaining({
                detail: expect.stringContaining('92 ferramentas dinâmicas do SDK;'),
                recordHistory: false,
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Tarefas em segundo plano do SDK',
            expect.objectContaining({ detail: '4 pendentes', severity: 'warn' }),
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
        expect(mocks.println).not.toHaveBeenCalledWith(
            expect.stringContaining('Ferramentas dinâmicas do SDK atualizadas'),
        );
    });

    it('renderiza session.task_complete como tarefa em segundo plano sem print ANSI manual', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.task_complete', { summary: 'indexação terminou' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano concluída',
            expect.objectContaining({ detail: 'indexação terminou', source: 'sdk' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Tarefa'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('concluída · indexação terminou'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('🏁'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Task concluída'));
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.task_complete',
            expect.objectContaining({ summary: 'indexação terminou' }),
        );
    });

    it('mantém inventário verbose de skills/tools fora da linha viva e da atividade atual', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.skills_loaded', { count: 3, enabled: 2 });
        agent.emit('session.tools_updated', { count: 92 });

        expect(mocks.writeInlineStatus).not.toHaveBeenCalled();
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Skills SDK carregadas',
            expect.objectContaining({ updateCurrent: false, recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Ferramentas dinâmicas do SDK atualizadas',
            expect.objectContaining({ updateCurrent: false, recordHistory: false }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringMatching(/Skills\s+2\/3 habilitadas/u));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringMatching(/Ferramentas\s+SDK dinâmicas 92/u));
    });

    it('mantém config e título de sessão fora da narrativa visual rotineira', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.info', {
            infoType: 'configuration',
            message: 'Disabled tools: bash, glob, read_bash, stop_bash, view, write_bash',
        });
        agent.emit('session.title_changed', {
            title: 'Faça um teste integrado canônico do terminal com prompt muito longo que não deve ocupar a tela inteira do operador humano',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Configuração',
            expect.objectContaining({
                detail: expect.stringContaining('ferramentas nativas desativadas'),
                updateCurrent: false,
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Título da sessão atualizado',
            expect.objectContaining({
                detail: expect.stringContaining('Faça um teste integrado'),
                updateCurrent: false,
                recordHistory: false,
            }),
        );
        expect(mocks.writeInlineStatus).not.toHaveBeenCalledWith(
            expect.stringMatching(/Configuração · ferramentas nativas desativadas/u),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(
            expect.stringMatching(/Configuração\s+ferramentas nativas desativadas/u),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringMatching(/Título\s+Faça um teste integrado/u));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('SDK info'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Disabled tools:'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('Título da sessão:'));
    });

    it('não apresenta count 0 como lista SDK real quando o evento não materializou tools', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.tools_updated', { count: 0, countMaterialized: false, toolsMaterialized: false });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Ferramentas dinâmicas do SDK atualizadas',
            expect.objectContaining({
                detail: expect.stringContaining('SDK sinalizou atualização sem contagem materializada'),
                updateCurrent: false,
            }),
        );
        expect(mocks.writeInlineStatus).not.toHaveBeenCalled();
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringMatching(/Ferramentas\s+SDK sem contagem/u));
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.tools_updated',
            expect.objectContaining({ sdkCount: null, localToolsActive: false }),
        );
    });

    it('distingue lista SDK vazia materializada da contagem do registry local', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.tools_updated', { tools: [] });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Ferramentas dinâmicas do SDK atualizadas',
            expect.objectContaining({
                detail: expect.stringContaining('0 ferramentas dinâmicas do SDK;'),
                updateCurrent: false,
            }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Ferramentas dinâmicas do SDK atualizadas',
            expect.objectContaining({
                detail: expect.stringContaining('sem ferramentas locais ativas'),
                updateCurrent: false,
            }),
        );
        expect(mocks.writeInlineStatus).not.toHaveBeenCalled();
        expect(mocks.println).not.toHaveBeenCalledWith(
            expect.stringMatching(/Ferramentas\s+SDK dinâmicas 0 · sem ferramentas locais/u),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.tools_updated',
            expect.objectContaining({ sdkCount: 0, localToolsActive: false }),
        );
    });

    it('projeta model_retry como estado recuperável visível', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.info', {
            infoType: 'model_retry',
            message: 'Request failed due to a transient API error. Retrying...',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Retry modelo',
            expect.objectContaining({
                severity: 'warn',
                source: 'sdk',
                recordHistory: true,
                detail: 'falha temporária da API; tentando novamente',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.info',
            expect.objectContaining({ infoType: 'model_retry' }),
        );
    });

    it('surfa hooks, sampling, commands/capabilities, auto-mode e exit_plan_mode.requested', async () => {
        mocks.getShowSessionActivity.mockReturnValue(true);
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });

        agent.emit('hook.start', {
            hookInvocationId: 'hk-1',
            hookType: 'preToolUse',
            input: { tool: 'grep' },
        });
        agent.emit('hook.end', {
            hookInvocationId: 'hk-1',
            hookType: 'preToolUse',
            success: false,
            error: { message: 'boom' },
        });
        agent.emit('sampling.requested', {
            requestId: 'sample-1',
            serverName: 'browser',
            mcpRequestId: 7,
        });
        agent.emit('sampling.completed', { requestId: 'sample-1' });
        agent.emit('commands.changed', {
            count: 2,
            commands: [{ name: '/plan' }, { name: '/auto' }],
        });
        agent.emit('capabilities.changed', {
            capabilities: { ui: { elicitation: true } },
            changes: { ui: { elicitation: true } },
        });
        agent.emit('auto_mode_switch.requested', {
            requestId: 'auto-1',
            errorCode: 'rate_limit',
        });
        agent.emit('auto_mode_switch.completed', {
            requestId: 'auto-1',
            response: 'yes_always',
        });
        agent.emit('exit_plan_mode.requested', {
            requestId: 'plan-1',
            recommendedAction: 'approve',
            actions: ['approve', 'edit', 'reject'],
            planContent: '# Plano\n\nAplicar rollout gradual',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Hook SDK iniciado',
            expect.objectContaining({ detail: 'preToolUse · hk-1', recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Hook SDK falhou',
            expect.objectContaining({ severity: 'warn', source: 'sdk' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Sampling MCP solicitado',
            expect.objectContaining({ detail: 'browser · pedido sample-1', severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Comandos SDK atualizados',
            expect.objectContaining({ detail: expect.stringContaining('2 comandos · /plan, /auto') }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Capabilities SDK alteradas',
            expect.objectContaining({ detail: expect.stringContaining('elicitation ativada') }),
        );
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'system',
            'Capabilities SDK alteradas',
            expect.objectContaining({ detail: expect.stringContaining('ui.elicitation=') }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Troca automática de modo solicitada',
            expect.objectContaining({ detail: 'pedido auto-1 · rate_limit', severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Saída do plan mode solicitada',
            expect.objectContaining({ detail: expect.stringContaining('approve · 3 ações') }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'hook.start',
            expect.objectContaining({ hookType: 'preToolUse', hookInvocationId: 'hk-1' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'sampling.requested',
            expect.objectContaining({ requestId: 'sample-1', serverName: 'browser', mcpRequestId: 7 }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'commands.changed',
            expect.objectContaining({ count: 2, commands: expect.any(Array) }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'capabilities.changed',
            expect.objectContaining({ changes: expect.objectContaining({ ui: expect.any(Object) }) }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'auto_mode_switch.completed',
            expect.objectContaining({ requestId: 'auto-1', response: 'yes_always' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'exit_plan_mode.requested',
            expect.objectContaining({
                requestId: 'plan-1',
                recommendedAction: 'approve',
                actions: ['approve', 'edit', 'reject'],
            }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Hook'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Sampling'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('Plan mode'));
        expect(refreshPromptIfIdle).toHaveBeenCalled();
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
