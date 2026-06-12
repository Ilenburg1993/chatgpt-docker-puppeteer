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
    recordTerminalTurnUserInputActivity,
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

    it('não conta start e complete da mesma tool como duas operações de arquivo', () => {
        beginTerminalTurnTrace({ turnId: 'turn-file', timestamp: 10 });
        recordTerminalTurnToolActivity({
            toolName: 'delete_file',
            operation: 'delete',
            path: 'tmp/live.md',
            toolCallId: 'tool-delete-1',
            status: 'started',
            timestamp: 20,
        });
        recordTerminalTurnToolActivity({
            toolName: 'delete_file',
            operation: 'delete',
            path: 'tmp/live.md',
            toolCallId: 'tool-delete-1',
            status: 'completed',
            success: true,
            timestamp: 30,
        });

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.toolCount).toBe(1);
        expect(trace?.tools[0]?.count).toBe(2);
        expect(trace?.fileCount).toBe(1);
        expect(trace?.files[0]).toMatchObject({ path: 'tmp/live.md', operation: 'delete', count: 1 });
    });

    it('mantém contagem para chamadas distintas ao mesmo arquivo', () => {
        beginTerminalTurnTrace({ turnId: 'turn-file-repeat', timestamp: 10 });
        recordTerminalTurnToolActivity({
            toolName: 'read_file_content',
            operation: 'read',
            path: 'package.json',
            toolCallId: 'tool-read-1',
            status: 'started',
            timestamp: 20,
        });
        recordTerminalTurnToolActivity({
            toolName: 'read_file_content',
            operation: 'read',
            path: 'package.json',
            toolCallId: 'tool-read-2',
            status: 'started',
            timestamp: 30,
        });

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.toolCount).toBe(2);
        expect(trace?.fileCount).toBe(1);
        expect(trace?.files[0]).toMatchObject({ path: 'package.json', operation: 'read', count: 2 });
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

    it('registra ask_user como interação humana do turno sem depender da lista de tools', () => {
        beginTerminalTurnTrace({ turnId: 'turn-human', timestamp: 10 });
        recordTerminalTurnUserInputActivity({
            requestId: 'ui-1',
            kind: 'question',
            question: 'Qual ambiente devo usar?',
            choices: ['dev', 'prod'],
            allowFreeform: false,
            status: 'requested',
            timestamp: 20,
        });
        recordTerminalTurnUserInputActivity({
            requestId: 'ui-1',
            status: 'answered',
            answerPreview: 'prod',
            timestamp: 30,
        });

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.toolCount).toBe(0);
        expect(trace?.userInputCount).toBe(1);
        expect(trace?.userInputs[0]).toMatchObject({
            requestId: 'ui-1',
            kind: 'question',
            status: 'answered',
            question: 'Qual ambiente devo usar?',
            choices: ['dev', 'prod'],
            answerPreview: 'prod',
        });
    });

    it('limita cardinalidade e mantém os eventos mais recentes de um turno anormalmente longo', () => {
        beginTerminalTurnTrace({ turnId: 'turn-bounded', timestamp: 1 });

        for (let index = 0; index < 300; index += 1) {
            recordTerminalTurnToolActivity({
                toolName: `tool-${index}`,
                toolCallId: `call-${index}`,
                operation: 'read',
                path: `/tmp/file-${index}.txt`,
                timestamp: index + 2,
            });
            recordTerminalTurnUserInputActivity({
                requestId: `request-${index}`,
                question: `question-${index}`,
                timestamp: index + 2,
            });
        }

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.toolCount).toBe(128);
        expect(trace?.tools[0]?.toolName).toBe('tool-172');
        expect(trace?.tools.at(-1)?.toolName).toBe('tool-299');
        expect(trace?.fileCount).toBe(256);
        expect(trace?.files[0]?.path).toBe('/tmp/file-44.txt');
        expect(trace?.files.at(-1)?.path).toBe('/tmp/file-299.txt');
        expect(trace?.userInputCount).toBe(64);
        expect(trace?.userInputs[0]?.requestId).toBe('request-236');
        expect(trace?.userInputs.at(-1)?.requestId).toBe('request-299');
    });

    it('limita payloads variáveis e chaves de dedupe retidas por arquivo', () => {
        beginTerminalTurnTrace({ turnId: 'turn-payload', timestamp: 1 });
        for (let index = 0; index < 40; index += 1) {
            recordTerminalTurnFileActivity({
                path: 'a'.repeat(5000),
                operation: 'read',
                dedupeKey: `${index}-${'d'.repeat(2000)}`,
                timestamp: index + 2,
            });
        }
        recordTerminalTurnUserInputActivity({
            requestId: 'request-payload',
            question: 'q'.repeat(5000),
            choices: Array.from({ length: 50 }, (_, index) => `${index}-${'c'.repeat(1000)}`),
            answerPreview: 'p'.repeat(3000),
            timestamp: 50,
        });

        const trace = readTerminalTurnTraceProjection(3).current;

        expect(trace?.files[0]?.path).toHaveLength(4096);
        expect(trace?.files[0]?.dedupeKeys).toHaveLength(32);
        expect(trace?.files[0]?.dedupeKeys?.[0]?.startsWith('8-')).toBe(true);
        expect(trace?.files[0]?.dedupeKeys?.every((key) => key.length <= 1024)).toBe(true);
        expect(trace?.userInputs[0]?.question).toHaveLength(4096);
        expect(trace?.userInputs[0]?.choices).toHaveLength(32);
        expect(trace?.userInputs[0]?.choices.every((choice) => choice.length <= 512)).toBe(true);
        expect(trace?.userInputs[0]?.answerPreview).toHaveLength(2048);
    });

    it('não expõe a lista interna de dedupeKeys por referência nos snapshots', () => {
        beginTerminalTurnTrace({ turnId: 'turn-snapshot', timestamp: 1 });
        recordTerminalTurnFileActivity({
            path: '/tmp/snapshot.txt',
            operation: 'read',
            dedupeKey: 'internal-key',
            timestamp: 2,
        });

        const first = readTerminalTurnTraceProjection(3).current;
        first?.files[0]?.dedupeKeys?.push('external-mutation');
        const second = readTerminalTurnTraceProjection(3).current;

        expect(second?.files[0]?.dedupeKeys).toEqual(['internal-key']);
    });
});
