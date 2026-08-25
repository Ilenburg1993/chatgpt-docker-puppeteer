// @ts-check
/** Public runtime membrane for MCP latency diagnostics. */

/** @typedef {import('../client/evidence.js').ClientThinkingMode} ClientThinkingMode */
/** @typedef {import('../client/evidence.js').ClientLatencyEvidenceEntry} ClientLatencyEvidenceEntry */
/** @typedef {import('../openai/latency.js').OpenAiEndpointLatencySnapshot} OpenAiEndpointLatencySnapshot */
/** @typedef {import('../config.js').McpLatencyProcessConfig} McpLatencyProcessConfig */
/** @typedef {import('../config.js').McpLatencyDashboardPolicy} McpLatencyDashboardPolicy */
/** @typedef {import('../config.js').McpLatencyRuntimeConfig} McpLatencyRuntimeConfig */

export {
    MCP_LATENCY_CONFIG_DEFAULTS,
    MCP_LATENCY_CONFIG_SCHEMA_VERSION,
    createMcpLatencyRuntimeConfig,
    readMcpLatencyProcessConfig,
} from '../config.js';

export {
    DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH,
    appendClientLatencyEvidence,
    readClientLatencyEvidence,
    summarizeClientLatencyEvidence,
    summarizeClientLatencyNumbers,
} from '../client/evidence.js';
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
