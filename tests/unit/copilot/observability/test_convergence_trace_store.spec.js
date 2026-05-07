// @ts-check
import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createConvergenceTraceStore } from '../../../../src/copilot/observability/convergence-trace-store.js';

describe('observability/convergence-trace-store', () => {
    it('agrega eventos de convergência por traceId, fase, status e bytes', () => {
        const store = createConvergenceTraceStore();

        store.recordMetric({
            operation: 'workspace.promote',
            status: 'started',
            sessionId: 'sdk-1',
            attributes: {
                traceId: 'trace-1',
                phase: 'read_local',
                localPath: 'tmp/a.md',
                sdkPath: 'notes/a.md',
                overwrite: false,
            },
        });
        store.recordMetric({
            operation: 'workspace.promote',
            status: 'succeeded',
            sessionId: 'sdk-1',
            durationMs: 7,
            attributes: {
                traceId: 'trace-1',
                phase: 'read_local',
                localPath: 'tmp/a.md',
                sdkPath: 'notes/a.md',
                bytes: 12,
                overwrite: false,
            },
        });
        store.recordMetric({
            operation: 'workspace.promote',
            status: 'failed',
            sessionId: 'sdk-1',
            durationMs: 3,
            attributes: {
                traceId: 'trace-1',
                phase: 'conflict_check',
                localPath: 'tmp/a.md',
                sdkPath: 'notes/a.md',
                reason: 'destination-exists',
                overwrite: false,
            },
        });

        const snapshot = store.getSnapshot({ traceId: 'trace-1' });
        const trace = snapshot.selectedTrace;

        assert.equal(snapshot.totalTraces, 1);
        assert.equal(trace?.status, 'mixed');
        assert.equal(trace?.bytes, 12);
        assert.equal(trace?.phases.read_local.succeeded, 1);
        assert.equal(trace?.phases.read_local.latency.p50, 7);
        assert.equal(trace?.phases.conflict_check.failed, 1);
        assert.equal(snapshot.operations['workspace.promote'].mixed, 1);
        assert.equal(snapshot.operations['workspace.promote'].phases.read_local.bytes, 12);
    });

    it('ignora métricas SDK sem traceId/fase ou fora de workspace.*', () => {
        const store = createConvergenceTraceStore();

        store.recordMetric({ operation: 'session.sendAndWait', status: 'succeeded' });
        store.recordMetric({ operation: 'workspace.promote', status: 'succeeded', attributes: { traceId: 't' } });
        store.recordMetric({ operation: 'workspace.promote', status: 'succeeded', attributes: { phase: 'write_sdk' } });

        assert.equal(store.getSnapshot().totalTraces, 0);
    });
});
