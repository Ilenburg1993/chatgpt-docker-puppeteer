// @ts-check
/**
 * MCP latency SLO dashboard.
 *
 * @module copilot/mcp/tools/latency-dashboard
 */

import {
    appendMcpLatencyDashboardSnapshot,
    compareMcpLatencyDashboardSnapshots,
    okResult,
    readMcpLatencyDashboardHistory,
    readMcpMetricsSnapshot,
    readMcpRoundTripAnalyticsSnapshot,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';
import { readMcpHttpSessionRuntimeState } from '../control-plane/session-runtime.js';
import { z } from 'zod';

const DEFAULT_MIN_SAMPLE_CALLS = 5;
const DEFAULT_TOOL_AVERAGE_WARN_MS = 1_000;
const DEFAULT_AUTHORIZATION_AVERAGE_WARN_MS = 250;
const DEFAULT_HANDLER_AVERAGE_WARN_MS = 750;
const DEFAULT_RESULT_SIZE_AVERAGE_WARN_MS = 250;
const DEFAULT_ERROR_RATE_WARN = 0.001;
const DEFAULT_SILENT_EXTERNAL_GAP_P50_WARN_MS = 3_000;
const DEFAULT_SILENT_EXTERNAL_GAP_P95_WARN_MS = 8_000;
const MIN_EXTERNAL_GAP_SAMPLES_FOR_SLO = 3;
const MAX_ROWS = 12;

/**
 * @typedef {{
 *     minSampleCalls: number;
 *     toolAverageWarnMs: number;
 *     authorizationAverageWarnMs: number;
 *     handlerAverageWarnMs: number;
 *     resultSizeAverageWarnMs: number;
 *     errorRateWarn: number;
 *     silentExternalGapP50WarnMs: number;
 *     silentExternalGapP95WarnMs: number;
 * }} LatencyDashboardBudgets
 */

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpLatencyDashboardTool = {
    name: 'mcp_latency_dashboard',
    title: 'MCP latency dashboard',
    description:
        'Return a compact read-only latency/SLO dashboard from in-process MCP tool metrics, including slow tools, slow phases and recommended next actions.',
    inputSchema: {
        minSampleCalls: z
            .number()
            .int()
            .min(1)
            .max(10_000)
            .optional()
            .describe('Minimum total calls before strict SLO status is meaningful.'),
        silentExternalGapP50WarnMs: z
            .number()
            .int()
            .min(100)
            .max(120000)
            .optional()
            .describe('Interaction SLO warning threshold for p50 origin-silent gap. Defaults to 3000ms.'),
        silentExternalGapP95WarnMs: z
            .number()
            .int()
            .min(100)
            .max(120000)
            .optional()
            .describe('Interaction SLO warning threshold for p95 origin-silent gap. Defaults to 8000ms.'),
        includeTools: z
            .boolean()
            .optional()
            .describe('Include detailed per-tool/per-phase ranking rows. Default: false; summary still names each top pressure source.'),
        maxRows: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe('Maximum slow tool/phase rows to return. Defaults to 12.'),
        persistSnapshot: z
            .boolean()
            .optional()
            .describe('Append a compact snapshot to the local latency history JSONL file. Defaults to false.'),
        compareHistory: z
            .boolean()
            .optional()
            .describe(
                'Compare this snapshot with the latest persisted latency snapshot. Defaults to true when persistSnapshot=true.',
            ),
        historyLimit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Number of recent persisted snapshots to return when history is requested.'),
        maxHistorySnapshots: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .optional()
            .describe('Maximum snapshots retained when persistSnapshot=true.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        const options = /** @type {Record<string, unknown>} */ (input);
        const budgets = readLatencyDashboardBudgets(options);
        const maxRows = readBoundedInteger(options['maxRows'], MAX_ROWS, 1, 50);
        const includeTools = options['includeTools'] === true;
        const rankingRows = includeTools ? maxRows : 1;
        const metrics = readMcpMetricsSnapshot();
        const sessionRuntime = readMcpHttpSessionRuntimeState();
        const indexedRoundTrip = readMcpRoundTripAnalyticsSnapshot({
            windowMs: 24 * 60 * 60 * 1000,
            top: includeTools ? maxRows : 5,
            includeSynthetic: false,
        });
        const toolRows = includeTools ? buildToolRows(metrics.tools, maxRows) : [];
        const cumulativeCostRows = buildCumulativeCostRows(metrics.tools, metrics.totals.calls, rankingRows);
        const callPressureRows = buildCallPressureRows(metrics.tools, metrics.totals.calls, rankingRows);
        const largestResultPayloads = buildLargestResultPayloadRows(metrics.tools, rankingRows);
        const highestResultVolume = buildResultVolumeRows(metrics.tools, rankingRows);
        const phaseRows = buildPhaseRows(metrics.tools, rankingRows);
        const phaseTotals = buildPhaseTotals(metrics.tools);
        const byteAccounting = buildByteAccounting(metrics.tools);
        const roundTripAccountingDetailed = buildRoundTripAccounting(metrics.tools, includeTools ? maxRows : 1);
        const { topCompressedTools, ...roundTripAccounting } = roundTripAccountingDetailed;
        const assessment = assessLatencySnapshot(metrics, phaseTotals, budgets);
        const dashboard = {
            timestamp: new Date().toISOString(),
            status: assessment.status,
            originStatus: assessment.originStatus,
            interactionStatus: assessment.interactionStatus,
            sample: {
                calls: metrics.totals.calls,
                errors: metrics.totals.errors,
                tools: metrics.totals.tools,
                uptimeMs: metrics.uptimeMs,
                enoughSamples: metrics.totals.calls >= budgets.minSampleCalls,
            },
            budgets,
            summary: {
                ...assessment.summary,
                largestAverageResultBytes: largestResultPayloads[0]?.averageBytes ?? 0,
                highestResultVolumeBytes: highestResultVolume[0]?.totalBytes ?? 0,
                logicalOperations: roundTripAccounting.logicalOperations,
                logicalOperationsPerCall: roundTripAccounting.logicalOperationsPerCall,
                highestCumulativeCost: cumulativeCostRows[0]
                    ? { name: cumulativeCostRows[0].name, totalDurationMs: cumulativeCostRows[0].totalDurationMs }
                    : null,
                highestCallPressure: callPressureRows[0]
                    ? { name: callPressureRows[0].name, calls: callPressureRows[0].calls }
                    : null,
                largestResultPayload: largestResultPayloads[0]
                    ? { name: largestResultPayloads[0].name, averageBytes: largestResultPayloads[0].averageBytes }
                    : null,
                highestResultVolume: highestResultVolume[0]
                    ? { name: highestResultVolume[0].name, totalBytes: highestResultVolume[0].totalBytes }
                    : null,
                slowestPhase: phaseRows[0]
                    ? { tool: phaseRows[0].tool, phase: phaseRows[0].phase, averageMs: phaseRows[0].averageMs }
                    : null,
            },
            critical: assessment.critical,
            warnings: assessment.warnings,
            passed: assessment.passed,
            sessionRuntime,
            ...(includeTools
                ? {
                      slowestTools: toolRows,
                      highestCumulativeCost: cumulativeCostRows,
                      highestCallPressure: callPressureRows,
                      largestResultPayloads,
                      highestResultVolume,
                      slowestPhases: phaseRows,
                  }
                : {}),
            phaseTotals,
            originHttpBoundary: {
                authority: 'observed-at-http-origin-request-response-boundary',
                activeRequests: metrics.interaction.originBoundary.activeRequests,
                requestCount: metrics.interaction.originBoundary.requestCount,
                burstCount: metrics.interaction.originBoundary.burstCount,
                overlapCount: metrics.interaction.originBoundary.overlapCount,
                externalGaps: metrics.interaction.originBoundary.externalGaps,
                preHandler: metrics.interaction.originBoundary.preHandler,
                postHandler: metrics.interaction.originBoundary.postHandler,
                lastCompletedEdgeColo: metrics.interaction.originBoundary.lastCompletedEdgeColo,
                edgeColoCounts: metrics.interaction.originBoundary.edgeColoCounts,
                externalGapsByEdgeColo: metrics.interaction.originBoundary.externalGapsByEdgeColo,
                requestActivity: metrics.interaction.originBoundary.requestActivity,
                discreteAuxiliaryTiming: metrics.interaction.originBoundary.discreteAuxiliaryTiming,
                lastTransition: metrics.interaction.originBoundary.lastTransition,
                maxTransition: metrics.interaction.originBoundary.maxTransition,
                note:
                    'externalGaps measures prior tools/call response finish → next tools/call request arrival; preHandler and postHandler isolate the work inside the origin around the guarded handler.',
            },
            interToolGap: {
                authority: 'observed-at-origin-boundary-external-segment-proxy',
                burstCount: metrics.interaction.burstCount,
                activeCalls: metrics.interaction.activeCalls,
                ...metrics.interaction.gaps,
                lastTransition: metrics.interaction.lastTransition,
                maxTransition: metrics.interaction.maxTransition,
                note:
                    'Quiescent gap between completed and next-started tool bursts. Excludes active MCP handler time; includes response return, client/model/orchestrator work, dispatch/transit, and potentially normal reasoning.',
            },
            byteAccounting,
            roundTripAnalytics: indexedRoundTrip,
            roundTripAccounting: {
                ...roundTripAccounting,
                silentExternalGapP50Ms: metrics.interaction.originBoundary.silentExternalGaps.p50Ms,
                estimatedAmortizedSilentMsAtP50:
                    (metrics.interaction.originBoundary.silentExternalGaps.p50Ms ?? 0) *
                    roundTripAccounting.compressedRoundTrips,
                estimateCaveat:
                    'Counterfactual estimate only: compressed logical operations are not guaranteed to have required one model→tool round trip each. Use it to rank batching opportunities, not as measured time saved.',
                ...(includeTools ? { topCompressedTools } : {}),
            },
            nextActions: buildNextActions(assessment, metrics.totals.calls, budgets),
        };
        const persistSnapshot = options['persistSnapshot'] === true;
        const compareHistory = options['compareHistory'] === true || persistSnapshot;
        const historyLimit = readBoundedInteger(options['historyLimit'], 5, 1, 500);
        const maxHistorySnapshots = readBoundedInteger(options['maxHistorySnapshots'], 500, 1, 10_000);
        const history =
            compareHistory || persistSnapshot
                ? await buildLatencyHistoryReport(dashboard, { persistSnapshot, historyLimit, maxHistorySnapshots })
                : null;
        return okResult({
            ...dashboard,
            ...(history ? { history } : {}),
        });
    },
};

/**
 * @param {Record<string, unknown>} dashboard
 * @param {{ persistSnapshot: boolean; historyLimit: number; maxHistorySnapshots: number }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildLatencyHistoryReport(dashboard, options) {
    const historyBefore = await readMcpLatencyDashboardHistory({ limit: options.historyLimit });
    const previousEntry = historyBefore.entries.at(-1) ?? null;
    const previousSnapshot = previousEntry?.snapshot ?? null;
    const comparison = compareMcpLatencyDashboardSnapshots(
        /** @type {import('#copilot/mcp/control-plane').McpLatencyDashboardSnapshot} */ (dashboard),
        previousSnapshot,
    );
    const persistence = options.persistSnapshot
        ? await appendMcpLatencyDashboardSnapshot(
              /** @type {import('#copilot/mcp/control-plane').McpLatencyDashboardSnapshot} */ (dashboard),
              { maxSnapshots: options.maxHistorySnapshots },
          )
        : { persisted: false, reason: 'persistSnapshot=false' };
    const historyAfter = options.persistSnapshot
        ? await readMcpLatencyDashboardHistory({ limit: options.historyLimit })
        : historyBefore;
    return {
        path: historyAfter.path ?? historyBefore.path,
        entries: historyAfter.entries.map((entry) => ({
            capturedAt: entry.capturedAt,
            status: entry.snapshot.status,
            totalCalls: entry.snapshot.summary?.['totalCalls'] ?? null,
            errorRate: entry.snapshot.summary?.['errorRate'] ?? null,
            slowestAverageToolMs: entry.snapshot.summary?.['slowestAverageToolMs'] ?? null,
        })),
        comparison,
        persistence,
    };
}

