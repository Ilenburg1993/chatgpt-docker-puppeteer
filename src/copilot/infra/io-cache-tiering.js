// @ts-check

const TIER_ORDER = /** @type {const} */ (['l1', 'l2', 'l3']);

/**
 * @typedef {'l1' | 'l2' | 'l3'} IoCacheTier
 */

/**
 * @typedef {{
 *     enabled: boolean;
 *     reason: string;
 * }} TierStatus
 */

/**
 * @param {{
 *     l1Enabled?: boolean;
 *     l2Enabled?: boolean;
 *     l3Enabled?: boolean;
 *     workspaceFiles?: number;
 *     readHotsetRatio?: number;
 *     representativeBenchmarkPassed?: boolean | null;
 * }} [input]
 */
export function buildIoCacheTierPlan(input = {}) {
    const l1Enabled = input.l1Enabled !== false;
    const l2Enabled = input.l2Enabled === true;
    const l3Enabled = input.l3Enabled === true;

    const workspaceFiles = Number.isFinite(input.workspaceFiles) ? Number(input.workspaceFiles) : 0;
    const readHotsetRatio = Number.isFinite(input.readHotsetRatio) ? Number(input.readHotsetRatio) : 0;
    const representativeBenchmarkPassed = input.representativeBenchmarkPassed === true;

    /** @type {Record<IoCacheTier, TierStatus>} */
    const tiers = {
        l1: {
            enabled: l1Enabled,
            reason: l1Enabled ? 'fast in-process cache for hot reads' : 'disabled via config',
        },
        l2: {
            enabled: l2Enabled,
            reason: l2Enabled
                ? 'durable local cache for restart resilience'
                : 'prepared but disabled (enable when restart churn or miss-rate justifies)',
        },
        l3: {
            enabled: l3Enabled,
            reason: l3Enabled
                ? 'cross-session/distributed cache enabled'
                : 'reserved for multi-runtime scale (not required for current topology)',
        },
    };

    const recommendations = [];
    const l2PressureObserved = workspaceFiles > 3000 || readHotsetRatio < 0.1;
    let l2Decision = l2Enabled ? 'enabled' : 'keep-off';

    if (!l2Enabled && l2PressureObserved && !representativeBenchmarkPassed) {
        l2Decision = 'benchmark-required';
        recommendations.push(
            'L2 pressure signal observed, but enablement is evidence-gated: run a representative cold/warm workload benchmark before changing the default.',
        );
    }
    if (!l2Enabled && representativeBenchmarkPassed) {
        l2Decision = 'enable-supported-by-benchmark';
        recommendations.push('Representative benchmark supports L2 enablement; promote through the experimental profile first.');
    }
    if (l2Enabled && !l3Enabled && workspaceFiles > 20000) {
        recommendations.push('Prepare L3 design for multi-runtime sharing and cold-start reduction.');
    }

    return {
        tierOrder: [...TIER_ORDER],
        tiers,
        l2Decision,
        evidence: {
            representativeBenchmarkPassed,
            l2PressureObserved,
            workspaceFiles,
            readHotsetRatio,
        },
        recommendations,
    };
}

/**
 * @param {{ l1?: unknown; l2?: unknown; l3?: unknown }} stats
 */
export function aggregateIoCacheTierStats(stats = {}) {
    const l1 = /** @type {any} */ (typeof stats.l1 === 'object' && stats.l1 ? stats.l1 : {});
    const l2 = /** @type {any} */ (typeof stats.l2 === 'object' && stats.l2 ? stats.l2 : {});
    const l3 = /** @type {any} */ (typeof stats.l3 === 'object' && stats.l3 ? stats.l3 : {});

    const hits = Number(l1?.hits || 0) + Number(l2?.hits || 0) + Number(l3?.hits || 0);
    const misses = Number(l1?.misses || 0) + Number(l2?.misses || 0) + Number(l3?.misses || 0);

    return {
        hits,
        misses,
        hitRatio: hits + misses > 0 ? hits / (hits + misses) : 0,
        tiers: { l1, l2, l3 },
    };
}
