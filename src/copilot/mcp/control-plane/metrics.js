// @ts-check
/**
 * In-memory MCP runtime metrics.
 *
 * @module copilot/mcp/control-plane/metrics
 */

const startedAt = Date.now();
const MAX_TOOL_METRICS = 1000;

const HTTP_METRICS = {
    statefulRequests: 0,
    statelessFallbackRequests: 0,
};
const MAX_PHASE_METRICS_PER_TOOL = 64;

/**
 * @typedef {object} ToolMetric
 * @property {number} calls
 * @property {number} errors
 * @property {number} totalDurationMs
 * @property {number | null} lastDurationMs
 * @property {number | null} lastCalledAt
 * @property {boolean | null} lastIsError
 * @property {{
 *     hint: number;
 *     stringify: number;
 *     unknown: number;
 *     rejected: number;
 *     totalBytes: number;
 *     lastBytes: number | null;
 *     lastStrategy: string | null;
 * }} resultSize
 * @property {Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null }>} phases
 * @property {{
 *     batchCalls: number;
 *     logicalOperations: number;
 *     failedOperations: number;
 *     skippedOperations: number;
 *     lastLogicalOperations: number;
 *     lastMode: string | null;
 * }} execution
 */

/** @type {Map<string, ToolMetric>} */
const TOOL_METRICS = new Map();

/**
 * @param {string} tool
 * @param {{
 *     durationMs: number;
 *     isError: boolean;
 *     phases?: Record<string, number>;
 *     resultSize?: { strategy?: string; bytes?: number | null; rejected?: boolean };
 *     execution?: { logicalOperations?: number; failedOperations?: number; skippedOperations?: number; mode?: string };
 * }} event
 * @returns {void}
 */
/**
 * @param {'stateful' | 'stateless-fallback'} mode
 * @returns {void}
 */
export function recordMcpHttpTransportMode(mode) {
    if (mode === 'stateful') HTTP_METRICS.statefulRequests += 1;
    else HTTP_METRICS.statelessFallbackRequests += 1;
}

/**
 * @param {string} tool
 * @param {{
 *     durationMs: number;
 *     isError: boolean;
 *     phases?: Record<string, number>;
 *     resultSize?: { strategy?: string; bytes?: number | null; rejected?: boolean };
 *     execution?: { logicalOperations?: number; failedOperations?: number; skippedOperations?: number; mode?: string };
 * }} event
 * @returns {void}
 */
