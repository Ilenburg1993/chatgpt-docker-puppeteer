// @ts-check
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
    AutoDowngradeDetector,
    COST_ORDER,
    KNOWN_MODELS,
    ModelRegistry,
    ModelSelector,
    ModelStatsTracker,
    SPEED_ORDER,
} from '../../../src/copilot/lib/model-registry.js';

describe('ModelRegistry (F40.1)', () => {
    /** @type {InstanceType<typeof ModelRegistry>} */
    let registry;

    beforeEach(() => {
        registry = new ModelRegistry();
    });

    it('loads known models on construction', () => {
        const all = registry.all();
        assert.ok(
            all.length >= KNOWN_MODELS.length,
            `Expected at least ${KNOWN_MODELS.length} models but got ${all.length}`,
        );
    });

    it('retrieves model by id', () => {
        const meta = registry.get('gpt-4.1');
        assert.ok(meta);
        assert.equal(meta.id, 'gpt-4.1');
        assert.equal(meta.costTier, 'medium');
        assert.equal(meta.speedTier, 'fast');
    });

    it('resolves alias to canonical id', () => {
        assert.equal(registry.resolveId('nano'), 'gpt-4.1-nano');
        assert.equal(registry.resolveId('sonnet'), 'claude-sonnet-4');
    });

    it('retrieves model by alias', () => {
        const meta = registry.get('nano');
        assert.ok(meta);
        assert.equal(meta.id, 'gpt-4.1-nano');
    });

    it('returns undefined for unknown model', () => {
        assert.equal(registry.get('nonexistent-model'), undefined);
    });

    it('registers a custom model', () => {
        registry.register({
            id: 'custom-1',
            costTier: 'low',
            speedTier: 'fast',
            contextWindow: 64_000,
            supportsReasoning: false,
            supportsVision: false,
            aliases: ['custom'],
        });
        const meta = registry.get('custom-1');
        assert.ok(meta);
        assert.equal(meta.costTier, 'low');
        assert.equal(registry.resolveId('custom'), 'custom-1');
    });

    it('enrichFromSdk handles known model', () => {
        const result = registry.enrichFromSdk([{ id: 'gpt-4.1' }]);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'gpt-4.1');
        assert.equal(result[0].costTier, 'medium');
    });

    it('enrichFromSdk infers metadata for unknown model', () => {
        const result = registry.enrichFromSdk([
            {
                id: 'new-model-x',
                capabilities: { supports: { reasoningEffort: true, vision: false } },
            },
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'new-model-x');
        assert.equal(result[0].supportsReasoning, true);
        assert.equal(result[0].supportsVision, false);
        // Now accessible in registry
        assert.ok(registry.get('new-model-x'));
    });

    it('filters by requireReasoning', () => {
        const models = registry.filter({ requireReasoning: true });
        assert.ok(models.length > 0);
        for (const m of models) assert.ok(m.supportsReasoning, `${m.id} should support reasoning`);
    });

    it('filters by requireVision', () => {
        const models = registry.filter({ requireVision: true });
        assert.ok(models.length > 0);
        for (const m of models) assert.ok(m.supportsVision, `${m.id} should support vision`);
    });

    it('filters by minContextWindow', () => {
        const models = registry.filter({ minContextWindow: 500_000 });
        for (const m of models) assert.ok(m.contextWindow >= 500_000, `${m.id} ctx=${m.contextWindow}`);
    });

    it('filters by exclude', () => {
        const models = registry.filter({ exclude: ['gpt-4.1', 'o3'] });
        const ids = models.map((m) => m.id);
        assert.ok(!ids.includes('gpt-4.1'));
        assert.ok(!ids.includes('o3'));
    });
});

describe('ModelStatsTracker (F40.4)', () => {
    /** @type {InstanceType<typeof ModelStatsTracker>} */
    let tracker;

    beforeEach(() => {
        tracker = new ModelStatsTracker();
    });

    it('returns null for unknown model', () => {
        assert.equal(tracker.getStats('unknown'), null);
    });

    it('records and retrieves stats', () => {
        tracker.record('gpt-4o', { latencyMs: 1000, success: true, inputTokens: 100, outputTokens: 50 });
        tracker.record('gpt-4o', { latencyMs: 2000, success: true, inputTokens: 200, outputTokens: 100 });
        tracker.record('gpt-4o', { latencyMs: 3000, success: false, inputTokens: 50, outputTokens: 0 });

        const s = tracker.getStats('gpt-4o');
        assert.ok(s);
        assert.equal(s.totalCalls, 3);
        assert.equal(s.avgLatencyMs, 2000); // (1000+2000+3000)/3
        assert.equal(s.successRate, 2 / 3);
        assert.equal(s.totalTokens, 500); // 100+50+200+100+50+0
    });

    it('allStats returns all tracked models', () => {
        tracker.record('m1', { latencyMs: 100, success: true });
        tracker.record('m2', { latencyMs: 200, success: false });
        const all = tracker.allStats();
        assert.equal(all.length, 2);
        const ids = all.map((s) => s.modelId).sort();
        assert.deepEqual(ids, ['m1', 'm2']);
    });

    it('reset clears all stats', () => {
        tracker.record('m1', { latencyMs: 100, success: true });
        tracker.reset();
        assert.equal(tracker.getStats('m1'), null);
        assert.equal(tracker.allStats().length, 0);
    });
});

