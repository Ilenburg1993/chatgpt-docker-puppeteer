// @ts-check
/**
 * Runtime-owned IO health projection.
 *
 * Process-global policies, locks and aggregate authority counters intentionally do not appear here. They belong to
 * `readIoProcessHealthSnapshot()`. This function reads only state owned by the supplied InfraRuntime and its workspaces.
 *
 * @module copilot/infra/observability/health
 */

import { aggregateIoCacheTierStats, buildIoCacheTierPlan } from '#copilot/infra/internal/cache';
import { readScopeRuntimeRegistrySnapshot } from '#copilot/infra/internal/indexing/context';
import { buildIoRuntimeAlerts } from './alerts.js';
import { readCoherenceHealthStats } from './coherence-health.js';
import { safeHealthCall } from './safe-call.js';

const MAX_WORKSPACE_AUTHORITY_SAMPLE = 20;

/** @param {ReturnType<typeof import('../composition/runtime/index.js').createInfraRuntime>['listWorkspaces'] extends () => infer T ? T : never} workspaces */
function projectWorkspaceAuthorities(workspaces) {
    const sample = workspaces.slice(0, MAX_WORKSPACE_AUTHORITY_SAMPLE).map((workspace) =>
        Object.freeze({
            workspaceId: workspace.workspaceId,
            ...workspace.authorityStats(),
        }),
    );
    return Object.freeze({
        ownerCount: workspaces.length,
        sample: Object.freeze(sample),
        truncated: workspaces.length > sample.length,
    });
}

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
    const workspaceScopeRegistry = safeHealthCall(
        () => readScopeRuntimeRegistrySnapshot({ runtimeOwnerId: runtime.runtimeId }),
        {
            activeProbes: 0,
            activeScopes: 0,
            probes: [],
            scopes: [],
        },
    );
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
    const coherence = readCoherenceHealthStats(runtime);
    const { alerts, scopeStatusCounts } = buildIoRuntimeAlerts({
        scopes: allScopeStats,
        l2: /** @type {Record<string, unknown>} */ (l2),
        circuitOpen: l2State.circuitOpen,
        indexAutoRefresh: /** @type {Record<string, unknown>} */ (index.autoRefresh ?? {}),
        mutationState: telemetry.mutationState,
        durability: telemetry.durability,
        coherence: /** @type {ReturnType<typeof readCoherenceHealthStats> & Record<string, unknown>} */ (coherence),
        advisoryBudget: telemetry.advisoryBudget,
    });
    const workspaces = runtime.listWorkspaces();

    return Object.freeze({
        generatedAt: Date.now(),
        scope: /** @type {const} */ ('runtime'),
        status: alerts.length > 0 ? /** @type {const} */ ('degraded') : /** @type {const} */ ('healthy'),
        runtimeId: runtime.runtimeId,
        cache: {
            l1,
            l2,
            l2State,
            l3,
            lineOffsets: readSnapshot.lineOffsets,
            byteLineIndex: readSnapshot.byteLineIndex,
            readHashes: readSnapshot.hashes,
            coherence,
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
        alerts,
        scopes: {
            active: ids.length,
            ...scopeStatusCounts,
            ids,
            recent,
        },
        workspaces: Object.freeze({
            count: workspaces.length,
            authorities: projectWorkspaceAuthorities(workspaces),
            externalWatch: coherence.externalWatch,
        }),
        coherenceRuntime: coherenceSnapshot,
    });
}
