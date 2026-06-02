// @ts-check

import { channel } from 'node:diagnostics_channel';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordTerminalActivity = vi.fn();
const recordTerminalTurnFileActivity = vi.fn();
const readTerminalTurnTraceProjection = vi.fn(() => ({ current: null, recent: [] }));
const broadcastSse = vi.fn();
const println = vi.fn();
const getShowToolActivity = vi.fn(() => true);

vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    recordTerminalTurnFileActivity,
    readTerminalTurnTraceProjection,
}));

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse,
    println,
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getShowToolActivity,
}));

describe('terminal/io-activity-events', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getShowToolActivity.mockReturnValue(true);
        readTerminalTurnTraceProjection.mockReturnValue({ current: null, recent: [] });
    });

    it('projeta operações reais de I/O para activity, turn trace, stdout e SSE', async () => {
        const { clearTerminalIoActivityProjection, readTerminalIoActivityProjection, setupTerminalIoActivityEvents } =
            await import('../../../../src/copilot/terminal/events/io-activity-events.js');
        clearTerminalIoActivityProjection();
        const cleanup = setupTerminalIoActivityEvents();
        const target = join(process.cwd(), 'src/copilot/terminal/events/io-activity-events.js');

        try {
            channel('copilot.io.operation').publish({
                ts: 123,
                success: true,
                io: {
                    operation: 'read',
                    target,
                    targetKind: 'file',
                    bytesRead: 42,
                    durationMs: 7,
                    engine: 'io-engine.fs.readFile.text',
                    riskClass: 'low',
                    traceId: 'trace-io',
                },
            });
        } finally {
            cleanup();
        }

        expect(recordTerminalTurnFileActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'src/copilot/terminal/events/io-activity-events.js',
                operation: 'read',
                source: 'io',
                timestamp: 123,
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'I/O read concluído',
            expect.objectContaining({
                detail: expect.stringContaining('src/copilot/terminal/events/io-activity-events.js'),
                toolName: 'io.read',
                source: 'io',
                progress: 100,
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[IO]'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'io_op',
                timestamp: 123,
                success: true,
                operation: 'read',
                target: 'src/copilot/terminal/events/io-activity-events.js',
                ioBytesRead: 42,
                ioEngine: 'io-engine.fs.readFile.text',
            }),
        );
        expect(readTerminalIoActivityProjection(1)).toEqual([
            expect.objectContaining({
                operation: 'read',
                target: 'src/copilot/terminal/events/io-activity-events.js',
                bytesRead: 42,
            }),
        ]);
    });

    it('remove subscriber no cleanup e não deixa evento global vazando', async () => {
        const { clearTerminalIoActivityProjection, setupTerminalIoActivityEvents } =
            await import('../../../../src/copilot/terminal/events/io-activity-events.js');
        clearTerminalIoActivityProjection();
        const cleanup = setupTerminalIoActivityEvents();
        cleanup();

        channel('copilot.io.operation').publish({
            ts: 999,
            success: true,
            io: {
                operation: 'write',
                target: join(process.cwd(), 'tmp/a.txt'),
                targetKind: 'file',
                bytesWritten: 2,
                durationMs: 1,
                engine: 'io-engine.atomic-write',
                riskClass: 'medium',
                traceId: 'trace-io-cleanup',
            },
        });

        expect(recordTerminalActivity).not.toHaveBeenCalled();
        expect(broadcastSse).not.toHaveBeenCalled();
        expect(println).not.toHaveBeenCalled();
    });

    it('preserva operação move no turn trace e na saída de I/O', async () => {
        const { clearTerminalIoActivityProjection, setupTerminalIoActivityEvents } =
            await import('../../../../src/copilot/terminal/events/io-activity-events.js');
        clearTerminalIoActivityProjection();
        const cleanup = setupTerminalIoActivityEvents();
        const target = join(process.cwd(), 'data/copilot-terminal/live-scratch/source.txt');

        try {
            channel('copilot.io.operation').publish({
                ts: 321,
                success: true,
                io: {
                    operation: 'move',
                    target,
                    targetKind: 'file',
                    bytesRead: 12,
                    durationMs: 3,
                    engine: 'io-engine.fs.rename',
                    riskClass: 'medium',
                    traceId: 'trace-io-move',
                },
            });
        } finally {
            cleanup();
        }

        expect(recordTerminalTurnFileActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'data/copilot-terminal/live-scratch/source.txt',
                operation: 'move',
                source: 'io',
                timestamp: 321,
            }),
        );
        expect(println).toHaveBeenCalledWith(expect.stringContaining('[MOVE]'));
        expect(broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({
                type: 'io_op',
                operation: 'move',
                target: 'data/copilot-terminal/live-scratch/source.txt',
            }),
        );
    });
});
