// @ts-check
/**
 * Process-scoped configuration authority for MCP latency diagnostics.
 *
 * Ambient parsing is centralized here so benchmark, background monitors and dashboard SLO thresholds share one stable
 * generation. Composition may combine this owner projection with Cloudflare topology without making the latency owner
 * depend on Cloudflare at runtime.
 *
 * @module copilot/mcp/diagnostics/latency/config
 */

export const MCP_LATENCY_CONFIG_SCHEMA_VERSION = 1;

export const MCP_LATENCY_CONFIG_DEFAULTS = Object.freeze({
    benchmark: Object.freeze({
        publicMcpUrl: 'https://mcp.aurelin.org/mcp',
        samples: 10,
        timeoutMs: 10_000,
        warmupSamples: 1,
    }),
    openAiMonitor: Object.freeze({
        initialDelayMs: 30_000,
        intervalMs: 5 * 60 * 1000,
        timeoutMs: 2_500,
    }),
    roundTripMonitor: Object.freeze({
        initialDelayMs: 20_000,
        intervalMs: 60_000,
    }),
    dashboard: Object.freeze({
        toolAverageWarnMs: 1_000,
        authorizationAverageWarnMs: 250,
        handlerAverageWarnMs: 750,
        resultSizeAverageWarnMs: 250,
        errorRateWarn: 0.001,
        silentExternalGapP50WarnMs: 3_000,
        silentExternalGapP95WarnMs: 8_000,
    }),
});

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     benchmark: Readonly<{
 *         publicMcpUrl: string | null;
 *         localMcpUrl: string | null;
 *         samples: number;
 *         timeoutMs: number;
 *         warmupSamples: number;
 *     }>;
 *     openAiMonitor: Readonly<{
 *         enabled: boolean;
 *         initialDelayMs: number;
 *         intervalMs: number;
 *         timeoutMs: number;
 *     }>;
 *     roundTripMonitor: Readonly<{
 *         enabled: boolean;
 *         initialDelayMs: number;
 *         intervalMs: number;
 *     }>;
 *     dashboard: McpLatencyDashboardPolicy;
 * }>} McpLatencyProcessConfig
 *
 * @typedef {Readonly<{
 *     toolAverageWarnMs: number;
 *     authorizationAverageWarnMs: number;
 *     handlerAverageWarnMs: number;
 *     resultSizeAverageWarnMs: number;
 *     errorRateWarn: number;
 *     silentExternalGapP50WarnMs: number;
 *     silentExternalGapP95WarnMs: number;
 * }>} McpLatencyDashboardPolicy
 *
 * @typedef {Readonly<{
 *     owner: McpLatencyProcessConfig;
 *     benchmark: Readonly<{
 *         publicMcpUrl: string;
 *         localMcpUrl: string;
 *         localOriginServerName: string;
 *         samples: number;
 *         timeoutMs: number;
 *         warmupSamples: number;
 *     }>;
 * }>} McpLatencyRuntimeConfig
 */

/**
 * Capture one immutable latency-diagnostics generation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpLatencyProcessConfig}
 */