/**
 * @param {Record<string, unknown>} options
 * @returns {LatencyDashboardBudgets}
 */
function readLatencyDashboardBudgets(options) {
    return {
        minSampleCalls: readBoundedInteger(options['minSampleCalls'], DEFAULT_MIN_SAMPLE_CALLS, 1, 10_000),
        toolAverageWarnMs: readPositiveEnvInteger(
            'COPILOT_MCP_LATENCY_TOOL_AVERAGE_WARN_MS',
            DEFAULT_TOOL_AVERAGE_WARN_MS,
        ),
        authorizationAverageWarnMs: readPositiveEnvInteger(
            'COPILOT_MCP_LATENCY_AUTHORIZATION_AVERAGE_WARN_MS',
            DEFAULT_AUTHORIZATION_AVERAGE_WARN_MS,
        ),
        handlerAverageWarnMs: readPositiveEnvInteger(
            'COPILOT_MCP_LATENCY_HANDLER_AVERAGE_WARN_MS',
            DEFAULT_HANDLER_AVERAGE_WARN_MS,
        ),
        resultSizeAverageWarnMs: readPositiveEnvInteger(
            'COPILOT_MCP_LATENCY_RESULT_SIZE_AVERAGE_WARN_MS',
            DEFAULT_RESULT_SIZE_AVERAGE_WARN_MS,
        ),
        errorRateWarn: readPositiveEnvNumber('COPILOT_MCP_LATENCY_ERROR_RATE_WARN', DEFAULT_ERROR_RATE_WARN),
        silentExternalGapP50WarnMs: readBoundedInteger(
            options['silentExternalGapP50WarnMs'],
            readPositiveEnvInteger(
                'COPILOT_MCP_LATENCY_SILENT_EXTERNAL_GAP_P50_WARN_MS',
                DEFAULT_SILENT_EXTERNAL_GAP_P50_WARN_MS,
            ),
            100,
            120_000,
        ),
        silentExternalGapP95WarnMs: readBoundedInteger(
            options['silentExternalGapP95WarnMs'],
            readPositiveEnvInteger(
                'COPILOT_MCP_LATENCY_SILENT_EXTERNAL_GAP_P95_WARN_MS',
                DEFAULT_SILENT_EXTERNAL_GAP_P95_WARN_MS,
            ),
            100,
            120_000,
        ),
    };
}

