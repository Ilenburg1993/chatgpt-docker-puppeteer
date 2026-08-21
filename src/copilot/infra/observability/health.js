// @ts-check
/**
 * Snapshot operacional de I/O local: cache tiers, parser e scopes ativos.
 *
 * Este módulo só projeta estado; não executa leitura/escrita e não altera o funcionamento dos caches.
 *
 * @module copilot/infra/observability/health
 */

import { getIoPathPolicyCacheStats } from '#copilot/core';
import {
    aggregateIoCacheTierStats,
    buildIoCacheTierPlan,
    getIoCacheStats,
    getIoL2CacheStats,
} from '#copilot/infra/internal/cache';
import { getIoLockStats } from '#copilot/infra/internal/concurrency/locks';
import {
    getByteLineIndexStats,
    getIoReadHashStats,
    getLineOffsetCacheStats,
} from '#copilot/infra/internal/filesystem/read';
import {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
} from '#copilot/infra/internal/filesystem/workspace';
import { getIoIndexAutoRefreshStats, getIoIndexStats } from '#copilot/infra/internal/indexing';
import { getScopeStats, listScopes } from '#copilot/infra/internal/indexing/context';
import { getParserCacheStats } from '#copilot/infra/internal/indexing/parser';
import {
    getIoAdvisoryBudgetStats,
    getIoDurabilityStats,
    getIoLatencyStats,
    getIoMutationStateStats,
} from '#copilot/infra/internal/telemetry';
import { buildIoRuntimeAlerts } from './alerts.js';
import { readCoherenceHealthStats } from './coherence-health.js';
import { healthErrorMessage, safeHealthCall } from './safe-call.js';

/** @returns {ReturnType<typeof getParserCacheStats> | { error: string }} */
function readParserHealthStats() {
    try {
        return getParserCacheStats();
    } catch (error) {
        return { error: healthErrorMessage(error) };
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
 *         byteLineIndex: ReturnType<typeof getByteLineIndexStats>;
 *         readHashes: ReturnType<typeof getIoReadHashStats>;
 *         pathPolicy: ReturnType<typeof getIoPathPolicyCacheStats>;
 *         coherence: ReturnType<typeof readCoherenceHealthStats>;
 *         validatedReadPath: ReturnType<typeof getValidatedReadWorkspacePathStats>;
 *         validatedMutablePath: ReturnType<typeof getValidatedMutableWorkspacePathStats>;
 *         aggregate: ReturnType<typeof aggregateIoCacheTierStats>;
 *         plan: ReturnType<typeof buildIoCacheTierPlan>;
 *     };
 *     parser: ReturnType<typeof getParserCacheStats> | { error: string };
 *     index: ReturnType<typeof getIoIndexStats>;
 *     latency: ReturnType<typeof getIoLatencyStats>;
 *     durability: ReturnType<typeof getIoDurabilityStats>;
 *     mutationState: ReturnType<typeof getIoMutationStateStats>;
 *     advisoryBudget: ReturnType<typeof getIoAdvisoryBudgetStats>;
 *     locks: ReturnType<typeof getIoLockStats>;
 *     alerts: { code: string; severity: string; message: string }[];
 *     scopes: {
 *         active: number;
 *         ready: number;
 *         warming: number;
 *         stale: number;
 *         degraded: number;
 *         ids: string[];
 *         recent: Array<NonNullable<ReturnType<typeof getScopeStats>>>;
 *     };
 * }}
 */