export function readMcpLatencyProcessConfig(env = process.env) {
    const defaultMonitorEnabled = env['NODE_ENV'] !== 'test' && !env['VITEST'];
    return Object.freeze({
        schemaVersion: MCP_LATENCY_CONFIG_SCHEMA_VERSION,
        benchmark: Object.freeze({
            publicMcpUrl: readOptionalString(env['COPILOT_MCP_LATENCY_PUBLIC_URL']),
            localMcpUrl: readOptionalString(env['COPILOT_MCP_LATENCY_LOCAL_URL']),
            samples: readRangeIntegerOrFallback(
                env['COPILOT_MCP_LATENCY_SAMPLES'],
                MCP_LATENCY_CONFIG_DEFAULTS.benchmark.samples,
                1,
                100,
            ),
            timeoutMs: readRangeIntegerOrFallback(
                env['COPILOT_MCP_LATENCY_TIMEOUT_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.benchmark.timeoutMs,
                500,
                60_000,
            ),
            warmupSamples: readRangeIntegerOrFallback(
                env['COPILOT_MCP_LATENCY_WARMUP_SAMPLES'],
                MCP_LATENCY_CONFIG_DEFAULTS.benchmark.warmupSamples,
                0,
                10,
            ),
        }),
        openAiMonitor: Object.freeze({
            enabled: readBoolean(env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_ENABLED'], defaultMonitorEnabled),
            initialDelayMs: readBoundedNumber(
                env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_INITIAL_DELAY_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.openAiMonitor.initialDelayMs,
                0,
                10 * 60 * 1000,
                true,
            ),
            intervalMs: readBoundedNumber(
                env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_INTERVAL_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.openAiMonitor.intervalMs,
                60_000,
                60 * 60 * 1000,
                true,
            ),
            timeoutMs: readBoundedNumber(
                env['COPILOT_MCP_OPENAI_ENDPOINT_MONITOR_TIMEOUT_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.openAiMonitor.timeoutMs,
                500,
                10_000,
                true,
            ),
        }),
        roundTripMonitor: Object.freeze({
            enabled: readBoolean(env['COPILOT_MCP_ROUND_TRIP_ANALYTICS_MONITOR_ENABLED'], defaultMonitorEnabled),
            initialDelayMs: readBoundedNumber(
                env['COPILOT_MCP_ROUND_TRIP_ANALYTICS_INITIAL_DELAY_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.roundTripMonitor.initialDelayMs,
                0,
                10 * 60 * 1000,
                true,
            ),
            intervalMs: readBoundedNumber(
                env['COPILOT_MCP_ROUND_TRIP_ANALYTICS_INTERVAL_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.roundTripMonitor.intervalMs,
                30_000,
                30 * 60 * 1000,
                true,
            ),
        }),
        dashboard: Object.freeze({
            toolAverageWarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_TOOL_AVERAGE_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.toolAverageWarnMs,
                true,
            ),
            authorizationAverageWarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_AUTHORIZATION_AVERAGE_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.authorizationAverageWarnMs,
                true,
            ),
            handlerAverageWarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_HANDLER_AVERAGE_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.handlerAverageWarnMs,
                true,
            ),
            resultSizeAverageWarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_RESULT_SIZE_AVERAGE_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.resultSizeAverageWarnMs,
                true,
            ),
            errorRateWarn: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_ERROR_RATE_WARN'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.errorRateWarn,
                false,
            ),
            silentExternalGapP50WarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_SILENT_EXTERNAL_GAP_P50_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.silentExternalGapP50WarnMs,
                true,
            ),
            silentExternalGapP95WarnMs: readPositiveNumber(
                env['COPILOT_MCP_LATENCY_SILENT_EXTERNAL_GAP_P95_WARN_MS'],
                MCP_LATENCY_CONFIG_DEFAULTS.dashboard.silentExternalGapP95WarnMs,
                true,
            ),
        }),
    });
}

/**
 * Combine latency-owned policy with topology supplied by composition.
 *
 * @param {McpLatencyProcessConfig} owner
 * @param {{
 *     publicMcpUrl?: string | undefined;
 *     localMcpUrl: string;
 *     originServerName?: string | undefined;
 *     publicHostname?: string | undefined;
 * }} topology
 * @returns {McpLatencyRuntimeConfig}
 */
export function createMcpLatencyRuntimeConfig(owner, topology) {
    const publicMcpUrl =
        owner.benchmark.publicMcpUrl || topology.publicMcpUrl || MCP_LATENCY_CONFIG_DEFAULTS.benchmark.publicMcpUrl;
    return Object.freeze({
        owner,
        benchmark: Object.freeze({
            publicMcpUrl,
            localMcpUrl: owner.benchmark.localMcpUrl || topology.localMcpUrl,
            localOriginServerName:
                topology.originServerName || topology.publicHostname || readUrlHostname(publicMcpUrl) || 'localhost',
            samples: owner.benchmark.samples,
            timeoutMs: owner.benchmark.timeoutMs,
            warmupSamples: owner.benchmark.warmupSamples,
        }),
    });
}

/** @param {string} value */
function readUrlHostname(value) {
    try {
        return new URL(value).hostname;
    } catch {
        return '';
    }
}

/** @param {unknown} value */
function readOptionalString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function readRangeIntegerOrFallback(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max @param {boolean} integer */
function readBoundedNumber(value, fallback, min, max, integer) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const bounded = Math.min(max, Math.max(min, parsed));
    return integer ? Math.round(bounded) : bounded;
}

/** @param {unknown} value @param {number} fallback @param {boolean} integer */
function readPositiveNumber(value, fallback, integer) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return integer ? Math.floor(parsed) : parsed;
}
