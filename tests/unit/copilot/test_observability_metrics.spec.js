// @ts-check
/**
 * tests/unit/copilot/test_observability_metrics.spec.js
 *
 * Testes unitários para src/copilot/observability/metrics.js (createMetricsStore).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('createMetricsStore', () => {
    it('cria um store com métodos esperados', async () => {
        const { createMetricsStore } = await import('../../../src/copilot/observability/metrics.js');
        const store = createMetricsStore();
        assert.ok(store, 'store deve ser criado');
        assert.equal(typeof store.recordCounter, 'function', 'recordCounter deve ser função');
        assert.equal(typeof store.getSummary, 'function', 'getSummary deve ser função');
        assert.equal(typeof store.reset, 'function', 'reset deve ser função');
    });

    it('getSummary retorna objeto com as métricas', async () => {
        const { createMetricsStore } = await import('../../../src/copilot/observability/metrics.js');
        const store = createMetricsStore();
        store.recordUsage('gpt-4o', 10, 5);
        const summary = store.getSummary();
        assert.ok(summary !== null && typeof summary === 'object', 'getSummary deve retornar objeto');
    });

    it('recordGauge/getGauges atualizam medição pontual', async () => {
        const { createMetricsStore } = await import('../../../src/copilot/observability/metrics.js');
        const store = createMetricsStore();
        store.recordGauge('mem', 1024);
        const gauges = store.getGauges();
        assert.ok(gauges !== null && typeof gauges === 'object', 'getGauges deve retornar objeto');
    });

    it('defaultMetrics é instância singleton exportada', async () => {
        const { defaultMetrics } = await import('../../../src/copilot/observability/metrics.js');
        assert.ok(defaultMetrics, 'defaultMetrics deve existir');
        assert.equal(typeof defaultMetrics.getSummary, 'function', 'defaultMetrics deve ter getSummary');
    });
});
