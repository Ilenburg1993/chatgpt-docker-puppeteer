// @ts-check
/**
 * Aggregated MCP runtime health diagnostic.
 *
 * Owns collection and interpretation of runtime/cache/index/tunnel/source-drift/maintenance/metrics evidence. MCP wire
 * schemas and CallToolResult framing remain in tools/runtime-health.js.
 *
 * @module copilot/mcp/diagnostics/runtime-health/runtime
 */

import { buildIoCacheTierPlan } from '#copilot/infra/public/cache/tiering';
import { getTtlCacheStats } from '#copilot/infra/public/cache/ttl';
import { readMcpAuthConfigCacheStats, readMcpAuthDecisionCacheStats } from '#copilot/mcp/public/auth';
import {
    createCloudflareStateStore,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '#copilot/mcp/public/cloudflare/tunnel';
import { readIoCacheBenchmarkState } from '#copilot/mcp/public/diagnostics/io-cache';
import { readMcpRoundTripAnalyticsMonitorState } from '#copilot/mcp/public/diagnostics/latency';
import { readMcpRuntimeSourceDrift } from '#copilot/mcp/public/diagnostics/runtime-source-drift';
import { readMcpWorkspaceSmokeSummary } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { readMcpIndexAutoBuildState } from '#copilot/mcp/public/indexing/auto-build';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { readMcpSchemaConvergenceState } from '#copilot/mcp/public/protocol/catalog';
import { readMcpStartupMaintenanceState } from '#copilot/mcp/public/runtime/startup-maintenance';
import { readMcpHttpStatefulRuntimePolicySnapshot } from '#copilot/mcp/public/transport/http/stateful/config';
import { readRepoReadFileResultCacheStats } from '#copilot/mcp/public/workspace/repository/read-cache';
import { readRepositoryStatus } from '#copilot/mcp/public/workspace/repository/status';

const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
const WORKSPACE_STATUS_CACHE_TTL_MS = 5 * 1000;

/** @type {{
    expiresAt: number;
    value: { dirty: boolean | null; branch: string | null; head: string | null; error: string | null };
} | null} */
let cachedWorkspaceStatus = null;

/**
 * @param {unknown} stats
 * @returns {{
 *     available: boolean;
 *     enabled: boolean;
 *     files: number | null;
 *     empty: boolean;
 *     degraded: boolean;
 *     reason: string | null;
 *     parserPolicyVersion: string | null;
 *     parserPolicyRefreshes: number;
 *     parsedSymbolPolicyRejects: number;
 * }}
 */
function summarizeIndexHealth(stats) {
    const record = /** @type {Record<string, unknown>} */ (stats && typeof stats === 'object' ? stats : {});
    const available = record['available'] === true;
    const enabled = record['enabled'] !== false;
    const files = typeof record['files'] === 'number' ? record['files'] : null;
    const freshnessPolicy = recordOrEmpty(record['freshnessPolicy']);
    const parserPolicyVersion =
        typeof freshnessPolicy['parserPolicyVersion'] === 'string' ? freshnessPolicy['parserPolicyVersion'] : null;
    const parserPolicyRefreshes =
        typeof record['parserPolicyRefreshes'] === 'number' ? record['parserPolicyRefreshes'] : 0;
    const parsedSymbolPolicyRejects =
        typeof record['parsedSymbolPolicyRejects'] === 'number' ? record['parsedSymbolPolicyRejects'] : 0;
    const empty = available && files === 0;
    return {
        available,
        enabled,
        files,
        empty,
        degraded: !available || empty,
        reason: !available ? 'index-unavailable' : empty ? 'index-empty' : null,
        parserPolicyVersion,
        parserPolicyRefreshes,
        parsedSymbolPolicyRejects,
    };
}

/**
 * @param {string} workspaceRoot
 * @param {import('#copilot/mcp/public/workspace/git').McpGitProcessConfig} gitConfig
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<{ dirty: boolean | null; branch: string | null; head: string | null; error: string | null }>}
 */
async function summarizeWorkspaceStatus(workspaceRoot, gitConfig, signal) {
    if (cachedWorkspaceStatus && cachedWorkspaceStatus.expiresAt > Date.now()) return cachedWorkspaceStatus.value;
    try {
        const result = await readRepositoryStatus({ workspaceRoot, gitConfig, ...(signal ? { signal } : {}) });
        if (!result.success) {
            return {
                dirty: null,
                branch: null,
                head: null,
                error: result.error,
            };
        }
        const value = {
            dirty: result.dirty,
            branch: result.branch,
            head: result.head,
            error: null,
        };
        cachedWorkspaceStatus = { expiresAt: Date.now() + WORKSPACE_STATUS_CACHE_TTL_MS, value };
        return value;
    } catch (error) {
        const value = {
            dirty: null,
            branch: null,
            head: null,
            error: error instanceof Error ? error.message : String(error),
        };
        cachedWorkspaceStatus = { expiresAt: Date.now() + WORKSPACE_STATUS_CACHE_TTL_MS, value };
        return value;
    }
}

/**
 * @param {Record<string, Record<string, unknown>>} tools
 * @returns {{ name: string; calls: number; errors: number; averageMs: number | null; maxMs: number | null }[]}
 */
/**
 * @param {Record<string, unknown>} indexAutoBuild
 * @returns {Record<string, unknown>}
 */
function summarizeIndexAutoBuild(indexAutoBuild) {
    const result = recordOrEmpty(indexAutoBuild['result']);
    const hashVerification = recordOrEmpty(result['hashVerification']);
    return {
        status: indexAutoBuild['status'] ?? null,
        reason: indexAutoBuild['reason'] ?? null,
        startedAt: indexAutoBuild['startedAt'] ?? null,
        completedAt: indexAutoBuild['completedAt'] ?? null,
        mode: result['mode'] ?? null,
        durationMs: result['durationMs'] ?? null,
        noChangeSloMs: result['noChangeSloMs'] ?? null,
        noChangeSloMet: result['noChangeSloMet'] ?? null,
        hashVerification:
            Object.keys(hashVerification).length === 0
                ? null
                : {
                      candidateCount: hashVerification['candidateCount'] ?? null,
                      hashVerifications: hashVerification['hashVerifications'] ?? null,
                      mismatchCount: hashVerification['mismatchCount'] ?? null,
                      durationMs: hashVerification['durationMs'] ?? null,
                  },
        error: indexAutoBuild['error'] ?? null,
    };
}

/**
 * @param {Record<string, unknown>} stats
 * @returns {Record<string, unknown>}
 */
function summarizeIndexStats(stats) {
    const autoRefresh = recordOrEmpty(stats['autoRefresh']);
    return {
        enabled: stats['enabled'] ?? null,
        available: stats['available'] ?? null,
        files: stats['files'] ?? null,
        freshFiles: stats['freshFiles'] ?? null,
        staleFiles: stats['staleFiles'] ?? null,
        symbols: stats['symbols'] ?? null,
        chunks: stats['chunks'] ?? null,
        freshness: stats['freshness'] ?? null,
        autoRefresh: {
            enabled: autoRefresh['enabled'] ?? false,
            pending: autoRefresh['pending'] ?? 0,
            running: autoRefresh['running'] ?? false,
            batches: autoRefresh['batches'] ?? 0,
            requested: autoRefresh['requested'] ?? 0,
            indexed: autoRefresh['indexed'] ?? 0,
            domainSkipped: autoRefresh['domainSkipped'] ?? 0,
            gitignoredSkipped: autoRefresh['gitignoredSkipped'] ?? 0,
            failed: autoRefresh['failed'] ?? 0,
            lastLagMs: autoRefresh['lastLagMs'] ?? null,
            maxLagMs: autoRefresh['maxLagMs'] ?? 0,
            highWater: autoRefresh['highWater'] ?? 0,
        },
    };
}

/**
 * @param {Record<string, Record<string, unknown>>} tools
 * @returns {{ name: string; calls: number; errors: number; averageMs: number | null; maxMs: number | null }[]}
 */
function summarizeSlowestTools(tools) {
    return Object.entries(tools)
        .map(([name, metric]) => ({
            name,
            calls: Number(metric['calls'] ?? 0),
            errors: Number(metric['errors'] ?? 0),
            averageMs: nullableNumber(metric['averageDurationMs'] ?? metric['averageMs']),
            maxMs: nullableNumber(metric['maxMs'] ?? metric['lastDurationMs']),
        }))
        .filter((item) => item.calls > 0)
        .sort((left, right) => (right.averageMs ?? 0) - (left.averageMs ?? 0))
        .slice(0, 5);
}

/**
 * @param {Record<string, Record<string, unknown>>} tools
 * @returns {{ tool: string; phase: string; calls: number; averageMs: number | null; lastMs: number | null }[]}
 */
function summarizeSlowestPhases(tools) {
    const rows = [];
    for (const [tool, metric] of Object.entries(tools)) {
        const phaseAverages = metric['phaseAverages'];
        if (!phaseAverages || typeof phaseAverages !== 'object' || Array.isArray(phaseAverages)) continue;
        for (const [phase, phaseMetric] of Object.entries(
            /** @type {Record<string, Record<string, unknown>>} */ (phaseAverages),
        )) {
            const calls = finiteNumber(phaseMetric['calls']);
            rows.push({
                tool,
                phase,
                calls,
                averageMs: nullableNumber(phaseMetric['averageDurationMs']),
                lastMs: nullableNumber(phaseMetric['lastDurationMs']),
            });
        }
    }
    return rows
        .filter((row) => row.calls > 0)
        .sort((left, right) => (right.averageMs ?? 0) - (left.averageMs ?? 0))
        .slice(0, 6);
}

/**
 * @param {Record<string, Record<string, unknown>>} tools
 * @returns {Record<string, { calls: number; averageMs: number | null; totalDurationMs: number }>}
 */
function summarizePhaseTotals(tools) {
    /** @type {Record<string, { calls: number; totalDurationMs: number }>} */
    const totals = {};
    for (const metric of Object.values(tools)) {
        const phaseAverages = metric['phaseAverages'];
        if (!phaseAverages || typeof phaseAverages !== 'object' || Array.isArray(phaseAverages)) continue;
        for (const [phase, phaseMetric] of Object.entries(
            /** @type {Record<string, Record<string, unknown>>} */ (phaseAverages),
        )) {
            const calls = finiteNumber(phaseMetric['calls']);
            const totalDurationMs = finiteNumber(phaseMetric['totalDurationMs']);
            if (calls <= 0 && totalDurationMs <= 0) continue;
            const current = totals[phase] ?? { calls: 0, totalDurationMs: 0 };
            current.calls += calls;
            current.totalDurationMs += totalDurationMs;
            totals[phase] = current;
        }
    }
    return Object.fromEntries(
        Object.entries(totals)
            .sort(
                ([leftPhase, left], [rightPhase, right]) =>
                    right.totalDurationMs - left.totalDurationMs || leftPhase.localeCompare(rightPhase),
            )
            .map(([phase, metric]) => [
                phase,
                {
                    calls: metric.calls,
                    totalDurationMs: metric.totalDurationMs,
                    averageMs: metric.calls > 0 ? Math.round(metric.totalDurationMs / metric.calls) : null,
                },
            ]),
    );
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function nullableNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {Record<string, unknown>} drift */
function summarizeRuntimeSourceDrift(drift) {
    return {
        version: drift['version'] ?? null,
        driftDetected: drift['driftDetected'] === true,
        processStartedAt: drift['processStartedAt'] ?? null,
        checkedAt: drift['checkedAt'] ?? null,
        sampledFileCount: drift['sampledFileCount'] ?? 0,
        changedSinceProcessStartCount: drift['changedSinceProcessStartCount'] ?? 0,
        missingCount: drift['missingCount'] ?? 0,
        newestSourceMtime: drift['newestSourceMtime'] ?? null,
        changedPaths: Array.isArray(drift['changedPaths']) ? drift['changedPaths'] : [],
        interpretation: drift['interpretation'] ?? null,
    };
}

/** @param {Record<string, unknown> | null} state */
function summarizeIoCacheBenchmark(state) {
    if (!state) return null;
    const decision = recordOrEmpty(state['decision']);
    return {
        status: state['status'] ?? null,
        completedAt: state['completedAt'] ?? null,
        representativeBenchmarkPassed: decision['representativeBenchmarkPassed'] === true,
        l2ColdP95ImprovementPercent: decision['l2ColdP95ImprovementPercent'] ?? null,
        recommendation: decision['recommendation'] ?? null,
        error: state['error'] ?? null,
    };
}

/** @param {ReturnType<typeof getTtlCacheStats>} caches */
function summarizeTtlCaches(caches) {
    const rows = caches.map((cache) => ({
        size: cache.size,
        hits: cache.hits,
        misses: cache.misses,
    }));
    return {
        count: rows.length,
        activeCount: rows.filter(
            (row) => Number(row.size ?? 0) > 0 || Number(row.hits ?? 0) > 0 || Number(row.misses ?? 0) > 0,
        ).length,
        totalSize: rows.reduce((sum, row) => sum + Number(row.size ?? 0), 0),
        totalHits: rows.reduce((sum, row) => sum + Number(row.hits ?? 0), 0),
        totalMisses: rows.reduce((sum, row) => sum + Number(row.misses ?? 0), 0),
    };
}

/** @param {Record<string, unknown>} stats */
function summarizeAuthorizationCache(stats) {
    return {
        hits: stats['hits'] ?? 0,
        misses: stats['misses'] ?? 0,
        size: stats['size'] ?? 0,
        disabled: stats['disabled'] ?? false,
    };
}

/** @param {ReturnType<typeof readRepoReadFileResultCacheStats>} stats */
function summarizeRepoReadCache(stats) {
    return {
        hits: stats['hits'],
        misses: stats['misses'],
        stale: stats['stale'],
        trustWindowHits: stats['trustWindowHits'],
        hashVariantMisses: stats['hashVariantMisses'],
        fingerprintValidations: stats['fingerprintValidations'],
        fingerprintValidationHits: stats['fingerprintValidationHits'],
        trustWindowMs: stats['trustWindowMs'],
        singleflightJoins: stats['singleflightJoins'],
        chunkHits: stats['chunkHits'],
        chunkMisses: stats['chunkMisses'],
        size: stats['size'],
        bytes: stats['bytes'],
    };
}

/** @param {import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthView['runtime']['cache']} cache */
function summarizeIoCache(cache) {
    const l1 = recordOrEmpty(cache['l1']);
    const coherence = recordOrEmpty(cache['coherence']);
    const readHashes = recordOrEmpty(cache['readHashes']);
    const byteLineIndex = recordOrEmpty(cache['byteLineIndex']);
    const crossProcess = recordOrEmpty(coherence['crossProcess']);
    const externalWatch = recordOrEmpty(coherence['externalWatch']);
    const aggregate = recordOrEmpty(cache['aggregate']);
    return {
        l1: {
            hits: l1['hits'] ?? 0,
            misses: l1['misses'] ?? 0,
            size: l1['size'] ?? 0,
            bytesStored: l1['bytesStored'] ?? 0,
        },
        readHashes: {
            reads: readHashes['reads'] ?? 0,
            hashComputations: readHashes['hashComputations'] ?? 0,
            fullHashComputations: readHashes['fullHashComputations'] ?? 0,
            returnedSliceHashComputations: readHashes['returnedSliceHashComputations'] ?? 0,
            knownFullHashReuses: readHashes['knownFullHashReuses'] ?? 0,
            fullWindowReturnedHashReuses: readHashes['fullWindowReturnedHashReuses'] ?? 0,
            fullHashOutputSkips: readHashes['fullHashOutputSkips'] ?? 0,
            returnedHashOutputSkips: readHashes['returnedHashOutputSkips'] ?? 0,
        },
        byteLineIndex: {
            hits: byteLineIndex['hits'] ?? 0,
            hitPrevalidationElisions: byteLineIndex['hitPrevalidationElisions'] ?? 0,
            misses: byteLineIndex['misses'] ?? 0,
            builds: byteLineIndex['builds'] ?? 0,
            extensions: byteLineIndex['extensions'] ?? 0,
            partialBuilds: byteLineIndex['partialBuilds'] ?? 0,
            fullBuilds: byteLineIndex['fullBuilds'] ?? 0,
            memoryEvictions: byteLineIndex['memoryEvictions'] ?? 0,
            indexBytesScanned: byteLineIndex['indexBytesScanned'] ?? 0,
            rangeBytesRead: byteLineIndex['rangeBytesRead'] ?? 0,
            capturedRangeReuses: byteLineIndex['capturedRangeReuses'] ?? 0,
            rangeBytesAvoided: byteLineIndex['rangeBytesAvoided'] ?? 0,
            streamSeeds: byteLineIndex['streamSeeds'] ?? 0,
            streamSeedBytes: byteLineIndex['streamSeedBytes'] ?? 0,
            streamSeedPromotions: byteLineIndex['streamSeedPromotions'] ?? 0,
            busInvalidations: byteLineIndex['busInvalidations'] ?? 0,
            size: byteLineIndex['size'] ?? 0,
            sizeBytes: byteLineIndex['sizeBytes'] ?? 0,
            maxBytes: byteLineIndex['maxBytes'] ?? 0,
        },
        coherence: {
            localDispatches: coherence['localDispatches'] ?? 0,
            pendingReplications: coherence['pendingReplications'] ?? coherence['pending'] ?? 0,
            replicationQueued: coherence['replicationQueued'] ?? 0,
            replicationCoalesced: coherence['replicationCoalesced'] ?? 0,
            replicationFlushes: coherence['replicationFlushes'] ?? 0,
            replicationPublished: coherence['replicationPublished'] ?? 0,
            gapDetections: crossProcess['gapDetections'] ?? 0,
            writeErrors: crossProcess['writeErrors'] ?? 0,
            readErrors: crossProcess['readErrors'] ?? 0,
            externalWatch: {
                enabled: externalWatch['enabled'] ?? false,
                watching: externalWatch['watching'] ?? false,
                events: externalWatch['events'] ?? 0,
                invalidated: externalWatch['invalidated'] ?? 0,
                canonicalSuppressed: externalWatch['canonicalSuppressed'] ?? 0,
                filtered: externalWatch['filtered'] ?? 0,
                dropped: externalWatch['dropped'] ?? 0,
                errors: externalWatch['errors'] ?? 0,
                pending: externalWatch['pending'] ?? 0,
                lastEventAtMs: externalWatch['lastEventAtMs'] ?? null,
            },
        },
        aggregate: {
            hits: aggregate['hits'] ?? 0,
            misses: aggregate['misses'] ?? 0,
            hitRatio: aggregate['hitRatio'] ?? 0,
        },
    };
}

/**
 * Keep the default MCP health payload intentionally small. Full cache internals remain available through
 * includeDetails=true; the normal round-trip only carries counters that are directly actionable for readiness and
 * capability-fast-path diagnosis.
 *
 * @param {import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthView['runtime']['cache']} cache
 */
function summarizeIoCacheCompact(cache) {
    const summary = summarizeIoCache(cache);
    return {
        l1: summary.l1,
        coherence: {
            gapDetections: summary.coherence.gapDetections,
            writeErrors: summary.coherence.writeErrors,
            readErrors: summary.coherence.readErrors,
        },
        aggregate: summary.aggregate,
    };
}

/** @param {Record<string, unknown>} state */
function summarizeSchemaConvergence(state) {
    return {
        status: state['status'] ?? 'uninitialized',
        descriptorRevision: state['descriptorRevision'] ?? 0,
        currentToolCount: state['currentToolCount'] ?? 0,
        listChangedSentCount: state['listChangedSentCount'] ?? 0,
        listChangedErrorCount: state['listChangedErrorCount'] ?? 0,
        lastListChangedError: state['lastListChangedError'] ?? null,
    };
}

/** @param {Record<string, unknown>} state */
function summarizeRoundTripAnalyticsMonitor(state) {
    return {
        enabled: state['enabled'] === true,
        running: state['running'] === true,
        runs: state['runs'] ?? 0,
        failures: state['failures'] ?? 0,
        lastRunAt: state['lastRunAt'] ?? null,
        lastSuccessAt: state['lastSuccessAt'] ?? null,
        lastDurationMs: state['lastDurationMs'] ?? null,
        lastLagBytes: state['lastLagBytes'] ?? null,
        lastComplete: state['lastComplete'] ?? null,
        lastError: state['lastError'] ?? null,
    };
}

/** @param {Record<string, unknown>} durability */
function summarizeIoDurability(durability) {
    const fileSync = recordOrEmpty(durability['fileSync']);
    const directorySync = recordOrEmpty(durability['directorySync']);
    const atomic = recordOrEmpty(durability['atomicWritePhases']);
    const observed = Number(atomic['observed'] ?? 0);
    /** @param {string} field */
    const average = (field) => (observed > 0 ? Math.round((Number(atomic[field] ?? 0) / observed) * 1000) / 1000 : 0);
    /** @param {Record<string, unknown>} stats */
    const averageSync = (stats) => {
        const attempted = Number(stats['attempted'] ?? 0);
        return attempted > 0 ? Math.round((Number(stats['totalDurationMs'] ?? 0) / attempted) * 1000) / 1000 : 0;
    };
    return {
        modes: durability['modes'] ?? null,
        fileFlushRequested: durability['fileFlushRequested'] ?? 0,
        fileSync: {
            attempted: fileSync['attempted'] ?? 0,
            confirmed: fileSync['confirmed'] ?? 0,
            failed: fileSync['failed'] ?? 0,
            averageMs: averageSync(fileSync),
            maxMs: fileSync['maxDurationMs'] ?? 0,
        },
        directorySync: {
            attempted: directorySync['attempted'] ?? 0,
            confirmed: directorySync['confirmed'] ?? 0,
            failed: directorySync['failed'] ?? 0,
            averageMs: averageSync(directorySync),
            maxMs: directorySync['maxDurationMs'] ?? 0,
        },
        atomicWrite: {
            observed,
            averageTotalMs: average('totalMs'),
            averageTempPathMs: average('tempPathMs'),
            averageCapacityPreflightMs: average('capacityPreflightMs'),
            averageTempWriteMs: average('tempWriteMs'),
            averageModeApplyMs: average('modeApplyMs'),
            averageFileSyncMs: average('fileSyncMs'),
            averagePrePublishCheckMs: average('prePublishCheckMs'),
            averagePublishMs: average('publishMs'),
            averageDirectorySyncMs: average('directorySyncMs'),
        },
    };
}

/** @param {Record<string, unknown>} mutationState */
function summarizeIoMutationState(mutationState) {
    return {
        appliedButUnconfirmed: mutationState['appliedButUnconfirmed'] ?? 0,
        byOperation: mutationState['byOperation'] ?? {},
        last: mutationState['last'] ?? null,
    };
}

/** @param {Record<string, unknown>} parser */
function summarizeIoParser(parser) {
    const fileContext = recordOrEmpty(parser['fileContext']);
    return {
        fileContextSize: fileContext['size'] ?? 0,
        fileContextHashComputations: fileContext['hashComputations'] ?? 0,
        fileContextHashReuses: fileContext['hashReuses'] ?? 0,
        workerQueueLength: parser['workerQueueLength'] ?? 0,
        workerQueueHighWater: parser['workerQueueHighWater'] ?? 0,
        workerFailures: parser['workerFailures'] ?? 0,
        workerTimeouts: parser['workerTimeouts'] ?? 0,
        workerFallbacks: parser['workerFallbacks'] ?? 0,
        workerInitFailures: parser['workerInitFailures'] ?? 0,
        workerInitRecoveries: parser['workerInitRecoveries'] ?? 0,
        workerPoolConsecutiveInitFailures: parser['workerPoolConsecutiveInitFailures'] ?? 0,
        workerPoolNextInitAttemptAtMs: parser['workerPoolNextInitAttemptAtMs'] ?? null,
        parserPolicyVersion: parser['parserPolicyVersion'] ?? null,
    };
}

/** @param {Record<string, unknown>} artifacts */
function summarizeAiArtifacts(artifacts) {
    const jobs = recordOrEmpty(artifacts['jobs']);
    const rollback = recordOrEmpty(artifacts['rollback']);
    return {
        jobs: {
            cleanupCandidateCount: jobs['cleanupCandidateCount'] ?? 0,
            cleanupCandidateBytes: jobs['cleanupCandidateBytes'] ?? 0,
        },
        rollback: {
            enabled: rollback['enabled'] ?? false,
            sidecarCount: rollback['sidecarCount'] ?? 0,
        },
    };
}

/** @param {import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthView['runtime']} ioRuntime @param {Record<string, unknown> | null}
  benchmarkState */
function buildEvidenceAwareIoCachePlan(ioRuntime, benchmarkState) {
    const cache = recordOrEmpty(ioRuntime.cache);
    const aggregate = recordOrEmpty(cache['aggregate']);
    const l2 = recordOrEmpty(cache['l2']);
    const index = recordOrEmpty(ioRuntime.index);
    const decision = recordOrEmpty(benchmarkState?.['decision']);
    const workspaceFiles = Number(index['files'] ?? index['fileCount'] ?? 0);
    const readHotsetRatio = Number(aggregate['hitRatio'] ?? 0);
    return buildIoCacheTierPlan({
        l1Enabled: true,
        l2Enabled: l2['enabled'] === true,
        l3Enabled: false,
        workspaceFiles: Number.isFinite(workspaceFiles) ? workspaceFiles : 0,
        readHotsetRatio: Number.isFinite(readHotsetRatio) ? readHotsetRatio : 0,
        representativeBenchmarkPassed: decision['representativeBenchmarkPassed'] === true,
    });
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspaceCapability
 * @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} repositoryReadCacheConfig
 * @param {import('#copilot/mcp/public/indexing/auto-build').McpIndexAutoBuildConfig} indexAutoBuildConfig
 * @param {import('#copilot/mcp/public/workspace/git').McpGitProcessConfig} gitConfig
 * @param {import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthCapability} infraHealthCapability
 * @param {Readonly<{ readState: () => Record<string, unknown> }> | undefined} httpSessionRuntimeCapability
 * @param {ReturnType<typeof import('#copilot/mcp/public/maintenance').createAiArtifactsRuntime>} aiArtifactsCapability
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} tunnelConfig
 * @param {{ includeDetails?: boolean | undefined; signal?: AbortSignal }} [input]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readMcpRuntimeHealth(
    workspaceCapability,
    repositoryReadCacheConfig,
    indexAutoBuildConfig,
    gitConfig,
    infraHealthCapability,
    httpSessionRuntimeCapability,
    aiArtifactsCapability,
    tunnelConfig,
    input = {},
) {
    if (!repositoryReadCacheConfig) throw new TypeError('MCP runtime health requires repository read-cache config.');
    if (!indexAutoBuildConfig) throw new TypeError('MCP runtime health requires index auto-build config.');
    if (!gitConfig) throw new TypeError('MCP runtime health requires an explicit Git process config.');
    if (!infraHealthCapability)
        throw new TypeError('MCP runtime health requires the composed Infra health capability.');
    if (!aiArtifactsCapability)
        throw new TypeError('MCP runtime health requires the composed AI-artifacts capability.');
    if (!tunnelConfig) throw new TypeError('MCP runtime health requires a Cloudflare config projection.');
    const options = /** @type {Record<string, unknown>} */ (input);
    const includeDetails = options['includeDetails'] === true;
    const metrics = readMcpMetricsSnapshot();
    const ttlCaches = getTtlCacheStats();
    const authConfigCache = readMcpAuthConfigCacheStats();
    const authDecisionCache = readMcpAuthDecisionCacheStats();
    const repoReadFileCache = readRepoReadFileResultCacheStats(repositoryReadCacheConfig);
    const infraHealth = infraHealthCapability.read();
    const ioRuntime = infraHealth.runtime;
    const ioProcess = infraHealth.process;
    const [ioCacheBenchmarkState, aiArtifacts, runtimeSourceDrift] = await Promise.all([
        readIoCacheBenchmarkState(),
        includeDetails ? aiArtifactsCapability.buildReport() : aiArtifactsCapability.readPressure(),
        readMcpRuntimeSourceDrift(workspaceCapability),
    ]);
    const ioCacheBenchmark = summarizeIoCacheBenchmark(ioCacheBenchmarkState);
    const ioCachePlanWithBenchmark = buildEvidenceAwareIoCachePlan(ioRuntime, ioCacheBenchmarkState);
    const tunnelStateStore = createCloudflareStateStore(tunnelConfig);
    const [tunnelState, connectorSmokeState] = await Promise.all([
        tunnelStateStore.readQuickTunnelState(),
        tunnelStateStore.readConnectorSmokeState(),
    ]);
    const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
    const connectorSmoke = summarizeConnectorSmokeState(
        connectorSmokeState,
        tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl,
    );
    const permanentMode = tunnelConfig.mode === 'named-permanent';
    const workspace = await summarizeWorkspaceStatus(workspaceCapability.workspaceRoot, gitConfig, input.signal);
    const indexStats = workspaceCapability.indexRegistry.status();
    const index = summarizeIndexHealth(indexStats);
    const indexAutoBuild = readMcpIndexAutoBuildState(indexAutoBuildConfig);
    const startupMaintenance = readMcpStartupMaintenanceState();
    const lastWorkspaceSmoke = readMcpWorkspaceSmokeSummary();
    const statefulPolicy = readMcpHttpStatefulRuntimePolicySnapshot();
    const statefulRuntime = httpSessionRuntimeCapability?.readState() ?? {
        available: false,
        reason: 'http-session-runtime-not-owned-by-current-transport',
    };
    const schemaConvergence = readMcpSchemaConvergenceState();
    const roundTripAnalyticsMonitor = readMcpRoundTripAnalyticsMonitorState();
    const compileCache = ioProcess.compileCache;
    const warnings = [];
    const critical = [];
    const informational = [];
    for (const alert of [...ioProcess.alerts, ...ioRuntime.alerts]) {
        const message = `[${alert.code}] ${alert.message}`;
        if (alert.severity === 'high') critical.push(message);
        else warnings.push(message);
    }
    if (workspace.error) warnings.push(`Unable to read repository status: ${workspace.error}`);
    if (workspace.dirty === true) informational.push('Workspace has uncommitted or untracked changes.');
    if (runtimeSourceDrift['driftDetected'] === true) {
        warnings.push(
            `MCP runtime/source drift detected: ${String(runtimeSourceDrift['changedSinceProcessStartCount'] ?? 0)} sampled runtime-critical source file(s) changed after this process started; loaded tool behavior may be stale until a controlled reload.`,
        );
    }
    if (!index.available) warnings.push('Shared IO index is unavailable; run or auto-run repo_index_build.');
    else if (index.empty) warnings.push('Shared IO index is available but empty; refresh it before indexed search.');
    if (indexAutoBuild.status === 'failed') critical.push('MCP index auto-build failed.');
    if (indexAutoBuild.status === 'running') warnings.push('MCP index auto-build is currently running.');
    const indexAutoBuildResult = recordOrEmpty(indexAutoBuild.result);
    if (indexAutoBuildResult['mode'] === 'skip' && indexAutoBuildResult['noChangeSloMet'] === false) {
        warnings.push(
            `MCP index no-change readiness exceeded its ${String(indexAutoBuildResult['noChangeSloMs'] ?? 'configured')} ms SLO.`,
        );
    }
    if (tunnelConfig.mode === 'temporary-quick' && !tunnel.configured) {
        warnings.push('No saved Cloudflare quick tunnel state; start a temporary tunnel for ChatGPT.');
    }
    if (tunnelConfig.mode === 'temporary-quick' && tunnel.configured && !tunnel.processAlive) {
        warnings.push('Saved Cloudflare quick tunnel process is not alive; start a fresh temporary tunnel.');
    }
    if (tunnelConfig.mode === 'temporary-quick' && tunnel.stale) {
        warnings.push('Temporary Cloudflare tunnel is stale; run cloudflare smoke before reuse.');
    }
    if (connectorSmoke.ok === null)
        warnings.push('No Cloudflare smoke result is recorded for the current connector URL.');
    if (connectorSmoke.ok === false) critical.push('Last Cloudflare smoke failed.');
    if (
        connectorSmoke.ok === true &&
        typeof connectorSmoke.ageMinutes === 'number' &&
        connectorSmoke.ageMinutes > CONNECTOR_SMOKE_STALE_AFTER_MINUTES
    ) {
        warnings.push(
            `Cloudflare connector smoke is ${connectorSmoke.ageMinutes} minutes old; refresh smoke after tunnel, auth or DNS changes.`,
        );
    }
    if (!lastWorkspaceSmoke) warnings.push('No in-process mcp_smoke_workspace result has been recorded.');
    if (lastWorkspaceSmoke?.success === false) critical.push('Last mcp_smoke_workspace failed.');
    if (Number(startupMaintenance.detachedLiveRunReaperFailures ?? 0) > 0) {
        warnings.push('Startup maintenance could not reap one or more stale completed LLM-B harness processes.');
    }
    if (Number(startupMaintenance.detachedLiveRunsReaped ?? 0) > 0) {
        informational.push(
            `Startup maintenance reaped ${Number(startupMaintenance.detachedLiveRunsReaped)} stale completed LLM-B harness process(es).`,
        );
    }
    const aiJobs = aiArtifacts['jobs'];
    const aiJobsExtraCount =
        aiJobs && typeof aiJobs === 'object' && !Array.isArray(aiJobs)
            ? Number(/** @type {Record<string, unknown>} */ (aiJobs)['cleanupCandidateCount'] ?? 0)
            : 0;
    if (Number.isFinite(aiJobsExtraCount) && aiJobsExtraCount > 0) {
        informational.push(`src/copilot/.ai/jobs has ${aiJobsExtraCount} artifacts beyond retention.`);
    }
    for (const [toolName, metric] of Object.entries(metrics.tools)) {
        const calls = Number(metric.calls ?? 0);
        const errors = Number(metric.errors ?? 0);
        if (calls >= 3 && errors / calls >= 0.5) {
            warnings.push(`High MCP error rate for ${toolName}.`);
        }
    }
    const status = critical.length > 0 ? 'failed' : warnings.length > 0 ? 'degraded' : 'ok';
    if (includeDetails !== true) {
        return {
            success: true,
            ok: true,
            status,
            warnings,
            critical,
            informational,
            workspaceRoot: workspaceCapability.workspaceRoot,
            operationalSignals: {
                workspace,
                index,
                indexAutoBuild: summarizeIndexAutoBuild(indexAutoBuild),
                startupMaintenance,
                runtimeSourceDrift: summarizeRuntimeSourceDrift(runtimeSourceDrift),
                tunnel: {
                    mode: tunnelConfig.mode,
                    publicMcpUrl: tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl ?? null,
                    transportProtocol: tunnelConfig.transportProtocol,
                    lastSmokeOk: connectorSmoke.ok,
                    lastSmokeAgeMinutes: connectorSmoke.ageMinutes,
                },
                statefulPolicy,
                statefulRuntime,
                schemaConvergence: summarizeSchemaConvergence(schemaConvergence),
                roundTripAnalyticsMonitor: summarizeRoundTripAnalyticsMonitor(roundTripAnalyticsMonitor),
                nodeRuntime: {
                    nodeVersion: process.version,
                    compileCache: {
                        enabled: compileCache.enabled,
                        statusName: compileCache.statusName,
                        portable: compileCache.portable,
                        directoryKnown: compileCache.directoryKnown,
                        lastFlush: compileCache.lastFlush
                            ? {
                                  flushed: compileCache.lastFlush.flushed,
                                  durationMs: Math.round(compileCache.lastFlush.durationMs * 1000) / 1000,
                                  error: compileCache.lastFlush.error,
                              }
                            : null,
                    },
                },
            },
            indexStats: summarizeIndexStats(indexStats),
            metrics: {
                startedAt: metrics.startedAt,
                uptimeMs: metrics.uptimeMs,
                totals: metrics.totals,
                slowestTool: summarizeSlowestTools(metrics.tools)[0] ?? null,
                slowestPhase: summarizeSlowestPhases(metrics.tools)[0] ?? null,
                phaseTotals: Object.fromEntries(
                    Object.entries(summarizePhaseTotals(metrics.tools)).filter(([phase]) =>
                        ['handler', 'authorization', 'resultSize'].includes(phase),
                    ),
                ),
                ttlCaches: summarizeTtlCaches(ttlCaches),
                authorizationConfigCache: summarizeAuthorizationCache(recordOrEmpty(authConfigCache)),
                authorizationCache: summarizeAuthorizationCache(recordOrEmpty(authDecisionCache)),
                repoReadFileCache: summarizeRepoReadCache(repoReadFileCache),
                ioCache: summarizeIoCacheCompact(ioRuntime.cache),
                ioProcess: {
                    ownership: ioProcess.ownership,
                    authority: ioProcess.authority,
                    lockTimeouts:
                        Number(ioProcess.locks?.timeouts ?? 0) + Number(ioProcess.locks?.fileLocks.timeouts ?? 0),
                    alertCount: ioProcess.alerts.length,
                },
                ioDurability: summarizeIoDurability(recordOrEmpty(ioRuntime.durability)),
                ioMutationState: summarizeIoMutationState(recordOrEmpty(ioRuntime.mutationState)),
                ioCachePlan: {
                    l2Decision: ioCachePlanWithBenchmark.l2Decision,
                    recommendationCount: Array.isArray(ioCachePlanWithBenchmark.recommendations)
                        ? ioCachePlanWithBenchmark.recommendations.length
                        : 0,
                },
                ioParser: summarizeIoParser(recordOrEmpty(ioRuntime.parser)),
                aiArtifacts: summarizeAiArtifacts(aiArtifacts),
            },
            detailsAvailable: true,
        };
    }
    return {
        success: true,
        ok: true,
        status,
        warnings,
        critical,
        informational,
        workspaceRoot: workspaceCapability.workspaceRoot,
        operationalSignals: {
            workspace,
            index,
            indexAutoBuild,
            startupMaintenance,
            lastWorkspaceSmoke,
            runtimeSourceDrift,
            tunnel: {
                mode: tunnelConfig.mode,
                publicMcpUrl: tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl ?? null,
                tunnelName: tunnelConfig.tunnelName,
                configured: permanentMode ? Boolean(tunnelConfig.publicMcpUrl) : tunnel.configured,
                processAlive: permanentMode ? null : tunnel.processAlive,
                stale: permanentMode ? false : tunnel.stale,
                recommendedAction:
                    tunnelConfig.mode === 'named-permanent' ? 'use-permanent-hostname' : tunnel.recommendedAction,
                lastSmokeOk: connectorSmoke.ok,
                lastSmokeAgeMinutes: connectorSmoke.ageMinutes,
                lastSmokeCheckedAt: connectorSmoke.checkedAt,
                smokeStateFile: tunnelConfig.smokeStateFile,
            },
            temporaryFallbackTunnel: {
                ...tunnel,
                ignoredForOperationalReadiness: permanentMode,
            },
            statefulPolicy,
            statefulRuntime,
            nodeRuntime: {
                nodeVersion: process.version,
                compileCache,
            },
        },
        indexStats,
        metrics: {
            ...metrics,
            ttlCaches,
            authorizationConfigCache: authConfigCache,
            authorizationCache: authDecisionCache,
            repoReadFileCache,
            ioCache: ioRuntime.cache,
            ioProcess,
            ioDurability: ioRuntime.durability,
            ioCacheBenchmark,
            ioCachePlanWithBenchmark,
            ioParser: ioRuntime.parser,
            aiArtifacts,
        },
        tunnel: permanentMode
            ? {
                  mode: 'named-permanent',
                  publicMcpUrl: tunnelConfig.publicMcpUrl ?? null,
                  lastSmoke: connectorSmoke,
                  temporaryFallback: {
                      ...tunnel,
                      ignoredForOperationalReadiness: true,
                  },
              }
            : tunnel,
    };
}
