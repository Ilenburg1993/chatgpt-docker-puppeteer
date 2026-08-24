// @ts-check
/** @module copilot/mcp/protocol/catalog/public */

/** @typedef {import('../contracts/types.js').McpToolDefinition} McpToolDefinition */

export { normalizeMcpToolDefinitions } from '../metadata.js';
export {
    MCP_SCHEMA_CONVERGENCE_VERSION,
    maybeSendMcpToolsListChangedNotification,
    readMcpSchemaConvergenceState,
    recordMcpDescriptorObservation,
    recordMcpToolsListObserved,
} from '../convergence.js';