/**
 * @param {Record<
 *     string,
 *     import('#copilot/mcp/control-plane').ToolMetric & {
 *         averageDurationMs: number;
 *         phaseAverages: Record<
 *             string,
 *             { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
 *         >;
 *     }
 * >} tools
 * @param {number} maxRows
 * @returns {{
 *     name: string;
 *     calls: number;
 *     errors: number;
 *     averageMs: number;
 *     lastMs: number | null;
 *     errorRate: number;
 * }[]}
 */
function buildToolRows(tools, maxRows) {
    return Object.entries(tools)
        .map(([name, metric]) => ({
            name,
            calls: metric.calls,
            errors: metric.errors,
            totalDurationMs: metric.totalDurationMs,
            averageMs: metric.averageDurationMs,
            lastMs: metric.lastDurationMs,
            errorRate: metric.calls > 0 ? roundRatio(metric.errors / metric.calls) : 0,
        }))
        .filter((row) => row.calls > 0)
        .sort(
            (left, right) =>
                right.averageMs - left.averageMs || right.calls - left.calls || left.name.localeCompare(right.name),
        )
        .slice(0, maxRows);
}

/**
 * Rank tools by cumulative handler cost. Average-only rankings hide hot tools whose per-call latency is modest but whose
 * repeated use dominates an interactive repo workflow.
 *
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric & { averageDurationMs: number }>} tools
 * @param {number} totalCalls
 * @param {number} maxRows
 */
