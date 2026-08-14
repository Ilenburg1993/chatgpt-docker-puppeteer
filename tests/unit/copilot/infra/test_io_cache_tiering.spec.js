import { describe, expect, it } from 'vitest';

import { aggregateIoCacheTierStats, buildIoCacheTierPlan } from '#copilot/infra/io-cache-tiering';

describe('io-cache-tiering', () => {
    it('builds a conservative tier plan by default', () => {
        const plan = buildIoCacheTierPlan();

        expect(plan.tiers.l1.enabled).toBe(true);
        expect(plan.tiers.l2.enabled).toBe(false);
        expect(plan.tiers.l3.enabled).toBe(false);
        expect(Array.isArray(plan.recommendations)).toBe(true);
    });

    it('requires representative evidence before recommending L2 enablement', () => {
        const plan = buildIoCacheTierPlan({ workspaceFiles: 5000, readHotsetRatio: 0.05 });
        expect(plan.l2Decision).toBe('benchmark-required');
        expect(plan.evidence.representativeBenchmarkPassed).toBe(false);
        expect(plan.recommendations.some((entry) => entry.includes('evidence-gated'))).toBe(true);
    });

    it('supports L2 promotion only after a representative benchmark passes', () => {
        const plan = buildIoCacheTierPlan({
            workspaceFiles: 5000,
            readHotsetRatio: 0.05,
            representativeBenchmarkPassed: true,
        });
        expect(plan.l2Decision).toBe('enable-supported-by-benchmark');
        expect(plan.recommendations.some((entry) => entry.includes('experimental profile'))).toBe(true);
    });

    it('aggregates hit/miss across tiers', () => {
        const agg = aggregateIoCacheTierStats({
            l1: { hits: 10, misses: 2 },
            l2: { hits: 3, misses: 4 },
            l3: { hits: 7, misses: 1 },
        });

        expect(agg.hits).toBe(20);
        expect(agg.misses).toBe(7);
        expect(agg.hitRatio).toBeCloseTo(20 / 27, 6);
    });
});
