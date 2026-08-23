// @ts-check
import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createEventBus } from '#copilot/events/runtime';
import { createConvergenceTraceStore } from '../../../../src/copilot/observability/convergence-trace-store.js';
import { createObservabilityBusRuntime } from '../../../../src/copilot/observability/event-bus-runtime.js';
import { createMetricsStore } from '../../../../src/copilot/observability/metrics.js';
import { projectSdkOperationMetric } from '../../../../src/copilot/observability/sdk-metric-bridge.js';

describe('observability/sdk-metric-bridge', () => {
    it('projeta SdkOperationMetric no MetricsStore e no EventBus canônico', () => {
        const bus = createEventBus();
        const metrics = createMetricsStore();
        const runtime = createObservabilityBusRuntime({ bus, metrics });

        projectSdkOperationMetric(
            {
                operation: 'session.fs.writeFile',
                status: 'failed',
                sessionId: 'sess-fs-001',
                durationMs: 15,
                attributes: { errorKind: 'unknown', action: 'write' },
            },
            { metrics, bus },
        );

        const gauges = metrics.getGauges();
        const summary = metrics.getSummary();
        const activity = runtime.getActivity();
        const traces = runtime.getRecentTraces(10);

        assert.equal(summary.counters['sdk.operation.session.fs.writeFile.total'], 1);
        assert.equal(summary.counters['sdk.operation.session.fs.writeFile.failed'], 1);
        assert.equal(summary.counters['sdk.operation.session.fs.writeFile.error_kind.unknown'], 1);
        assert.equal(summary.counters['sdk.operation.session.fs.writeFile.action.write'], 1);
        assert.equal(gauges['sdk.operation.session.fs.writeFile.last_duration_ms']?.value, 15);
        assert.equal(bus.count('sdk:operation:metric'), 1);
        assert.equal(activity.lastEventType, 'sdk:operation:metric');
        assert.ok(traces.some((entry) => entry.type === 'sdk:operation:metric'));

        runtime.detach();
    });

    it('projeta fase e bytes de convergência SDK↔FS em counters/gauges', () => {
        const metrics = createMetricsStore();
        const convergenceTraceStore = createConvergenceTraceStore();

        projectSdkOperationMetric(
            {
                operation: 'workspace.promote',
                status: 'succeeded',
                sessionId: 'sess-fs-002',
                attributes: { traceId: 'trace-bridge-1', phase: 'write_sdk', bytes: 42 },
            },
            { metrics, convergenceTraceStore },
        );

        const summary = metrics.getSummary();
        const gauges = metrics.getGauges();
        const traceSnapshot = convergenceTraceStore.getSnapshot({ traceId: 'trace-bridge-1' });

        assert.equal(summary.counters['sdk.operation.workspace.promote.phase.write_sdk.total'], 1);
        assert.equal(summary.counters['sdk.operation.workspace.promote.phase.write_sdk.succeeded'], 1);
        assert.equal(summary.counters['sdk.operation.workspace.promote.bytes_total'], 42);
        assert.equal(gauges['sdk.operation.workspace.promote.last_bytes']?.value, 42);
        assert.equal(traceSnapshot.selectedTrace?.phases['write_sdk']?.succeeded, 1);
        assert.equal(traceSnapshot.selectedTrace?.bytes, 42);
    });
});