function buildCumulativeCostRows(tools, totalCalls, maxRows) {
    const totalDurationMs = Object.values(tools).reduce((sum, metric) => sum + metric.totalDurationMs, 0);
    return Object.entries(tools)
        .map(([name, metric]) => ({
            name,
            calls: metric.calls,
            totalDurationMs: metric.totalDurationMs,
            averageMs: metric.averageDurationMs,
            callShare: totalCalls > 0 ? roundRatio(metric.calls / totalCalls) : 0,
            durationShare: totalDurationMs > 0 ? roundRatio(metric.totalDurationMs / totalDurationMs) : 0,
        }))
        .filter((row) => row.calls > 0)
        .sort(
            (left, right) =>
                right.totalDurationMs - left.totalDurationMs || right.calls - left.calls || left.name.localeCompare(right.name),
        )
        .slice(0, maxRows);
}

/**
 * Rank tools by call count so round-trip pressure is visible even when server-side handler time is low.
 *
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric & { averageDurationMs: number }>} tools
 * @param {number} totalCalls
 * @param {number} maxRows
 */
function buildCallPressureRows(tools, totalCalls, maxRows) {
    return Object.entries(tools)
        .map(([name, metric]) => ({
            name,
            calls: metric.calls,
            callShare: totalCalls > 0 ? roundRatio(metric.calls / totalCalls) : 0,
            totalDurationMs: metric.totalDurationMs,
            averageMs: metric.averageDurationMs,
        }))
        .filter((row) => row.calls > 0)
        .sort(
            (left, right) =>
                right.calls - left.calls || right.totalDurationMs - left.totalDurationMs || left.name.localeCompare(right.name),
        )
        .slice(0, maxRows);
}