describe('ModelSelector (F40.2)', () => {
    /** @type {InstanceType<typeof ModelRegistry>} */
    let registry;
    /** @type {InstanceType<typeof ModelStatsTracker>} */
    let stats;
    /** @type {InstanceType<typeof ModelSelector>} */
    let selector;

    beforeEach(() => {
        registry = new ModelRegistry();
        stats = new ModelStatsTracker();
        selector = new ModelSelector(registry, stats);
    });

    it('selects preferred model when available', () => {
        const result = selector.select({ prefer: 'gpt-4.1' });
        assert.ok(result);
        assert.equal(result.id, 'gpt-4.1');
    });

    it('returns cheapest model with preferLowCost', () => {
        const result = selector.select({ preferLowCost: true });
        assert.ok(result);
        // free or low cost should be prioritized
        assert.ok(
            COST_ORDER[result.costTier] <= 1,
            `Expected free or low cost, got ${result.costTier} for ${result.id}`,
        );
    });

    it('returns fastest model with preferFast', () => {
        const result = selector.select({ preferFast: true });
        assert.ok(result);
        assert.equal(result.speedTier, 'fast');
    });

    it('considers historical metrics in scoring', () => {
        // Make gpt-4o-mini very fast and successful in stats
        stats.record('gpt-4o-mini', { latencyMs: 500, success: true });
        stats.record('gpt-4o-mini', { latencyMs: 600, success: true });
        // Make gpt-4.1 slow
        stats.record('gpt-4.1', { latencyMs: 5000, success: true });
        stats.record('gpt-4.1', { latencyMs: 6000, success: false });

        const result = selector.select({ preferFast: true });
        assert.ok(result);
        // gpt-4o-mini should be prioritized due to better stats + fast tier
        assert.equal(result.id, 'gpt-4o-mini');
    });

    it('restricts to availableIds', () => {
        const result = selector.select({}, ['gpt-4o', 'o3']);
        assert.ok(result);
        assert.ok(['gpt-4o', 'o3'].includes(result.id));
    });

    it('returns undefined when no candidates match', () => {
        const result = selector.select({ requireReasoning: true, requireVision: true }, ['nonexistent']);
        assert.equal(result, undefined);
    });

    it('suggestFallback excludes current model', () => {
        const result = selector.suggestFallback('gpt-4.1');
        assert.ok(result);
        assert.notEqual(result.id, 'gpt-4.1');
    });

    it('topN returns at most N models', () => {
        const results = selector.topN({}, 2);
        assert.ok(results.length <= 2);
    });
});

describe('AutoDowngradeDetector (F40.6)', () => {
    /** @type {InstanceType<typeof ModelStatsTracker>} */
    let stats;
    /** @type {InstanceType<typeof AutoDowngradeDetector>} */
    let detector;

    beforeEach(() => {
        const registry = new ModelRegistry();
        stats = new ModelStatsTracker();
        const selector = new ModelSelector(registry, stats);
        detector = new AutoDowngradeDetector(stats, selector, {
            latencyThresholdMs: 3000,
            minSuccessRate: 0.6,
            minCalls: 2,
        });
    });

    it('does not downgrade with insufficient calls', () => {
        stats.record('gpt-4.1', { latencyMs: 9999, success: false }); // only 1 call
        const result = detector.evaluate('gpt-4.1');
        assert.equal(result.shouldDowngrade, false);
    });

    it('detects high latency and suggests downgrade', () => {
        stats.record('o3', { latencyMs: 5000, success: true });
        stats.record('o3', { latencyMs: 6000, success: true });
        const result = detector.evaluate('o3');
        assert.equal(result.shouldDowngrade, true);
        assert.ok(result.reason?.includes('latency_high'));
        assert.ok(result.suggestedModel);
        assert.notEqual(result.suggestedModel?.id, 'o3');
    });

    it('detects low success rate and suggests downgrade', () => {
        stats.record('gpt-4.1', { latencyMs: 500, success: false });
        stats.record('gpt-4.1', { latencyMs: 600, success: false });
        stats.record('gpt-4.1', { latencyMs: 400, success: false });
        const result = detector.evaluate('gpt-4.1');
        assert.equal(result.shouldDowngrade, true);
        assert.ok(result.reason?.includes('success_rate_low'));
        assert.ok(result.suggestedModel);
    });

    it('does not downgrade healthy model', () => {
        stats.record('gpt-4.1', { latencyMs: 800, success: true });
        stats.record('gpt-4.1', { latencyMs: 900, success: true });
        stats.record('gpt-4.1', { latencyMs: 700, success: true });
        const result = detector.evaluate('gpt-4.1');
        assert.equal(result.shouldDowngrade, false);
    });
});

describe('Module constants', () => {
    it('COST_ORDER has 5 tiers', () => {
        assert.equal(Object.keys(COST_ORDER).length, 5);
        assert.ok(COST_ORDER.free < COST_ORDER.premium);
    });

    it('SPEED_ORDER has 3 tiers', () => {
        assert.equal(Object.keys(SPEED_ORDER).length, 3);
        assert.ok(SPEED_ORDER.slow < SPEED_ORDER.fast);
    });

    it('KNOWN_MODELS is frozen', () => {
        assert.ok(Object.isFrozen(KNOWN_MODELS));
    });
});
