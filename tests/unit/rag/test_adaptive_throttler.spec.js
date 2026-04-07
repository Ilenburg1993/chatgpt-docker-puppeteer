// @ts-check
import assert from 'node:assert';

import { AdaptiveThrottler, createRagAdaptiveThrottler } from '../../../tools/rag/lib/adaptive_throttler.mjs';

describe('AdaptiveThrottler', () => {
    it('slows down when sampled CPU is above target threshold', async () => {
        const throttler = new AdaptiveThrottler({
            targetCPU: 70,
            minDelay: 0,
            maxDelay: 200,
            initialDelay: 50,
            sampleSize: 3,
        });
        throttler.getCPUUsage = () => 95;
        throttler.maybeLogAdjustment = () => {};

        const before = throttler.getStats().currentDelay;
        const result = await throttler.throttle();
        const after = throttler.getStats().currentDelay;

        assert.strictEqual(result.action, 'slowdown');
        assert.ok(after > before, `expected delay increase, got ${before} -> ${after}`);
    });

    it('speeds up when sampled CPU is comfortably below target threshold', async () => {
        const throttler = new AdaptiveThrottler({
            targetCPU: 72,
            minDelay: 20,
            maxDelay: 300,
            initialDelay: 120,
            sampleSize: 3,
        });
        throttler.getCPUUsage = () => 18;
        throttler.maybeLogAdjustment = () => {};

        const before = throttler.getStats().currentDelay;
        const result = await throttler.throttle();
        const after = throttler.getStats().currentDelay;

        assert.strictEqual(result.action, 'speedup');
        assert.ok(after < before, `expected delay decrease, got ${before} -> ${after}`);
    });

    it('builds throttler from environment knobs', () => {
        const prev = {
            enabled: process.env.RAG_THROTTLE_ENABLED,
            metric: process.env.RAG_THROTTLE_METRIC,
            target: process.env.RAG_THROTTLE_TARGET_CPU,
            minDelay: process.env.RAG_THROTTLE_MIN_DELAY_MS,
            maxDelay: process.env.RAG_THROTTLE_MAX_DELAY_MS,
        };
        try {
            process.env.RAG_THROTTLE_ENABLED = 'true';
            process.env.RAG_THROTTLE_METRIC = 'system';
            process.env.RAG_THROTTLE_TARGET_CPU = '68';
            process.env.RAG_THROTTLE_MIN_DELAY_MS = '45';
            process.env.RAG_THROTTLE_MAX_DELAY_MS = '3500';

            const throttler = createRagAdaptiveThrottler({ mode: 'incremental' });
            const stats = throttler.getStats();

            assert.strictEqual(stats.enabled, true);
            assert.strictEqual(stats.metric, 'system');
            assert.strictEqual(stats.targetCPU, 68);
            assert.strictEqual(stats.minDelay, 45);
            assert.strictEqual(stats.maxDelay, 3500);
        } finally {
            if (prev.enabled === undefined) delete process.env.RAG_THROTTLE_ENABLED;
            else process.env.RAG_THROTTLE_ENABLED = prev.enabled;
            if (prev.metric === undefined) delete process.env.RAG_THROTTLE_METRIC;
            else process.env.RAG_THROTTLE_METRIC = prev.metric;
            if (prev.target === undefined) delete process.env.RAG_THROTTLE_TARGET_CPU;
            else process.env.RAG_THROTTLE_TARGET_CPU = prev.target;
            if (prev.minDelay === undefined) delete process.env.RAG_THROTTLE_MIN_DELAY_MS;
            else process.env.RAG_THROTTLE_MIN_DELAY_MS = prev.minDelay;
            if (prev.maxDelay === undefined) delete process.env.RAG_THROTTLE_MAX_DELAY_MS;
            else process.env.RAG_THROTTLE_MAX_DELAY_MS = prev.maxDelay;
        }
    });
});