/**
 * Rank tools by their average result payload. Handler latency alone misses tools that are cheap to execute but expensive
 * to serialize, transport and inject into the model context.
 *
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric>} tools
 * @param {number} maxRows
 */
function buildLargestResultPayloadRows(tools, maxRows) {
    return Object.entries(tools)
        .map(([name, metric]) => {
            const resultCalls = metric.resultSize.hint + metric.resultSize.stringify + metric.resultSize.unknown;
            return {
                name,
                calls: resultCalls,
                totalBytes: metric.resultSize.totalBytes,
                averageBytes: resultCalls > 0 ? Math.round(metric.resultSize.totalBytes / resultCalls) : 0,
                lastBytes: metric.resultSize.lastBytes,
                rejected: metric.resultSize.rejected,
            };
        })
        .filter((row) => row.calls > 0)
        .sort(
            (left, right) =>
                right.averageBytes - left.averageBytes ||
                (right.lastBytes ?? 0) - (left.lastBytes ?? 0) ||
                left.name.localeCompare(right.name),
        )
        .slice(0, maxRows);
}

/**
 * Rank tools by cumulative result volume so a moderately sized response repeated many times is visible as a context and
 * transport pressure source.
 *
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric>} tools
 * @param {number} maxRows
 */
function buildResultVolumeRows(tools, maxRows) {
    const totalResultBytes = Object.values(tools).reduce((sum, metric) => sum + metric.resultSize.totalBytes, 0);
    return Object.entries(tools)
        .map(([name, metric]) => {
            const resultCalls = metric.resultSize.hint + metric.resultSize.stringify + metric.resultSize.unknown;
            return {
                name,
                calls: resultCalls,
                totalBytes: metric.resultSize.totalBytes,
                averageBytes: resultCalls > 0 ? Math.round(metric.resultSize.totalBytes / resultCalls) : 0,
                volumeShare: totalResultBytes > 0 ? roundRatio(metric.resultSize.totalBytes / totalResultBytes) : 0,
            };
        })
        .filter((row) => row.calls > 0 && row.totalBytes > 0)
        .sort(
            (left, right) =>
                right.totalBytes - left.totalBytes || right.calls - left.calls || left.name.localeCompare(right.name),
        )
        .slice(0, maxRows);
}

/**
 * @param {Record<
 *     string,
 *     import('#copilot/mcp/control-plane').ToolMetric & {
 *         averageDurationMs: number;
 *         phaseAverages: Record<
 *             string,
 *             { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
 *         >;
 *     }
 * >} tools
 * @param {number} maxRows
 * @returns {{ tool: string; phase: string; calls: number; averageMs: number; lastMs: number | null }[]}
 */
