// @ts-check
/**
 * tests/unit/copilot/test_observability_histogram.spec.js
 *
 * Testes unitários para src/copilot/observability/metrics-histogram.js.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('createHistogram', () => {
    it('cria histogram com métodos esperados', async () => {
        const { createHistogram } = await import('../../../src/copilot/observability/metrics-histogram.js');
        const h = createHistogram(100);
        assert.ok(h, 'histogram deve ser criado');
        assert.equal(typeof h.record, 'function', 'record deve ser função');
        assert.equal(typeof h.snapshot, 'function', 'snapshot deve ser função');
    });

    it('snapshot retorna objeto com p50/p95/p99 após records', async () => {
        const { createHistogram } = await import('../../../src/copilot/observability/metrics-histogram.js');
        const h = createHistogram(100);
        for (let i = 1; i <= 10; i++) {
            h.record(i * 10);
        }
        const s = h.snapshot();
        assert.ok(s !== null && typeof s === 'object', 'snapshot deve retornar objeto');
        assert.ok('p50' in s, 'Deve ter p50');
        assert.ok('p99' in s, 'Deve ter p99');
    });

    it('snapshot de histogram vazio retorna null ou objeto', async () => {
        const { createHistogram } = await import('../../../src/copilot/observability/metrics-histogram.js');
        const h = createHistogram(100);
        const s = h.snapshot();
        assert.ok(s === null || typeof s === 'object', 'snapshot vazio deve ser null ou objeto');
    });

    it('percentile é função utilitária exportada', async () => {
        const { percentile } = await import('../../../src/copilot/observability/metrics-histogram.js');
        assert.equal(typeof percentile, 'function', 'percentile deve ser função exportada');
    });

    it('percentile retorna número', async () => {
        const { percentile } = await import('../../../src/copilot/observability/metrics-histogram.js');
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const p50 = percentile(values, 0.5);
        assert.ok(typeof p50 === 'number', 'percentile deve retornar número');
    });
});
