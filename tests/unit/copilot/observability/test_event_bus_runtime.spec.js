// @ts-check
import * as assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import { createEventBus } from '../../../../src/copilot/core/event-bus.js';
import { createObservabilityBusRuntime } from '../../../../src/copilot/observability/event-bus-runtime.js';
import { createMetricsStore } from '../../../../src/copilot/observability/metrics.js';

describe('observability/event-bus-runtime', () => {
    /** @type {ReturnType<typeof createEventBus>} */
    let bus;

    beforeEach(() => {
        bus = createEventBus();
    });

    it('anexa ações canônicas de observabilidade ao EventBus', () => {
        const runtime = createObservabilityBusRuntime({ bus, metrics: createMetricsStore() });
        const diagnostics = runtime.diagnostics();

        assert.equal(diagnostics.attached, true);
        assert.ok(diagnostics.actions.includes('logObserver'));
        assert.ok(diagnostics.actions.includes('metricsCollector'));
        assert.ok(diagnostics.actions.includes('healthUpdater'));
        assert.ok(diagnostics.actions.includes('activityTracker'));
        assert.ok(diagnostics.actions.includes('correlationTracer'));
        assert.ok(diagnostics.actions.includes('errorAlerter'));

        runtime.detach();
    });

    it('atualiza métricas, health e traces a partir do mesmo runtime', () => {
        const metrics = createMetricsStore();
        const runtime = createObservabilityBusRuntime({ bus, metrics });

        bus.emit({ type: 'agent:task:error', timestamp: 100, correlationId: 'corr-1' });
        bus.emit({
            type: 'agent:dialog:turn_end',
            timestamp: 150,
            durationMs: 42,
            reply: 'ok',
            correlationId: 'corr-1',
        });

        const health = runtime.getHealth();
        const activity = runtime.getActivity();
        const traces = runtime.getTraces('corr-1');
        const summary = metrics.getSummary();

        assert.equal(health.score, 92);
        assert.equal(activity.lastEventType, 'agent:dialog:turn_end');
        assert.equal(activity.eventCount, 1);
        assert.equal(traces.length, 2);
        assert.equal(summary.tasks.failed, 1);
        assert.equal(summary.dialog.turnsTotal, 1);

        runtime.detach();
    });

    it('detach interrompe a observação do EventBus', () => {
        const runtime = createObservabilityBusRuntime({ bus, metrics: createMetricsStore() });
        runtime.detach();

        bus.emit({ type: 'agent:session:fatal', timestamp: 1 });

        const diagnostics = runtime.diagnostics();
        assert.equal(diagnostics.attached, false);
        assert.equal(diagnostics.health.score, 100);
    });
});
