// @ts-check
/** Exact public membrane for the MCP latency dashboard owner. */

export { buildMcpLatencyDashboard } from '../runtime.js';
export {
    DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH,
    appendMcpLatencyDashboardSnapshot,
    compareMcpLatencyDashboardSnapshots,
    readMcpLatencyDashboardHistory,
} from '../history.js';

/** @typedef {import('../history.js').McpLatencyDashboardSnapshot} McpLatencyDashboardSnapshot */
