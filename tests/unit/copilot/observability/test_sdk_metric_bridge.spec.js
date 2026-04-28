// @ts-check
import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createEventBus } from '../../../../src/copilot/core/event-bus.js';
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
});
