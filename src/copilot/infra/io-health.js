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
import { getIoLatencyStats } from './io-observability.js';
import { getParserCacheStats } from './io-parser.js';
import { getScopeStats, listScopes } from './io-session-scope.js';

/**
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
function safeCall(fn, fallback) {
    try {
        return fn();
    } catch (error) {
        if (fallback && typeof fallback === 'object') {
            return /** @type {T} */ ({
                .../** @type {Record<string, unknown>} */ (fallback),
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return fallback;
    }
}

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
 *     latency: ReturnType<typeof getIoLatencyStats>;
 *     scopes: {
 *         active: number;
 *         ids: string[];
 *         recent: Array<NonNullable<ReturnType<typeof getScopeStats>>>;
 *     };
 * }}
 */
export function readIoRuntimeHealthSnapshot() {
    const l1Stats = safeCall(getIoCacheStats, null);
    const l1 = l1Stats
        ? { enabled: true, ...l1Stats }
        : {
              enabled: true,
              initialized: false,
              reason: 'not-initialized',
          };
    const l2 = safeCall(getIoL2CacheStats, {
        enabled: false,
        reason: 'error',
    });
    const l3 = {
        enabled: false,
        reason: 'reserved-for-multi-runtime-scale',
    };
    const aggregate = aggregateIoCacheTierStats({ l1, l2, l3 });
    const ids = safeCall(listScopes, []);
    const recent = ids
        .slice(0, 10)
        .map((id) => safeCall(() => getScopeStats(id), null))
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
        index: safeCall(getIoIndexStats, {
            enabled: false,
            available: false,
            reason: 'error',
        }),
        parser: safeCall(getParserCacheStats, { size: 0, maxSize: 500 }),
        latency: safeCall(getIoLatencyStats, {}),
        scopes: {
            active: ids.length,
            ids,
            recent,
        },
    };
}
