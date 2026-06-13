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
import { getIoLockStats } from './io-locks.js';
import { getIoDurabilityStats, getIoLatencyStats } from './io-observability.js';
import { getLineOffsetCacheStats } from './io/fs/line-offset-cache.js';
import { getParserCacheStats } from './io-parser.js';
import { getScopeStats, listScopes } from './io-session-scope.js';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

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
                error: isError(error) ? /** @type {Error} */ (error).message : String(error),
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
 *         l2State: {
 *             circuitOpen: boolean;
 *             circuitOpenUntilMs: number | null;
 *             circuitRemainingMs: number;
 *             initFailCount: number;
 *             lastInitError: string | null;
 *             lastInitErrorAtMs: number | null;
 *         };
 *         l3: Record<string, unknown>;
 *         lineOffsets: ReturnType<typeof getLineOffsetCacheStats>;
 *         aggregate: ReturnType<typeof aggregateIoCacheTierStats>;
 *         plan: ReturnType<typeof buildIoCacheTierPlan>;
 *     };
 *     parser: ReturnType<typeof getParserCacheStats>;
 *     index: ReturnType<typeof getIoIndexStats>;
 *     latency: ReturnType<typeof getIoLatencyStats>;
 *     durability: ReturnType<typeof getIoDurabilityStats>;
 *     locks: ReturnType<typeof getIoLockStats>;
 *     alerts: { code: string; severity: string; message: string }[];
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

    const circuitOpen =
        Boolean(l2 && typeof l2 === 'object' && 'reason' in l2) &&
        /** @type {{ reason?: string }} */ (l2).reason === 'circuit-open';
    const l2CircuitOpenUntilMs =
        l2 && typeof l2 === 'object' && 'circuitOpenUntilMs' in l2
            ? Number(/** @type {{ circuitOpenUntilMs?: number }} */ (l2).circuitOpenUntilMs ?? 0)
            : 0;
    const l2State = {
        circuitOpen,
        circuitOpenUntilMs: l2CircuitOpenUntilMs > 0 ? l2CircuitOpenUntilMs : null,
        circuitRemainingMs: Math.max(0, l2CircuitOpenUntilMs - Date.now()),
        initFailCount:
            l2 && typeof l2 === 'object' && 'initFailCount' in l2
                ? Number(/** @type {{ initFailCount?: number }} */ (l2).initFailCount ?? 0)
                : 0,
        lastInitError:
            l2 && typeof l2 === 'object' && 'lastInitError' in l2
                ? String(/** @type {{ lastInitError?: string }} */ (l2).lastInitError ?? '') || null
                : null,
        lastInitErrorAtMs:
            l2 && typeof l2 === 'object' && 'lastInitErrorAtMs' in l2
                ? Number(/** @type {{ lastInitErrorAtMs?: number }} */ (l2).lastInitErrorAtMs ?? 0) || null
                : null,
    };
    const durability = safeCall(getIoDurabilityStats, {
        operationsObserved: 0,
        operationsWithMetadata: 0,
        fileFlushRequested: 0,
        modes: { none: 0, file: 0, 'file-and-directory': 0 },
        fileSync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0 },
        directorySync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0 },
        lastFailure: null,
    });
    const locks = getIoLockStats();
    const alerts = [];
    if (circuitOpen) {
        alerts.push({
            code: 'IO_L2_CIRCUIT_OPEN',
            severity: 'high',
            message: 'L2 cache em circuit-open; runtime operando predominantemente em L1.',
        });
    }
    if (durability.fileSync.failed > 0 || durability.directorySync.failed > 0) {
        alerts.push({
            code: 'IO_DURABILITY_SYNC_FAILED',
            severity: 'high',
            message: 'Ao menos uma falha real de file/directory sync foi observada no runtime.',
        });
    }
    if (locks.timeouts > 0 || locks.fileLocks.timeouts > 0) {
        alerts.push({
            code: 'IO_LOCK_TIMEOUT_OBSERVED',
            severity: 'medium',
            message: 'Ao menos um timeout de aquisição L0/L1 foi observado no runtime.',
        });
    }
    if (!locks.fileLocks.configurationValid) {
        alerts.push({
            code: 'IO_LOCK_PROFILE_INVALID',
            severity: 'high',
            message: 'COPILOT_IO_FILE_LOCKS_ENABLED possui um perfil inválido; ativações automáticas estão desabilitadas.',
        });
    }

    return {
        generatedAt: Date.now(),
        cache: {
            l1,
            l2,
            l2State,
            l3,
            lineOffsets: safeCall(getLineOffsetCacheStats, {
                hits: 0,
                misses: 0,
                sets: 0,
                stale: 0,
                evictions: 0,
                clears: 0,
                bypasses: 0,
                busInvalidations: 0,
                enabled: true,
                recursiveInvalidations: 0,
                size: 0,
                maxEntries: 0,
                maxTextChars: 0,
            }),
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
        parser: safeCall(getParserCacheStats, {
            size: 0,
            maxSize: 500,
            fileContext: {
                enabled: false,
                size: 0,
                maxSize: 0,
                hits: 0,
                misses: 0,
                sets: 0,
                clears: 0,
                bypasses: 0,
            },
            maxParseDurationMs: 0,
            maxParseLines: 0,
            workerEnabled: false,
            workerPoolSize: 0,
            workerPoolSizeSource: 'adaptive',
            availableParallelism: 1,
            workerRequestTimeoutMs: 0,
            workerPoolInitialized: false,
            workerPoolDisabledByError: false,
            workerPoolShuttingDown: false,
            budgetExceeded: 0,
            skippedByLineGuard: 0,
            lastParseDurationMs: 0,
            workerRequests: 0,
            workerTimeouts: 0,
            workerFailures: 0,
            workerFallbacks: 0,
        }),
        latency: safeCall(getIoLatencyStats, {}),
        durability,
        locks,
        alerts,
        scopes: {
            active: ids.length,
            ids,
            recent,
        },
    };
}
