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
 * }} [input]
 */
export function buildIoCacheTierPlan(input = {}) {
    const l1Enabled = input.l1Enabled !== false;
    const l2Enabled = input.l2Enabled === true;
    const l3Enabled = input.l3Enabled === true;

    const workspaceFiles = Number.isFinite(input.workspaceFiles) ? Number(input.workspaceFiles) : 0;
    const readHotsetRatio = Number.isFinite(input.readHotsetRatio) ? Number(input.readHotsetRatio) : 0;

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

    if (!l2Enabled && workspaceFiles > 3000) {
        recommendations.push('Consider enabling L2: workspace file count is high.');
    }
    if (!l2Enabled && readHotsetRatio < 0.1) {
        recommendations.push('Read hotset ratio is low: evaluate enabling L2 and reviewing cache sizing/workload.');
    }
    if (l2Enabled && !l3Enabled && workspaceFiles > 20000) {
        recommendations.push('Prepare L3 design for multi-runtime sharing and cold-start reduction.');
    }

    return {
        tierOrder: [...TIER_ORDER],
        tiers,
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