function buildPhaseRows(tools, maxRows) {
    const rows = [];
    for (const [tool, metric] of Object.entries(tools)) {
        for (const [phase, phaseMetric] of Object.entries(metric.phaseAverages)) {
            rows.push({
                tool,
                phase,
                calls: phaseMetric.calls,
                averageMs: phaseMetric.averageDurationMs,
                lastMs: phaseMetric.lastDurationMs,
            });
        }
    }
    return rows
        .filter((row) => row.calls > 0)
        .sort(
            (left, right) =>
                right.averageMs - left.averageMs || right.calls - left.calls || left.tool.localeCompare(right.tool),
        )
        .slice(0, maxRows);
}

/**
 * @param {Record<
 *     string,
 *     import('#copilot/mcp/control-plane').ToolMetric & {
 *         averageDurationMs: number;
 *         phaseAverages: Record<
 *             string,
 *             { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
 *         >;
 *     }
 * >} tools
 * @returns {Record<string, { calls: number; totalDurationMs: number; averageMs: number | null }>}
 */
function buildPhaseTotals(tools) {
    /** @type {Record<string, { calls: number; totalDurationMs: number }>} */
    const totals = {};
    for (const metric of Object.values(tools)) {
        for (const [phase, phaseMetric] of Object.entries(metric.phaseAverages)) {
            const current = totals[phase] ?? { calls: 0, totalDurationMs: 0 };
            current.calls += phaseMetric.calls;
            current.totalDurationMs += phaseMetric.totalDurationMs;
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
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric & { averageDurationMs: number; phaseAverages: Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }> }>} tools
 * @returns {{ calls: number; hint: number; stringify: number; unknown: number; rejected: number; totalBytes: number; averageBytes: number | null; lastBytes: number | null; hintRate: number; stringifyRate: number }}
 */
function buildByteAccounting(tools) {
    const totals = {
        hint: 0,
        stringify: 0,
        unknown: 0,
        rejected: 0,
        totalBytes: 0,
        lastBytes: /** @type {number | null} */ (null),
    };
    for (const metric of Object.values(tools)) {
        const value = metric.resultSize;
        if (!value) continue;
        totals.hint += value.hint ?? 0;
        totals.stringify += value.stringify ?? 0;
        totals.unknown += value.unknown ?? 0;
        totals.rejected += value.rejected ?? 0;
        totals.totalBytes += value.totalBytes ?? 0;
        if (value.lastBytes !== null && value.lastBytes !== undefined) totals.lastBytes = value.lastBytes;
    }
    const calls = totals.hint + totals.stringify + totals.unknown;
    return {
        ...totals,
        calls,
        averageBytes: calls > 0 ? Math.round(totals.totalBytes / calls) : null,
        hintRate: calls > 0 ? roundRatio(totals.hint / calls) : 0,
        stringifyRate: calls > 0 ? roundRatio(totals.stringify / calls) : 0,
    };
}

/**
 * @param {Record<string, import('#copilot/mcp/control-plane').ToolMetric & { averageDurationMs: number }>} tools
 * @param {number} maxRows
 */
function buildRoundTripAccounting(tools, maxRows) {
    let calls = 0;
    let batchCalls = 0;
    let logicalOperations = 0;
    let failedOperations = 0;
    let skippedOperations = 0;
    const rows = [];
    for (const [name, metric] of Object.entries(tools)) {
        calls += metric.calls;
        const execution = metric.execution;
        const logical = Number(execution?.logicalOperations ?? metric.calls);
        const batches = Number(execution?.batchCalls ?? 0);
        const failed = Number(execution?.failedOperations ?? 0);
        const skipped = Number(execution?.skippedOperations ?? 0);
        logicalOperations += logical;
        batchCalls += batches;
        failedOperations += failed;
        skippedOperations += skipped;
        if (logical > metric.calls || batches > 0) {
            rows.push({
                name,
                calls: metric.calls,
                batchCalls: batches,
                logicalOperations: logical,
                logicalOperationsPerCall: metric.calls > 0 ? roundRatio(logical / metric.calls) : 0,
                failedOperations: failed,
                skippedOperations: skipped,
                lastLogicalOperations: Number(execution?.lastLogicalOperations ?? 1),
                lastMode: execution?.lastMode ?? null,
            });
        }
    }
    rows.sort(
        (left, right) =>
            right.logicalOperationsPerCall - left.logicalOperationsPerCall ||
            right.logicalOperations - left.logicalOperations ||
            left.name.localeCompare(right.name),
    );
    return {
        calls,
        batchCalls,
        logicalOperations,
        failedOperations,
        skippedOperations,
        logicalOperationsPerCall: calls > 0 ? roundRatio(logicalOperations / calls) : 0,
        compressedRoundTrips: Math.max(0, logicalOperations - calls),
        topCompressedTools: rows.slice(0, maxRows),
    };
}

/**
 * @param {ReturnType<typeof readMcpMetricsSnapshot>} metrics
 * @param {Record<string, { calls: number; totalDurationMs: number; averageMs: number | null }>} phaseTotals
 * @param {LatencyDashboardBudgets} budgets
 * @returns {{ status: 'ok' | 'degraded' | 'insufficient-data'; originStatus: 'ok' | 'degraded' | 'insufficient-data'; interactionStatus: 'ok' | 'degraded' | 'insufficient-data'; summary: Record<string, unknown>; critical: string[]; warnings: string[]; passed: string[] }}
 */
function assessLatencySnapshot(metrics, phaseTotals, budgets) {
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const passed = [];
    const calls = metrics.totals.calls;
    const errorRate = calls > 0 ? metrics.totals.errors / calls : 0;
    if (calls < budgets.minSampleCalls) {
        warnings.push(
            `Only ${calls} MCP tool call(s) recorded; collect at least ${budgets.minSampleCalls} before strict SLO decisions.`,
        );
    }
    if (errorRate > budgets.errorRateWarn) warnings.push(`Error rate above budget: ${roundRatio(errorRate)}.`);
    else passed.push(`Error rate within budget: ${roundRatio(errorRate)}.`);

    const slowTool = Object.values(metrics.tools).reduce((max, metric) => Math.max(max, metric.averageDurationMs), 0);
    if (slowTool > budgets.toolAverageWarnMs)
        warnings.push(`At least one tool average is above ${budgets.toolAverageWarnMs}ms.`);
    else if (calls > 0) passed.push(`Tool averages are within ${budgets.toolAverageWarnMs}ms budget.`);

    assessPhaseBudget(phaseTotals, 'authorization', budgets.authorizationAverageWarnMs, warnings, passed);
    assessPhaseBudget(phaseTotals, 'handler', budgets.handlerAverageWarnMs, warnings, passed);
    assessPhaseBudget(phaseTotals, 'resultSize', budgets.resultSizeAverageWarnMs, warnings, passed);

    const originWarningsBeforeInteraction = warnings.length;
    const silentGaps = metrics.interaction.originBoundary.silentExternalGaps;
    const externalGapSampleCount = silentGaps.count;
    if (externalGapSampleCount >= MIN_EXTERNAL_GAP_SAMPLES_FOR_SLO) {
        if ((silentGaps.p50Ms ?? 0) > budgets.silentExternalGapP50WarnMs) {
            warnings.push(
                `Silent external gap p50 above interaction budget: ${silentGaps.p50Ms}ms > ${budgets.silentExternalGapP50WarnMs}ms.`,
            );
        } else {
            passed.push(
                `Silent external gap p50 within interaction budget: ${silentGaps.p50Ms}ms <= ${budgets.silentExternalGapP50WarnMs}ms.`,
            );
        }
        if ((silentGaps.p95Ms ?? 0) > budgets.silentExternalGapP95WarnMs) {
            warnings.push(
                `Silent external gap p95 above interaction budget: ${silentGaps.p95Ms}ms > ${budgets.silentExternalGapP95WarnMs}ms.`,
            );
        } else {
            passed.push(
                `Silent external gap p95 within interaction budget: ${silentGaps.p95Ms}ms <= ${budgets.silentExternalGapP95WarnMs}ms.`,
            );
        }
    } else {
        passed.push(
            `Interaction SLO awaiting ${MIN_EXTERNAL_GAP_SAMPLES_FOR_SLO} external-gap samples; currently ${externalGapSampleCount}.`,
        );
    }

    const originStatus =
        calls < budgets.minSampleCalls
            ? 'insufficient-data'
            : originWarningsBeforeInteraction > 0 || critical.length > 0
              ? 'degraded'
              : 'ok';
    const interactionStatus =
        externalGapSampleCount < MIN_EXTERNAL_GAP_SAMPLES_FOR_SLO
            ? 'insufficient-data'
            : warnings.length > originWarningsBeforeInteraction
              ? 'degraded'
              : 'ok';
    return {
        status:
            calls < budgets.minSampleCalls
                ? 'insufficient-data'
                : warnings.length > 0 || critical.length > 0
                  ? 'degraded'
                  : 'ok',
        originStatus,
        interactionStatus,
        summary: {
            totalCalls: calls,
            totalErrors: metrics.totals.errors,
            errorRate: roundRatio(errorRate),
            observedTools: metrics.totals.tools,
            slowestAverageToolMs: slowTool,
            silentExternalGapP50Ms: silentGaps.p50Ms,
            silentExternalGapP95Ms: silentGaps.p95Ms,
            auxiliaryCoverageRatio: metrics.interaction.originBoundary.auxiliaryCoverage.overallCoverageRatio,
        },
        critical,
        warnings,
        passed,
    };
}

/**
 * @param {Record<string, { calls: number; totalDurationMs: number; averageMs: number | null }>} phaseTotals
 * @param {string} phase
 * @param {number} budgetMs
 * @param {string[]} warnings
 * @param {string[]} passed
 * @returns {void}
 */
function assessPhaseBudget(phaseTotals, phase, budgetMs, warnings, passed) {
    const average = phaseTotals[phase]?.averageMs;
    if (average === undefined || average === null) return;
    if (average > budgetMs) warnings.push(`${phase} average above budget: ${average}ms > ${budgetMs}ms.`);
    else passed.push(`${phase} average within budget: ${average}ms <= ${budgetMs}ms.`);
}

/**
 * @param {{ status: string; originStatus: string; interactionStatus: string; critical: string[]; warnings: string[] }} assessment
 * @param {number} calls
 * @param {LatencyDashboardBudgets} budgets
 * @returns {string[]}
 */
function buildNextActions(assessment, calls, budgets) {
    if (assessment.critical.length > 0)
        return ['Inspect critical runtime failures before transport or Cloudflare tuning.'];
    if (calls < budgets.minSampleCalls) {
        return [
            'Run the golden prompts and common read-only tools until the latency sample is meaningful.',
            'Then compare mcp_latency_dashboard with mcp_cloudflare_metrics_snapshot and mcp_tunnel_status.',
        ];
    }
    if (assessment.interactionStatus === 'degraded' && assessment.originStatus === 'ok') {
        return [
            'Run mcp_latency_attribution or a controlled mcp_latency_pulse series: the origin is locally healthy while end-to-end interaction gaps exceed budget.',
            'Prefer bounded batch/composite operations that safely amortize model→tool round trips; shaving milliseconds from already-fast handlers cannot recover multi-second silent gaps.',
            'Do not restart or retune Cloudflare solely from this signal; require tunnel/self-loop/edge evidence before changing transport.',
        ];
    }
    if (assessment.warnings.length > 0) {
        return [
            'Inspect highestCumulativeCost and highestCallPressure before optimizing isolated slow averages; repeated hot-tool calls often dominate interactive repo latency.',
            'Inspect largestResultPayloads and highestResultVolume before adding diagnostics or registry detail to default workflows.',
            'Then inspect slowestPhases to distinguish handler, authorization and result-size bottlenecks.',
        ];
    }
    return ['Keep collecting baseline samples before promoting Cloudflare edge or tunnel transport changes.'];
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function readBoundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveEnvInteger(name, fallback) {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveEnvNumber(name, fallback) {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundRatio(value) {
    return Math.round(value * 10_000) / 10_000;
}
