// @ts-check
/**
 * Snapshot operacional de I/O local: cache tiers, parser e scopes ativos.
 *
 * Este módulo só projeta estado; não executa leitura/escrita e não altera o funcionamento dos caches.
 *
 * @module copilot/infra/io-health
 */

import { getIoL2CacheStats } from './io-cache-l2-registry.js';
import { aggregateIoCacheTierStats, buildIoCacheTierPlan } from './io-cache-tiering.js';
import { getIoCacheStats } from './io-cache.js';
import { getIoIndexStats } from './io-index-registry.js';
import { getParserCacheStats } from './io-parser.js';
import { getScopeStats, listScopes } from './io-session-scope.js';

/**
 * @returns {{
 *     generatedAt: number;
 *     cache: {
 *         l1: Record<string, unknown>;
 *         l2: Record<string, unknown>;
 *         l3: Record<string, unknown>;
 *         aggregate: ReturnType<typeof aggregateIoCacheTierStats>;
 *         plan: ReturnType<typeof buildIoCacheTierPlan>;
 *     };
 *     parser: ReturnType<typeof getParserCacheStats>;
 *     index: ReturnType<typeof getIoIndexStats>;
 *     scopes: {
 *         active: number;
 *         ids: string[];
 *         recent: Array<NonNullable<ReturnType<typeof getScopeStats>>>;
 *     };
 * }}
 */
export function readIoRuntimeHealthSnapshot() {
    const l1Stats = getIoCacheStats();
    const l1 = l1Stats
        ? { enabled: true, ...l1Stats }
        : {
              enabled: true,
              initialized: false,
              reason: 'not-initialized',
          };
    const l2 = getIoL2CacheStats();
    const l3 = {
        enabled: false,
        reason: 'reserved-for-multi-runtime-scale',
    };
    const aggregate = aggregateIoCacheTierStats({ l1, l2, l3 });
    const ids = listScopes();
    const recent = ids
        .slice(0, 10)
        .map((id) => getScopeStats(id))
        .filter((stats) => stats !== null);

    return {
        generatedAt: Date.now(),
        cache: {
            l1,
            l2,
            l3,
            aggregate,
            plan: buildIoCacheTierPlan({
                l1Enabled: true,
                l2Enabled: Boolean(l2?.['enabled']),
                l3Enabled: false,
                readHotsetRatio: aggregate.hitRatio,
            }),
        },
        index: getIoIndexStats(),
        parser: getParserCacheStats(),
        scopes: {
            active: ids.length,
            ids,
            recent,
        },
    };
}
