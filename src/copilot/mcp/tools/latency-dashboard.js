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
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';
import { z } from 'zod';

const DEFAULT_MIN_SAMPLE_CALLS = 5;
const DEFAULT_TOOL_AVERAGE_WARN_MS = 1_000;
const DEFAULT_AUTHORIZATION_AVERAGE_WARN_MS = 250;
const DEFAULT_HANDLER_AVERAGE_WARN_MS = 750;
const DEFAULT_RESULT_SIZE_AVERAGE_WARN_MS = 250;
const DEFAULT_ERROR_RATE_WARN = 0.001;
const MAX_ROWS = 12;

/**
 * @typedef {{
 *     minSampleCalls: number;
 *     toolAverageWarnMs: number;
 *     authorizationAverageWarnMs: number;
 *     handlerAverageWarnMs: number;
 *     resultSizeAverageWarnMs: number;
 *     errorRateWarn: number;
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
        includeTools: z.boolean().optional().describe('Include per-tool rows. Defaults to true.'),
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
        const includeTools = options['includeTools'] !== false;
        const metrics = readMcpMetricsSnapshot();
        const toolRows = buildToolRows(metrics.tools, maxRows);
        const phaseRows = buildPhaseRows(metrics.tools, maxRows);
        const phaseTotals = buildPhaseTotals(metrics.tools);
        const byteAccounting = buildByteAccounting(metrics.tools);
        const assessment = assessLatencySnapshot(metrics, phaseTotals, budgets);
        const dashboard = {
            timestamp: new Date().toISOString(),
            status: assessment.status,
            sample: {
                calls: metrics.totals.calls,
                errors: metrics.totals.errors,
                tools: metrics.totals.tools,
                uptimeMs: metrics.uptimeMs,
                enoughSamples: metrics.totals.calls >= budgets.minSampleCalls,
            },
            budgets,
            summary: assessment.summary,
            critical: assessment.critical,
            warnings: assessment.warnings,
            passed: assessment.passed,
            ...(includeTools ? { slowestTools: toolRows } : {}),
            slowestPhases: phaseRows,
            phaseTotals,
            byteAccounting,
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
 * @param {ReturnType<typeof readMcpMetricsSnapshot>} metrics
 * @param {Record<string, { calls: number; totalDurationMs: number; averageMs: number | null }>} phaseTotals
 * @param {LatencyDashboardBudgets} budgets
 * @returns {{ status: 'ok' | 'degraded' | 'insufficient-data'; summary: Record<string, unknown>; critical: string[]; warnings: string[]; passed: string[] }}
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

    return {
        status:
            calls < budgets.minSampleCalls
                ? 'insufficient-data'
                : warnings.length > 0 || critical.length > 0
                  ? 'degraded'
                  : 'ok',
        summary: {
            totalCalls: calls,
            totalErrors: metrics.totals.errors,
            errorRate: roundRatio(errorRate),
            observedTools: metrics.totals.tools,
            slowestAverageToolMs: slowTool,
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
 * @param {{ status: string; critical: string[]; warnings: string[] }} assessment
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
    if (assessment.warnings.length > 0) {
        return [
            'Inspect slowestPhases first; optimize authorization/cache, handler logic or result size depending on the dominant phase.',
            'Use mcp_cloudflare_transport_benchmark_plan before changing QUIC/auto/http2 transport.',
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