export function recordMcpToolMetric(tool, event) {
    const current = TOOL_METRICS.get(tool) ?? {
        calls: 0,
        errors: 0,
        totalDurationMs: 0,
        lastDurationMs: null,
        lastCalledAt: null,
        lastIsError: null,
        resultSize: {
            hint: 0,
            stringify: 0,
            unknown: 0,
            rejected: 0,
            totalBytes: 0,
            lastBytes: null,
            lastStrategy: null,
        },
        phases: Object.create(null),
        execution: {
            batchCalls: 0,
            logicalOperations: 0,
            failedOperations: 0,
            skippedOperations: 0,
            lastLogicalOperations: 1,
            lastMode: null,
        },
    };
    current.calls += 1;
    current.errors += event.isError ? 1 : 0;
    current.totalDurationMs += event.durationMs;
    current.lastDurationMs = event.durationMs;
    current.lastCalledAt = Date.now();
    current.lastIsError = event.isError;
    if (event.execution) {
        const logicalOperations = Math.max(1, Math.floor(Number(event.execution.logicalOperations) || 1));
        const failedOperations = Math.max(
            0,
            Math.min(logicalOperations, Math.floor(Number(event.execution.failedOperations) || 0)),
        );
        const skippedOperations = Math.max(
            0,
            Math.min(
                logicalOperations - failedOperations,
                Math.floor(Number(event.execution.skippedOperations) || 0),
            ),
        );
        current.execution.logicalOperations += logicalOperations;
        current.execution.failedOperations += failedOperations;
        current.execution.skippedOperations += skippedOperations;
        current.execution.lastLogicalOperations = logicalOperations;
        current.execution.lastMode =
            typeof event.execution.mode === 'string' && event.execution.mode.trim() ? event.execution.mode.trim() : null;
        if (logicalOperations > 1) current.execution.batchCalls += 1;
    } else {
        current.execution.logicalOperations += 1;
        current.execution.lastLogicalOperations = 1;
        current.execution.lastMode = null;
    }
    if (event.resultSize) {
        const strategy =
            event.resultSize.strategy === 'stringify' || event.resultSize.strategy === 'hint'
                ? event.resultSize.strategy
                : 'unknown';
        if (strategy === 'hint') current.resultSize.hint += 1;
        else if (strategy === 'stringify') current.resultSize.stringify += 1;
        else current.resultSize.unknown += 1;
        current.resultSize.lastStrategy = strategy;
        const bytes = Number(event.resultSize.bytes);
        if (Number.isFinite(bytes) && bytes >= 0) {
            current.resultSize.totalBytes += bytes;
            current.resultSize.lastBytes = bytes;
        }
        if (event.resultSize.rejected === true) current.resultSize.rejected += 1;
    }
    for (const [phase, durationMs] of Object.entries(event.phases ?? {})) {
        if (!Number.isFinite(durationMs) || durationMs < 0) continue;
        if (!(phase in current.phases) && Object.keys(current.phases).length >= MAX_PHASE_METRICS_PER_TOOL) {
            const oldest = Object.keys(current.phases)[0];
            if (oldest !== undefined) delete current.phases[oldest];
        }
        const phaseMetric = current.phases[phase] ?? { calls: 0, totalDurationMs: 0, lastDurationMs: null };
        phaseMetric.calls += 1;
        phaseMetric.totalDurationMs += durationMs;
        phaseMetric.lastDurationMs = durationMs;
        current.phases[phase] = phaseMetric;
    }
    if (!TOOL_METRICS.has(tool) && TOOL_METRICS.size >= MAX_TOOL_METRICS) {
        const oldest = TOOL_METRICS.keys().next().value;
        if (typeof oldest === 'string') TOOL_METRICS.delete(oldest);
    }
    TOOL_METRICS.set(tool, current);
}

/**
 * @returns {{
 *     startedAt: number;
 *     uptimeMs: number;
 *     totals: { calls: number; errors: number; tools: number };
 *     http: { statefulRequests: number; statelessFallbackRequests: number };
 *     tools: Record<
 *         string,
 *         ToolMetric & {
 *             averageDurationMs: number;
 *             phaseAverages: Record<
 *                 string,
 *                 { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
 *             >;
 *         }
 *     >;
 * }}
 */
export function readMcpMetricsSnapshot() {
    /** @type {Record<
    string,
    ToolMetric & {
        averageDurationMs: number;
        phaseAverages: Record<
            string,
            { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
        >;
    }
>} */
    const tools = Object.create(null);
    let calls = 0;
    let errors = 0;
    for (const [name, metric] of TOOL_METRICS.entries()) {
        calls += metric.calls;
        errors += metric.errors;
        tools[name] = {
            ...metric,
            averageDurationMs: metric.calls > 0 ? Math.round(metric.totalDurationMs / metric.calls) : 0,
            phaseAverages: Object.assign(
                Object.create(null),
                Object.fromEntries(
                    Object.entries(metric.phases).map(([phase, phaseMetric]) => [
                        phase,
                        {
                            ...phaseMetric,
                            averageDurationMs:
                                phaseMetric.calls > 0 ? Math.round(phaseMetric.totalDurationMs / phaseMetric.calls) : 0,
                        },
                    ]),
                ),
            ),
        };
    }
    return {
        startedAt,
        uptimeMs: Date.now() - startedAt,
        totals: {
            calls,
            errors,
            tools: TOOL_METRICS.size,
        },
        http: { ...HTTP_METRICS },
        tools,
    };
}

/**
 * @returns {void}
 */
export function resetMcpMetricsForTests() {
    TOOL_METRICS.clear();
    HTTP_METRICS.statefulRequests = 0;
    HTTP_METRICS.statelessFallbackRequests = 0;
}
