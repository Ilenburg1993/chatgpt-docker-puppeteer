// @ts-check

import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearTerminalToolLifecycleDiagnostics,
    readTerminalToolLifecycleProjection,
    recordTerminalToolLifecycleDiagnostic,
} from '../../../../src/copilot/terminal/state/tool-lifecycle-state.js';

describe('terminal/state/tool-lifecycle-state', () => {
    beforeEach(() => {
        clearTerminalToolLifecycleDiagnostics();
    });

    it('mantém active e move completion para recent preservando IDs', () => {
        recordTerminalToolLifecycleDiagnostic({
            type: 'start',
            source: 'sdk',
            timestamp: 100,
            traceId: 'turn:1',
            turnId: '1',
            toolCallId: 'call-1',
            toolName: 'read_file_content',
            rawToolName: null,
            requestId: 'req-1',
            operation: 'read',
            path: 'package.json',
            target: 'package.json',
            fileTargets: ['package.json'],
            urlTargets: [],
            searchTerms: [],
            lineRange: null,
            patchFiles: [],
            progress: null,
            progressMessage: null,
            partialOutput: null,
            success: null,
            durationMs: null,
            ioEngine: null,
            ioTargetKind: null,
            ioBytesRead: null,
            ioBytesWritten: null,
            ioRiskClass: null,
            ioTargets: [],
            ioError: null,
            correlatedToolCallId: null,
            correlatedToolName: null,
        });
        recordTerminalToolLifecycleDiagnostic({
            type: 'progress',
            source: 'sdk',
            timestamp: 150,
            traceId: 'turn:1',
            turnId: '1',
            toolCallId: 'call-1',
            toolName: 'read_file_content',
            rawToolName: null,
            requestId: null,
            operation: 'read',
            path: null,
            target: null,
            fileTargets: [],
            urlTargets: [],
            searchTerms: [],
            lineRange: null,
            patchFiles: [],
            progress: 50,
            progressMessage: 'metade',
            partialOutput: null,
            success: null,
            durationMs: null,
            ioEngine: null,
            ioTargetKind: null,
            ioBytesRead: null,
            ioBytesWritten: null,
            ioRiskClass: null,
            ioTargets: [],
            ioError: null,
            correlatedToolCallId: null,
            correlatedToolName: null,
        });

        let projection = readTerminalToolLifecycleProjection();
        expect(projection.summary.active).toBe(1);
        expect(projection.active[0]?.requestId).toBe('req-1');
        expect(projection.active[0]?.progress).toBe(50);

        recordTerminalToolLifecycleDiagnostic({
            type: 'complete',
            source: 'sdk',
            timestamp: 250,
            traceId: 'turn:1',
            turnId: '1',
            toolCallId: 'call-1',
            toolName: 'read_file_content',
            rawToolName: null,
            requestId: null,
            operation: 'read',
            path: null,
            target: null,
            fileTargets: [],
            urlTargets: [],
            searchTerms: [],
            lineRange: null,
            patchFiles: [],
            progress: null,
            progressMessage: null,
            partialOutput: null,
            success: true,
            durationMs: 151,
            ioEngine: null,
            ioTargetKind: null,
            ioBytesRead: null,
            ioBytesWritten: null,
            ioRiskClass: null,
            ioTargets: [],
            ioError: null,
            correlatedToolCallId: null,
            correlatedToolName: null,
        });

        projection = readTerminalToolLifecycleProjection();
        expect(projection.summary.active).toBe(0);
        expect(projection.summary.recent).toBe(1);
        expect(projection.recent[0]?.status).toBe('completed');
        expect(projection.recent[0]?.requestId).toBe('req-1');
        expect(projection.recent[0]?.durationMs).toBe(151);
    });

    it('registra espera humana como active waiting_user', () => {
        recordTerminalToolLifecycleDiagnostic({
            type: 'user_requested',
            source: 'user',
            timestamp: 100,
            traceId: 'turn:2',
            turnId: '2',
            toolCallId: null,
            toolName: 'ask_user',
            rawToolName: null,
            requestId: 'ask-1',
            operation: null,
            path: null,
            target: 'ask-1',
            fileTargets: [],
            urlTargets: [],
            searchTerms: [],
            lineRange: null,
            patchFiles: [],
            progress: null,
            progressMessage: null,
            partialOutput: null,
            success: null,
            durationMs: null,
            ioEngine: null,
            ioTargetKind: null,
            ioBytesRead: null,
            ioBytesWritten: null,
            ioRiskClass: null,
            ioTargets: [],
            ioError: null,
            correlatedToolCallId: null,
            correlatedToolName: null,
        });

        const projection = readTerminalToolLifecycleProjection();
        expect(projection.summary.active).toBe(1);
        expect(projection.summary.waitingUser).toBe(1);
        expect(projection.active[0]?.toolName).toBe('ask_user');
        expect(projection.active[0]?.requestId).toBe('ask-1');
    });
});
