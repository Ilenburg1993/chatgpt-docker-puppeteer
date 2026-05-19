// @ts-check
/**
 * tests/unit/copilot/test_terminal_task_stream_events.spec.js
 *
 * Contrato: terminal/task-stream-events.js
 */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    println: mocks.println,
}));

vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    appendThinkingHistoryChunk: mocks.appendThinkingHistoryChunk,
    finalizeThinkingHistoryEntry: mocks.finalizeThinkingHistoryEntry,
    getBusy: mocks.getBusy,
    getShowStreaming: mocks.getShowStreaming,
    getShowThinking: mocks.getShowThinking,
}));

vi.mock('../../../src/copilot/terminal/events/assistant-transcript-renderer.js', () => ({
    renderTerminalAssistantTranscript: mocks.renderTerminalAssistantTranscript,
}));

describe('terminal/task-stream-events.js — contrato', () => {
    beforeEach(() => {
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
    });

    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/task-stream-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalTaskStreamListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/events/task-stream-events.js');
        expect(typeof mod.setupTerminalTaskStreamListeners).toBe('function');
    });

    it('consome chunk em task.reasoning como thinking colapsado de tarefa interna', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.reasoning', { taskId: 'task-1', chunk: 'pensando...' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Raciocinando tarefa interna',
            expect.objectContaining({ detail: 'task task-1', source: 'agent', recordHistory: false }),
        );
        expect(mocks.appendThinkingHistoryChunk).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'task-task-1', source: 'task', chunk: 'pensando...' }),
        );
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('task thinking capturado'));
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('/thinking show'));
        expect(stdoutSpy).not.toHaveBeenCalled();
        stdoutSpy.mockRestore();
    });

    it('registra task.delta sem imprimir streaming bruto e persiste transcript no fechamento', async () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.delta', { taskId: 'task-1', chunk: 'OK-LIVE-1' });
        agent.emit('task.completed', { taskId: 'task-1' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Executando tarefa interna',
            expect.objectContaining({
                detail: expect.stringContaining('delta (task-1)'),
                source: 'agent',
                recordHistory: false,
            }),
        );
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('task streaming'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('task complete'));
        expect(mocks.renderTerminalAssistantTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'OK-LIVE-1',
                source: 'agent/task.delta',
                status: 'completed',
            }),
        );
        expect(stdoutSpy).not.toHaveBeenCalled();
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
            'Tarefa interna concluída',
            expect.objectContaining({
                detail: '1 chunks · 25 chars',
                recordHistory: false,
                updateCurrent: false,
            }),
        );
        expect(mocks.recordTerminalActivity).not.toHaveBeenCalledWith(
            'task',
            'Executando tarefa interna',
            expect.any(Object),
        );
    });

    it('não promove task.completed vazio para atividade atual mesmo com taskId', async () => {
        const { setupTerminalTaskStreamListeners } =
            await import('../../../src/copilot/terminal/events/task-stream-events.js');
        const agent = new EventEmitter();

        setupTerminalTaskStreamListeners({ agent });
        agent.emit('task.completed', { taskId: 'task-sem-delta' });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'task',
            'Tarefa interna concluída',
            expect.objectContaining({
                detail: '0 chunks · 0 chars',
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
            title: 'Task interna',
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
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('task thinking #task-internal-1 concluído'));
        expect(mocks.println).not.toHaveBeenCalledWith(expect.stringContaining('__anonymous__'));
    });

    it('finaliza thinking aberto mesmo quando task.completed chega sem taskId', async () => {
        mocks.finalizeThinkingHistoryEntry.mockReturnValue({
            id: 'task-task-1',
            ts: Date.now(),
            source: 'task',
            title: 'Task task-1',
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
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('task thinking #task-task-1 concluído'));
    });
});
