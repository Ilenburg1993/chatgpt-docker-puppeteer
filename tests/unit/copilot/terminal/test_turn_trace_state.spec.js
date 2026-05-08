// @ts-check

import { beforeEach, describe, expect, it } from 'vitest';

import {
    beginTerminalTurnTrace,
    clearTerminalTurnTraceState,
    completeTerminalTurnToolCall,
    completeTerminalTurnTrace,
    readTerminalTurnTraceProjection,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
} from '../../../../src/copilot/terminal/state/turn-trace-state.js';

describe('terminal/turn-trace-state', () => {
    beforeEach(() => {
        clearTerminalTurnTraceState();
    });

    it('resume tools e arquivos tocados durante um turno explícito', () => {
        beginTerminalTurnTrace({ turnId: 'turn-1', timestamp: 10 });
        recordTerminalTurnToolActivity({
            toolName: 'workspace.read_file',
            operation: 'read',
            path: 'src/copilot/terminal/repl/repl.js',
            toolCallId: 'tool-1',
            timestamp: 20,
        });
        recordTerminalTurnFileActivity({
            path: 'src/copilot/terminal/repl/repl.js',
            operation: 'read',
            source: 'sdk',
            timestamp: 30,
        });
        completeTerminalTurnToolCall({ toolCallId: 'tool-1', success: true, timestamp: 40 });

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.turnId).toBe('turn-1');
        expect(trace?.toolCount).toBe(1);
        expect(trace?.fileCount).toBe(1);
        expect(trace?.tools[0]?.status).toBe('completed');
        expect(trace?.files[0]?.path).toBe('src/copilot/terminal/repl/repl.js');
    });

    it('fecha o turno e move o resumo para o histórico recente', () => {
        beginTerminalTurnTrace({ turnId: 'turn-2', timestamp: 100 });
        recordTerminalTurnToolActivity({
            toolName: 'workspace.write_file',
            operation: 'write',
            path: 'tmp/live.md',
            toolCallId: 'tool-2',
            timestamp: 110,
        });
        completeTerminalTurnTrace({ turnId: 'turn-2', timestamp: 120 });

        const projection = readTerminalTurnTraceProjection(3);

        expect(projection.current).toBeNull();
        expect(projection.recent[0]?.turnId).toBe('turn-2');
        expect(projection.recent[0]?.status).toBe('completed');
        expect(projection.recent[0]?.tools[0]?.path).toBe('tmp/live.md');
    });

    it('cria trace implícito quando uma tool aparece antes do assistant.turn_start', () => {
        recordTerminalTurnToolActivity({
            toolName: 'external_tool',
            operation: 'run',
            target: 'req-1',
            status: 'requested',
            timestamp: 200,
        });

        const projection = readTerminalTurnTraceProjection(3);

        expect(projection.current?.source).toBe('implicit');
        expect(projection.current?.tools[0]?.status).toBe('requested');
    });

    it('migra trace protocolar/implícito para o turno explícito sem perder tools anteriores', () => {
        beginTerminalTurnTrace({ turnId: '0', timestamp: 10 });
        recordTerminalTurnToolActivity({
            toolName: 'ask_user',
            operation: 'unknown',
            status: 'started',
            timestamp: 11,
        });
        recordTerminalTurnToolActivity({
            toolName: 'view',
            operation: 'read',
            path: '/tmp/file.txt',
            toolCallId: 'tool-1',
            timestamp: 12,
        });

        beginTerminalTurnTrace({ turnId: '2', timestamp: 13 });
        completeTerminalTurnToolCall({ toolCallId: 'tool-1', success: true, timestamp: 14 });
        completeTerminalTurnTrace({ turnId: '2', timestamp: 15 });

        const projection = readTerminalTurnTraceProjection(3);

        expect(projection.recent[0]?.traceId).toBe('turn:2');
        expect(projection.recent[0]?.tools.map((tool) => tool.toolName)).toContain('ask_user');
        expect(projection.recent[0]?.tools.map((tool) => tool.toolName)).toContain('view');
        expect(projection.recent[0]?.files[0]?.path).toBe('/tmp/file.txt');
    });
});
