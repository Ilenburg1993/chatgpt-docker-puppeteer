// @ts-check
/**
 * Snapshot operacional de I/O local: cache tiers, parser e scopes ativos.
 *
 * Este módulo só projeta estado; não executa leitura/escrita e não altera o funcionamento dos caches.
 *
 * @module copilot/infra/observability/health
 */

import { getIoPathPolicyCacheStats } from '#copilot/core';
import { aggregateIoCacheTierStats, buildIoCacheTierPlan } from '#copilot/infra/internal/cache';
import { getIoLockStats } from '#copilot/infra/internal/concurrency/locks';
import {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
} from '#copilot/infra/internal/filesystem/workspace';
import { readScopeRuntimeRegistrySnapshot } from '#copilot/infra/internal/indexing/context';
import { buildIoRuntimeAlerts } from './alerts.js';
import { readCoherenceHealthStats } from './coherence-health.js';
import { safeHealthCall } from './safe-call.js';

/**
 * Read a side-effect-free health projection from an explicitly owned InfraRuntime.
 *
 * @param {ReturnType<typeof import('../composition/runtime/index.js').createInfraRuntime>} runtime
 */
export function readIoRuntimeHealthSnapshot(runtime) {
    if (!runtime || typeof runtime !== 'object') {
        throw new TypeError('readIoRuntimeHealthSnapshot requires an explicit InfraRuntime.');
    }
    const coherenceSnapshot = runtime.coherence.snapshot();
    const readSnapshot = runtime.coherence.read.snapshot();
    const l1Stats = runtime.coherence.l1.stats();
    const l1 = l1Stats
        ? { enabled: true, ...l1Stats }
        : { enabled: true, initialized: false, reason: 'not-initialized' };
    const l2 = runtime.coherence.l2.snapshot();
    const l3 = { enabled: false, reason: 'reserved-for-multi-runtime-scale' };
    const aggregate = aggregateIoCacheTierStats({ l1, l2, l3 });
    const workspaceScopeRegistry = safeHealthCall(readScopeRuntimeRegistrySnapshot, {
        activeRuntimes: 0,
        activeScopes: 0,
        runtimes: [],
        scopes: [],
    });
    const allScopeStats = [...workspaceScopeRegistry.scopes];
    const ids = allScopeStats.map((stats) => stats.sessionId);
    const recent = allScopeStats.slice(0, 10);
    const l2State = {
        circuitOpen: l2.circuitOpenUntilMs !== null && l2.circuitRemainingMs > 0,
        circuitOpenUntilMs: l2.circuitOpenUntilMs,
        circuitRemainingMs: l2.circuitRemainingMs,
        initFailCount: l2.initFailCount,
        lastInitError: l2.lastInitError,
        lastInitErrorAtMs: l2.lastInitErrorAtMs,
    };
    const parser = runtime.parserCache.snapshot();
    const index = runtime.indexRegistry.status();
    const telemetry = runtime.telemetry.snapshot();
    const locks = getIoLockStats();
    const coherence = readCoherenceHealthStats(runtime);
    const { alerts, scopeStatusCounts } = buildIoRuntimeAlerts({
        scopes: allScopeStats,
        l2: /** @type {Record<string, unknown>} */ (l2),
        circuitOpen: l2State.circuitOpen,
        mutationState: telemetry.mutationState,
        durability: telemetry.durability,
        locks,
        coherence: /** @type {ReturnType<typeof readCoherenceHealthStats> & Record<string, unknown>} */ (coherence),
        advisoryBudget: telemetry.advisoryBudget,
    });
    const externalWatchers = runtime.listWorkspaces().flatMap((workspace) => workspace.externalWatchStats());

    return Object.freeze({
        generatedAt: Date.now(),
        runtimeId: runtime.runtimeId,
        cache: {
            l1,
            l2,
            l2State,
            l3,
            lineOffsets: readSnapshot.lineOffsets,
            byteLineIndex: readSnapshot.byteLineIndex,
            readHashes: readSnapshot.hashes,
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
                l2Enabled: l2.enabled,
                l3Enabled: false,
                readHotsetRatio: aggregate.hitRatio,
            }),
        },
        index,
        parser: { ...parser.symbol, fileContext: parser.fileContext },
        latency: telemetry.latency,
        durability: telemetry.durability,
        mutationState: telemetry.mutationState,
        advisoryBudget: telemetry.advisoryBudget,
        locks,
        alerts,
        scopes: {
            active: ids.length,
            ...scopeStatusCounts,
            ids,
            recent,
        },
        workspaces: Object.freeze({
            count: runtime.listWorkspaces().length,
            externalWatchers: Object.freeze(externalWatchers),
        }),
        coherenceRuntime: coherenceSnapshot,
    });
}
