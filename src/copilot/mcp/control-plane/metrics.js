// @ts-check
/**
 * In-memory MCP runtime metrics.
 *
 * @module copilot/mcp/control-plane/metrics
 */

const startedAt = Date.now();

/**
 * @typedef {object} ToolMetric
 * @property {number} calls
 * @property {number} errors
 * @property {number} totalDurationMs
 * @property {number | null} lastDurationMs
 * @property {number | null} lastCalledAt
 * @property {boolean | null} lastIsError
 * @property {Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null }>} phases
 */

/** @type {Map<string, ToolMetric>} */
const TOOL_METRICS = new Map();

/**
 * @param {string} tool
 * @param {{ durationMs: number; isError: boolean; phases?: Record<string, number> }} event
 * @returns {void}
 */
export function recordMcpToolMetric(tool, event) {
    const current =
        TOOL_METRICS.get(tool) ??
        ({
            calls: 0,
            errors: 0,
            totalDurationMs: 0,
            lastDurationMs: null,
            lastCalledAt: null,
            lastIsError: null,
            phases: {},
        });
    current.calls += 1;
    current.errors += event.isError ? 1 : 0;
    current.totalDurationMs += event.durationMs;
    current.lastDurationMs = event.durationMs;
    current.lastCalledAt = Date.now();
    current.lastIsError = event.isError;
    for (const [phase, durationMs] of Object.entries(event.phases ?? {})) {
        if (!Number.isFinite(durationMs) || durationMs < 0) continue;
        const phaseMetric = current.phases[phase] ?? { calls: 0, totalDurationMs: 0, lastDurationMs: null };
        phaseMetric.calls += 1;
        phaseMetric.totalDurationMs += durationMs;
        phaseMetric.lastDurationMs = durationMs;
        current.phases[phase] = phaseMetric;
    }
    TOOL_METRICS.set(tool, current);
}

/**
 * @returns {{
 *     startedAt: number;
 *     uptimeMs: number;
 *     totals: { calls: number; errors: number; tools: number };
 *     tools: Record<string, ToolMetric & { averageDurationMs: number; phaseAverages: Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }> }>;
 * }}
 */
export function readMcpMetricsSnapshot() {
    /** @type {Record<string, ToolMetric & { averageDurationMs: number; phaseAverages: Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }> }>} */
    const tools = {};
    let calls = 0;
    let errors = 0;
    for (const [name, metric] of TOOL_METRICS.entries()) {
        calls += metric.calls;
        errors += metric.errors;
        tools[name] = {
            ...metric,
            averageDurationMs: metric.calls > 0 ? Math.round(metric.totalDurationMs / metric.calls) : 0,
            phaseAverages: Object.fromEntries(
                Object.entries(metric.phases).map(([phase, phaseMetric]) => [
                    phase,
                    {
                        ...phaseMetric,
                        averageDurationMs:
                            phaseMetric.calls > 0 ? Math.round(phaseMetric.totalDurationMs / phaseMetric.calls) : 0,
                    },
                ]),
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
        tools,
    };
}

/**
 * @returns {void}
 */
export function resetMcpMetricsForTests() {
    TOOL_METRICS.clear();
}
