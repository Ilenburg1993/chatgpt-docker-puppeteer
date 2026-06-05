// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass
/**
 * tests/unit/copilot/test_terminal_task_stream_events.spec.js
 *
 * Contrato: terminal/task-stream-events.js
 */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearTerminalUserInputs,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
} from '../../../src/copilot/terminal/state/sdk-interactions.js';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    recordTerminalTurnDelta,
    getTerminalAssistantMessageMaterializationDecision,
    shouldSuppressTerminalAssistantMessageAsMaterializedTurn,
} from '../../../src/copilot/terminal/state/turn-materialization-state.js';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    println: vi.fn(),
    renderTerminalAssistantTranscript: vi.fn(() => true),
    getBusy: vi.fn(() => false),
    getShowStreaming: vi.fn(() => true),
    getShowThinking: vi.fn(() => true),
    appendThinkingHistoryChunk: vi.fn(),
    finalizeThinkingHistoryEntry: vi.fn(),
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity: mocks.recordTerminalActivity,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        println: mocks.println,
    };
});

vi.mock('../../../src/copilot/terminal/dialog/sse.js', () => ({
    broadcastSse: vi.fn(),
    CRITICAL_EVENTS: new Set(),
    nextSseEventId: vi.fn(() => 1),
}));

vi.mock('../../../src/copilot/terminal/dialog/output.js', () => ({
    beginTerminalRenderLock: vi.fn(),
    clearInlineStatus: vi.fn(),
    endTerminalRenderLock: vi.fn(),
    println: mocks.println,
    SEPARATOR: '---',
    writeTerminalRaw: (chunk) => process.stdout.write(String(chunk)),
}));

vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    appendThinkingHistoryChunk: mocks.appendThinkingHistoryChunk,
    finalizeThinkingHistoryEntry: mocks.finalizeThinkingHistoryEntry,
    getBusy: mocks.getBusy,
    getShowIntentActivity: vi.fn(() => true),
    getShowSessionActivity: vi.fn(() => true),
    getShowStreaming: mocks.getShowStreaming,
    getShowThinking: mocks.getShowThinking,
    getShowToolActivity: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    setShowIntentActivity: vi.fn(),
    setShowSessionActivity: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowThinking: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowUsage: vi.fn(),
}));

vi.mock('../../../src/copilot/terminal/events/assistant-transcript-renderer.js', () => ({
    claimTerminalAssistantTranscript: vi.fn(() => true),
    renderTerminalAssistantTranscript: mocks.renderTerminalAssistantTranscript,
}));

vi.mock('../../../src/copilot/terminal/frontend/gateways/index.js', () => ({
    readTerminalDialogStreamMeta: () => ({ model: 'gpt-test', reasoningEffort: 'high' }),
    classifyTerminalUserInputQuestionKind: () => 'question',
    normalizeTerminalUserInputRequestedEvent: (evt) => ({
        requestId: evt?.requestId ?? null,
        runtimeId: evt?.runtimeId ?? null,
        question: evt?.question ?? '',
        choices: Array.isArray(evt?.choices) ? evt.choices : [],
        allowFreeform: evt?.allowFreeform !== false,
        toolCallId: evt?.toolCallId ?? null,
        data: evt?.data ?? {},
        ts: evt?.timestamp ?? evt?.ts ?? Date.now(),
    }),
    normalizeTerminalUserInputCompletedEvent: (evt) => ({
        requestId: evt?.requestId ?? null,
        runtimeId: evt?.runtimeId ?? null,
        answer: evt?.answer ?? '',
        wasFreeform: typeof evt?.wasFreeform === 'boolean' ? evt.wasFreeform : null,
        data: evt?.data ?? {},
        ts: evt?.timestamp ?? evt?.ts ?? Date.now(),
    }),
}));

