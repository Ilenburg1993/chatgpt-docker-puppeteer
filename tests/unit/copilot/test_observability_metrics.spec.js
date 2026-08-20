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
        assert.equal(typeof store.recordDialogRecovery, 'function', 'recordDialogRecovery deve ser função');
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

    it('recordDialogRecovery separa reuso e chamadas adicionais de modelo, mantendo aliases legacy', async () => {
        const { createMetricsStore } = await import('../../../src/copilot/observability/metrics.js');
        const store = createMetricsStore();

        store.recordDialogRecovery('input_channel_missing', {
            strategy: 'restart_with_model_call',
            additionalModelCall: true,
            success: true,
            durationMs: 12,
        });
        store.recordDialogRecovery('ready_present', {
            strategy: 'reuse_ready',
            additionalModelCall: false,
            success: true,
            durationMs: 3,
        });

        const summary = store.getSummary();
        assert.equal(summary.dialogRecovery.total, 2);
        assert.equal(summary.dialogRecovery.withAdditionalModelCall, 1);
        assert.equal(summary.dialogRecovery.withoutAdditionalModelCall, 1);
        assert.equal(summary.dialogRecovery.pr, 1); // legacy alias
        assert.equal(summary.dialogRecovery.zeroPr, 1); // legacy alias
        assert.equal(summary.dialogRecovery.byStrategy['restart_with_model_call'], 1);
        assert.equal(summary.dialogRecovery.byStrategy['reuse_ready'], 1);
    });

    it('defaultMetrics é instância singleton exportada', async () => {
        const { defaultMetrics } = await import('../../../src/copilot/observability/metrics.js');
        assert.ok(defaultMetrics, 'defaultMetrics deve existir');
        assert.equal(typeof defaultMetrics.getSummary, 'function', 'defaultMetrics deve ter getSummary');
    });
});
