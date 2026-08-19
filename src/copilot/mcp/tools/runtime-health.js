// @ts-check
/**
 * MCP runtime health and metrics tools.
 *
 * @module copilot/mcp/tools/runtime-health
 */

import { z } from 'zod';
import { buildIoCacheTierPlan } from '#copilot/infra/public/cache';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/health';
import { getIoIndexStats } from '#copilot/infra/public/indexing';
import { getCopilotNodeCompileCacheHealth } from '#copilot/infra/public/node-runtime';
import {
    readCloudflareTunnelConfig,
    readConnectorSmokeState,
    readQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '#copilot/mcp/cloudflare';
import {
    buildAiArtifactsReport,
    getMcpWorkspaceRoot,
    getTtlCacheStats,
    okResult,
    readMcpAuthConfigCacheStats,
    readMcpAuthDecisionCacheStats,
    readIoCacheBenchmarkState,
    readMcpHttpStatefulSessionPolicy,
    readMcpIndexAutoBuildState,
    readMcpMetricsSnapshot,
    readMcpRoundTripAnalyticsMonitorState,
    readMcpSchemaConvergenceState,
    readMcpStartupMaintenanceState,
    readMcpWorkspaceSmokeSummary,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';
import { readMcpHttpSessionRuntimeState } from '../control-plane/session-runtime.js';
import { readRepoReadFileResultCacheStats } from './repo-read-cache.js';
import { repoStatusHandler } from './repo-status.js';

const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
const WORKSPACE_STATUS_CACHE_TTL_MS = 5 * 1000;

/** @type {{ expiresAt: number; value: { dirty: boolean | null; branch: string | null; head: string | null; error: string | null } } | null} */
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
 * }}
 */
function summarizeIndexHealth(stats) {
    const record = /** @type {Record<string, unknown>} */ (stats && typeof stats === 'object' ? stats : {});
    const available = record['available'] === true;
    const enabled = record['enabled'] !== false;
    const files = typeof record['files'] === 'number' ? record['files'] : null;
    const empty = available && files === 0;
    return {
        available,
        enabled,
        files,
        empty,
        degraded: !available || empty,
        reason: !available ? 'index-unavailable' : empty ? 'index-empty' : null,
    };
}

/**
 * @returns {Promise<{ dirty: boolean | null; branch: string | null; head: string | null; error: string | null }>}
 */
