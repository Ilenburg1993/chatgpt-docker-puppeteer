// @ts-check
/** Public runtime membrane for MCP latency diagnostics. */

/** @typedef {import('../client/evidence.js').ClientThinkingMode} ClientThinkingMode */
/** @typedef {import('../client/evidence.js').ClientLatencyEvidenceEntry} ClientLatencyEvidenceEntry */
/** @typedef {import('../dashboard/history.js').McpLatencyDashboardSnapshot} McpLatencyDashboardSnapshot */
/** @typedef {import('../openai/latency.js').OpenAiEndpointLatencySnapshot} OpenAiEndpointLatencySnapshot */

export {
    DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH,
    appendClientLatencyEvidence,
    readClientLatencyEvidence,
    summarizeClientLatencyEvidence,
    summarizeClientLatencyNumbers,
} from '../client/evidence.js';
export {
    DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH,
    appendMcpLatencyDashboardSnapshot,
    compareMcpLatencyDashboardSnapshots,
    readMcpLatencyDashboardHistory,
} from '../dashboard/history.js';
export {
    DEFAULT_OPENAI_ENDPOINT_LATENCY_HISTORY_RELATIVE_PATH,
    OPENAI_ENDPOINT_LATENCY_TARGETS,
    appendOpenAiEndpointLatencySnapshot,
    compareOpenAiEndpointLatencyToBaseline,
    measureOpenAiEndpointLatency,
    readOpenAiEndpointLatencyHistory,
    summarizeOpenAiEndpointLatencyHistory,
} from '../openai/latency.js';
export {
    readOpenAiEndpointLatencyMonitorState,
    scheduleOpenAiEndpointLatencyMonitor,
    stopOpenAiEndpointLatencyMonitor,
} from '../openai/monitor.js';
export {
    MCP_ROUND_TRIP_NORMALIZER_VERSION,
    configureMcpRoundTripAnalytics,
    getMcpRoundTripAnalytics,
    readMcpRoundTripAnalytics,
    readMcpRoundTripAnalyticsSnapshot,
} from '../round-trip/analytics.js';
export {
    readMcpRoundTripAnalyticsMonitorState,
    scheduleMcpRoundTripAnalyticsMonitor,
    stopMcpRoundTripAnalyticsMonitor,
} from '../round-trip/monitor.js';