describe('terminal/task-stream-events.js — contrato', () => {
    beforeEach(async () => {
        mocks.recordTerminalActivity.mockClear();
        mocks.println.mockClear();
        mocks.renderTerminalAssistantTranscript.mockClear();
        mocks.getBusy.mockReset();
        mocks.getBusy.mockReturnValue(false);
        mocks.getShowStreaming.mockReset();
        mocks.getShowStreaming.mockReturnValue(true);
        mocks.getShowThinking.mockReset();
        mocks.getShowThinking.mockReturnValue(true);
        mocks.appendThinkingHistoryChunk.mockClear();
        mocks.finalizeThinkingHistoryEntry.mockClear();
        clearTerminalUserInputs();
        clearTerminalTurnMaterialization();
        const stream = await import('../../../src/copilot/terminal/events/public-assistant-stream.js');
        stream.resetPublicAssistantStreamsForTests();
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/task-stream-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalTaskStreamListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/task-stream-events.js');
        expect(typeof mod.setupTerminalTaskStreamListeners).toBe('function');
    });

    it('mostra task.error com requeue bloqueado como prompt preservado', async () => {
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.error', {
            taskId: 'dialog-task-1',
            origin: 'dialog_boot',
            requeueBlocked: true,
            error: 'reenvio automático foi bloqueado',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'error',
            'Tarefa em segundo plano falhou',
            expect.objectContaining({
                detail: 'dialog_boot · reenvio automático bloqueado após reconexão',
                severity: 'error',
                source: 'agent',
            }),
        );
        expect(mocks.println).toHaveBeenCalledWith(
            expect.stringContaining('prompt preservado sem reenvio automático'),
        );
    });

    it('consome chunk em task.reasoning como thinking colapsado de tarefa em segundo plano', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.reasoning', { taskId: 'task-1', chunk: 'pensando...' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Raciocínio em segundo plano',
            expect.objectContaining({ detail: 'tarefa task-1', source: 'agent', recordHistory: false }),
        );
        expect(mocks.appendThinkingHistoryChunk).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'task-task-1', source: 'task', chunk: 'pensando...' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('raciocínio da tarefa capturado'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('/thinking show'));
        expect(stdoutSpy).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('registra task.delta público como materialização canônica para suprimir assistant.message equivalente', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const stream = await import('../../../src/copilot/terminal/events/public-assistant-stream.js');

        stream.renderPublicAssistantStreamDelta({
            key: 'task:post-ask',
            chunk: '✅ Teste canônico repetido ',
            source: 'agent/task.delta',
            streamId: 'task:post-ask',
            chunkSeq: 1,
        });
        stream.renderPublicAssistantStreamDelta({
            key: 'task:post-ask',
            chunk: 'e validado',
            source: 'agent/task.delta',
            streamId: 'task:post-ask',
            chunkSeq: 2,
        });

        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: '✅ Teste canônico repetido e validado',
            }),
        ).toBe(true);
        expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
            'Teste canônico repetido e validado',
        );
        stdoutSpy.mockRestore();
    });

    it('renderiza task.delta público ao vivo e não duplica transcript no fechamento', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: 'task-1', chunk: 'OK-LIVE-1' });
        agent.emit('task.completed', { taskId: 'task-1' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano',
            expect.objectContaining({
                detail: expect.stringContaining('tarefa task-1 · 1 fragmento · 9 caracteres'),
                source: 'agent',
                recordHistory: false,
            }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('task streaming'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('task complete'));
        expect(stdoutSpy).toHaveBeenCalled();
        expect(stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('OK-LIVE-1');
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('fecha materialização pública para assistant.message renderizar só sufixo posterior', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', {
            taskId: 'task-prefix',
            streamId: 'stream-prefix',
            chunk: 'Vou chamar ask_user ',
        });
        agent.emit('task.completed', { taskId: 'task-prefix', streamId: 'stream-prefix' });

        const decision = getTerminalAssistantMessageMaterializationDecision({
            content: 'Vou chamar ask_user e aguardar sua resposta.',
        });

        expect(decision.action).toBe('render_suffix');
        expect(decision.suffix).toBe('e aguardar sua resposta.');
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('suprime task.delta que ecoa resposta humana recém-concluída de ask_user', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const base = Date.now();
        recordTerminalUserInputRequested({ requestId: 'ask-1', question: 'ASK-CANONICAL', timestamp: base });
        recordTerminalUserInputCompleted({ requestId: 'ask-1', answer: 'SIM', timestamp: base + 1 });
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: null, chunk: 'SIM' });

        expect(stdoutSpy).not.toHaveBeenCalled();
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Eco de resposta humana suprimido no streaming',
            expect.objectContaining({ source: 'agent/task.delta' }),
        );
        stdoutSpy.mockRestore();
    });

    it('persiste transcript de task.delta no fechamento quando streaming visual está desligado', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        mocks.getShowStreaming.mockReturnValue(false);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: 'task-1', chunk: 'OK-FINAL-1' });
        agent.emit('task.completed', { taskId: 'task-1' });

        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'OK-FINAL-1',
                source: 'agent/task.delta',
                status: 'completed',
            }),
        );
        stdoutSpy.mockRestore();
    });

    it('não duplica transcript de task.delta quando o delta já pertence a turno ativo', async () => {
        mocks.getBusy.mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: 'task-1', chunk: 'já renderizado pelo turno' });
        agent.emit('task.completed', { taskId: 'task-1' });

        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano concluída',
            expect.objectContaining({
                detail: '1 fragmento · 25 caracteres',
                recordHistory: false,
                updateCurrent: false,
            }),
        );
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano',
            expect.any(Object),
        );
    });

    it('ignora task.delta paralelo quando dialog.delta já materializou o mesmo texto', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        beginTerminalTurnMaterialization({ turnId: 'turn-dialog', timestamp: 1000 });
        recordTerminalTurnDelta({
            chunk: '✅ **Teste canônico validado**',
            source: 'dialog/onDelta',
            timestamp: 1001,
        });
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: 'task-shadow', chunk: 'Teste canônico' });

        expect(stdoutSpy).not.toHaveBeenCalled();
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano',
            expect.any(Object),
        );
        expect(mocks.renderTerminalAssistantTranscript).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('não promove task.completed vazio para atividade atual mesmo com taskId', async () => {
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.completed', { taskId: 'task-sem-delta' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa em segundo plano concluída',
            expect.objectContaining({
                detail: '0 fragmentos · 0 caracteres',
                recordHistory: false,
                updateCurrent: false,
            }),
        );
    });

    it('não imprime reasoning cru de tarefa quando /thinking está desligado', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        mocks.getShowThinking.mockReturnValue(false);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.reasoning', { taskId: 'task-1', chunk: 'pensando...' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalled();
        expect(mocks.appendThinkingHistoryChunk).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'task-task-1', source: 'task', chunk: 'pensando...' }),
        );
        expect(mocks.println).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('usa id interno legível para task.reasoning sem taskId e não vaza __anonymous__', async () => {
        mocks.finalizeThinkingHistoryEntry.mockReturnValue({
            id: 'task-internal-1',
            ts: Date.now(),
            source: 'task',
            title: 'Tarefa em segundo plano',
            content: 'pensando...',
            chars: 11,
            durationMs: 15,
            reasoningId: null,
            taskId: null,
            status: 'completed',
        });
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.reasoning', { chunk: 'pensando...' });
        agent.emit('task.completed', {});

        expect(mocks.appendThinkingHistoryChunk).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'task-internal-1', source: 'task', taskId: null }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('/thinking show task-internal-1'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('raciocínio da tarefa #task-internal-1 concluído'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('__anonymous__'));
    });

    it('finaliza thinking aberto mesmo quando task.completed chega sem taskId', async () => {
        mocks.finalizeThinkingHistoryEntry.mockReturnValue({
            id: 'task-task-1',
            ts: Date.now(),
            source: 'task',
            title: 'Tarefa task-1',
            content: 'pensando...',
            chars: 11,
            durationMs: 15,
            reasoningId: null,
            taskId: 'task-1',
            status: 'completed',
        });
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.reasoning', { taskId: 'task-1', chunk: 'pensando...' });
        agent.emit('task.completed', {});

        expect(mocks.finalizeThinkingHistoryEntry).toHaveBeenCalledWith(
            'task-task-1',
            expect.objectContaining({ status: 'completed' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('raciocínio da tarefa #task-task-1 concluído'));
    });
});