async function summarizeWorkspaceStatus() {
    if (cachedWorkspaceStatus && cachedWorkspaceStatus.expiresAt > Date.now()) return cachedWorkspaceStatus.value;
    try {
        const result = await repoStatusHandler();
        if (result.isError === true) {
            return {
                dirty: null,
                branch: null,
                head: null,
                error: String(result.structuredContent?.['error'] ?? 'repo_status failed'),
            };
        }
        const value = {
            dirty: result.structuredContent?.['dirty'] === true,
            branch:
                typeof result.structuredContent?.['branch'] === 'string' ? result.structuredContent['branch'] : null,
            head: typeof result.structuredContent?.['head'] === 'string' ? result.structuredContent['head'] : null,
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
 * @type {import('../registry.js').McpToolDefinition}
 */
/**
 * @param {Record<string, Record<string, unknown>>} tools
 * @returns {Array<{ name: string; calls: number; errors: number; averageMs: number | null; maxMs: number | null }>}
 */
/**
 * @param {Record<string, unknown>} indexAutoBuild
 * @returns {Record<string, unknown>}
 */
function summarizeIndexAutoBuild(indexAutoBuild) {
    return {
        status: indexAutoBuild['status'] ?? null,
        reason: indexAutoBuild['reason'] ?? null,
        startedAt: indexAutoBuild['startedAt'] ?? null,
        completedAt: indexAutoBuild['completedAt'] ?? null,
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
 * @returns {Array<{ name: string; calls: number; errors: number; averageMs: number | null; maxMs: number | null }>}
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
 * @returns {Array<{ tool: string; phase: string; calls: number; averageMs: number | null; lastMs: number | null }>}
 */
function summarizeSlowestPhases(tools) {
    const rows = [];
    for (const [tool, metric] of Object.entries(tools)) {
        const phaseAverages = metric['phaseAverages'];
        if (!phaseAverages || typeof phaseAverages !== 'object' || Array.isArray(phaseAverages)) continue;
        for (const [phase, phaseMetric] of Object.entries(/** @type {Record<string, Record<string, unknown>>} */ (phaseAverages))) {
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
        for (const [phase, phaseMetric] of Object.entries(/** @type {Record<string, Record<string, unknown>>} */ (phaseAverages))) {
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

/**
 * @returns {Record<string, unknown>}
 */
function readStatefulRuntimePolicySnapshot() {
    const policy = readMcpHttpStatefulSessionPolicy();
    return {
        ...policy,
        postSessionContractEnforced: process.env['COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT'] === 'true',
        sessionIdHashSecretPresent: typeof process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'] === 'string' && process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'].trim().length >= 32,
        statelessFallbackPossible: !policy.enabled,
    };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
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
        singleflightJoins: stats['singleflightJoins'],
        chunkHits: stats['chunkHits'],
        chunkMisses: stats['chunkMisses'],
        size: stats['size'],
        bytes: stats['bytes'],
    };
}

/** @param {ReturnType<typeof readIoRuntimeHealthSnapshot>['cache']} cache */
function summarizeIoCache(cache) {
    const l1 = recordOrEmpty(cache['l1']);
    const coherence = recordOrEmpty(cache['coherence']);
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
        coherence: {
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
        validatedReadPath: cache['validatedReadPath'] ?? null,
        validatedMutablePath: cache['validatedMutablePath'] ?? null,
        aggregate: {
            hits: aggregate['hits'] ?? 0,
            misses: aggregate['misses'] ?? 0,
            hitRatio: aggregate['hitRatio'] ?? 0,
        },
    };
}

/** @param {Record<string, unknown>} durability */
function summarizeIoDurability(durability) {
    const fileSync = recordOrEmpty(durability['fileSync']);
    const directorySync = recordOrEmpty(durability['directorySync']);
    const atomic = recordOrEmpty(durability['atomicWritePhases']);
    const observed = Number(atomic['observed'] ?? 0);
    /** @param {string} field */
    const average = (field) =>
        observed > 0 ? Math.round((Number(atomic[field] ?? 0) / observed) * 1000) / 1000 : 0;
    /** @param {Record<string, unknown>} stats */
    const averageSync = (stats) => {
        const attempted = Number(stats['attempted'] ?? 0);
        return attempted > 0
            ? Math.round((Number(stats['totalDurationMs'] ?? 0) / attempted) * 1000) / 1000
            : 0;
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
            averagePrePublishCheckMs: average('prePublishCheckMs'),
            averagePublishMs: average('publishMs'),
            averageDirectorySyncMs: average('directorySyncMs'),
        },
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

/** @param {ReturnType<typeof readIoRuntimeHealthSnapshot>} ioRuntime @param {Record<string, unknown> | null} benchmarkState */
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

export const mcpRuntimeHealthTool = {
    name: 'mcp_runtime_health',
    title: 'MCP runtime health',
    description: 'Return MCP runtime health, workspace root, uptime and per-tool metrics.',
    inputSchema: {
        includeDetails: z.boolean().optional().describe('Include verbose index, temporary fallback tunnel and full per-tool metrics. Defaults to false.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        const options = /** @type {Record<string, unknown>} */ (input);
        const includeDetails = options['includeDetails'] === true;
        const metrics = readMcpMetricsSnapshot();
        const ttlCaches = getTtlCacheStats();
        const authConfigCache = readMcpAuthConfigCacheStats();
        const authDecisionCache = readMcpAuthDecisionCacheStats();
        const repoReadFileCache = readRepoReadFileResultCacheStats();
        const ioRuntime = readIoRuntimeHealthSnapshot();
        const ioCacheBenchmarkState = await readIoCacheBenchmarkState();
        const ioCacheBenchmark = summarizeIoCacheBenchmark(ioCacheBenchmarkState);
        const ioCachePlanWithBenchmark = buildEvidenceAwareIoCachePlan(ioRuntime, ioCacheBenchmarkState);
        const aiArtifacts = await buildAiArtifactsReport();
        const tunnelConfig = readCloudflareTunnelConfig();
        const tunnelState = await readQuickTunnelState(tunnelConfig.stateFile);
        const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
        const connectorSmoke = summarizeConnectorSmokeState(
            await readConnectorSmokeState(tunnelConfig.smokeStateFile),
            tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl,
        );
        const permanentMode = tunnelConfig.mode === 'named-permanent';
        const workspace = await summarizeWorkspaceStatus();
        const indexStats = getIoIndexStats();
        const index = summarizeIndexHealth(indexStats);
        const indexAutoBuild = readMcpIndexAutoBuildState();
        const startupMaintenance = readMcpStartupMaintenanceState();
        const lastWorkspaceSmoke = readMcpWorkspaceSmokeSummary();
        const statefulPolicy = readStatefulRuntimePolicySnapshot();
        const statefulRuntime = readMcpHttpSessionRuntimeState();
        const schemaConvergence = readMcpSchemaConvergenceState();
        const roundTripAnalyticsMonitor = readMcpRoundTripAnalyticsMonitorState();
        const compileCache = getCopilotNodeCompileCacheHealth();
        const warnings = [];
        const critical = [];
        const informational = [];
        if (workspace.error) warnings.push(`Unable to read repository status: ${workspace.error}`);
        if (workspace.dirty === true) informational.push('Workspace has uncommitted or untracked changes.');
        if (!index.available) warnings.push('Shared IO index is unavailable; run or auto-run repo_index_build.');
        else if (index.empty)
            warnings.push('Shared IO index is available but empty; refresh it before indexed search.');
        if (indexAutoBuild.status === 'failed') critical.push('MCP index auto-build failed.');
        if (indexAutoBuild.status === 'running') warnings.push('MCP index auto-build is currently running.');
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
            return okResult({
                success: true,
                ok: true,
                status,
                warnings,
                critical,
                informational,
                workspaceRoot: getMcpWorkspaceRoot(),
                operationalSignals: {
                    workspace,
                    index,
                    indexAutoBuild: summarizeIndexAutoBuild(indexAutoBuild),
                    startupMaintenance,
                    tunnel: {
                        mode: tunnelConfig.mode,
                        publicMcpUrl: tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl ?? null,
                        transportProtocol: tunnelConfig.transportProtocol,
                        lastSmokeOk: connectorSmoke.ok,
                        lastSmokeAgeMinutes: connectorSmoke.ageMinutes,
                    },
                    statefulPolicy,
                    statefulRuntime,
                    schemaConvergence,
                    roundTripAnalyticsMonitor,
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
                    ioCache: summarizeIoCache(ioRuntime.cache),
                    ioDurability: summarizeIoDurability(recordOrEmpty(ioRuntime.durability)),
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
            });
        }
        return okResult({
            success: true,
            ok: true,
            status,
            warnings,
            critical,
            informational,
            workspaceRoot: getMcpWorkspaceRoot(),
            operationalSignals: {
                workspace,
                index,
                indexAutoBuild,
                startupMaintenance,
                lastWorkspaceSmoke,
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
        });
    },
};