export function readIoRuntimeHealthSnapshot() {
    const l1Stats = safeHealthCall(getIoCacheStats, null);
    const l1 = l1Stats
        ? { enabled: true, ...l1Stats }
        : {
              enabled: true,
              initialized: false,
              reason: 'not-initialized',
          };
    const l2 = safeHealthCall(getIoL2CacheStats, {
        enabled: false,
        reason: 'error',
    });
    const l3 = {
        enabled: false,
        reason: 'reserved-for-multi-runtime-scale',
    };
    const aggregate = aggregateIoCacheTierStats({ l1, l2, l3 });
    const ids = safeHealthCall(listScopes, []);
    const allScopeStats = ids
        .map((id) => safeHealthCall(() => getScopeStats(id), null))
        .filter((stats) => stats !== null);
    const recent = allScopeStats.slice(0, 10);

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
    const coherence = readCoherenceHealthStats();
    const durability = safeHealthCall(getIoDurabilityStats, {
        operationsObserved: 0,
        operationsWithMetadata: 0,
        fileFlushRequested: 0,
        modes: { none: 0, file: 0, 'file-and-directory': 0 },
        fileSync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0, totalDurationMs: 0, maxDurationMs: 0 },
        directorySync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0, totalDurationMs: 0, maxDurationMs: 0 },
        atomicWritePhases: {
            observed: 0,
            tempPathMs: 0,
            capacityPreflightMs: 0,
            tempWriteMs: 0,
            modeApplyMs: 0,
            fileSyncMs: 0,
            prePublishCheckMs: 0,
            publishMs: 0,
            directorySyncMs: 0,
            totalMs: 0,
        },
        lastFailure: null,
    });
    const mutationState = safeHealthCall(getIoMutationStateStats, {
        appliedButUnconfirmed: 0,
        byOperation: {},
        last: null,
    });
    const locks = getIoLockStats();
    const advisoryBudget = getIoAdvisoryBudgetStats();
    const { alerts, scopeStatusCounts } = buildIoRuntimeAlerts({
        scopes: allScopeStats,
        l2: /** @type {Record<string, unknown>} */ (l2),
        circuitOpen,
        mutationState,
        durability,
        locks,
        coherence: /** @type {ReturnType<typeof readCoherenceHealthStats> & Record<string, unknown>} */ (coherence),
        advisoryBudget,
    });

    return {
        generatedAt: Date.now(),
        cache: {
            l1,
            l2,
            l2State,
            l3,
            lineOffsets: safeHealthCall(getLineOffsetCacheStats, {
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
                rejected: 0,
                size: 0,
                sizeBytes: 0,
                maxEntries: 0,
                maxTextChars: 0,
                maxBytes: 0,
            }),
            byteLineIndex: safeHealthCall(getByteLineIndexStats, {
                hits: 0,
                hitPrevalidationElisions: 0,
                misses: 0,
                builds: 0,
                extensions: 0,
                partialBuilds: 0,
                fullBuilds: 0,
                stale: 0,
                evictions: 0,
                memoryEvictions: 0,
                indexBytesScanned: 0,
                rangeBytesRead: 0,
                capturedRangeReuses: 0,
                rangeBytesAvoided: 0,
                streamSeeds: 0,
                streamSeedBytes: 0,
                streamSeedPromotions: 0,
                busInvalidations: 0,
                recursiveInvalidations: 0,
                clears: 0,
                size: 0,
                sizeBytes: 0,
                maxEntries: 0,
                maxBytes: 0,
            }),
            readHashes: safeHealthCall(getIoReadHashStats, {
                reads: 0,
                hashComputations: 0,
                fullHashComputations: 0,
                returnedSliceHashComputations: 0,
                knownFullHashReuses: 0,
                fullWindowReturnedHashReuses: 0,
                fullHashOutputSkips: 0,
                returnedHashOutputSkips: 0,
            }),
            pathPolicy: safeHealthCall(getIoPathPolicyCacheStats, {
                hits: 0,
                misses: 0,
                sets: 0,
                expirations: 0,
                evictions: 0,
                bypasses: 0,
                invalidationEvents: 0,
                invalidatedEntries: 0,
                size: 0,
                ttlMs: 0,
                maxEntries: 0,
                policyVersion: 'unavailable',
            }),
            coherence,
            validatedReadPath: getValidatedReadWorkspacePathStats(),
            validatedMutablePath: getValidatedMutableWorkspacePathStats(),
            aggregate,
            plan: buildIoCacheTierPlan({
                l1Enabled: true,
                l2Enabled: Boolean(l2?.['enabled']),
                l3Enabled: false,
                readHotsetRatio: aggregate.hitRatio,
            }),
        },
        index: safeHealthCall(getIoIndexStats, {
            enabled: false,
            available: false,
            reason: 'error',
            autoRefresh: getIoIndexAutoRefreshStats(),
        }),
        parser: readParserHealthStats(),
        latency: safeHealthCall(getIoLatencyStats, {}),
        durability,
        mutationState,
        advisoryBudget,
        locks,
        alerts,
        scopes: {
            active: ids.length,
            ...scopeStatusCounts,
            ids,
            recent,
        },
    };
}
