// @ts-check
/** @module copilot/mcp/protocol/catalog/public */

/** @typedef {import('../contracts/types.js').McpToolDefinition} McpToolDefinition */
/** @typedef {import('../contracts/types.js').McpRawToolDefinition} McpRawToolDefinition */
/** @typedef {import('../contracts/types.js').McpToolExecutionContract} McpToolExecutionContract */
/** @typedef {import('../contracts/types.js').McpToolContract} McpToolContract */

export { normalizeMcpToolDefinitions } from '../metadata.js';
export { defineMcpRawTool } from '../contracts/definition.js';
export {
    MCP_SCHEMA_CONVERGENCE_VERSION,
    maybeSendMcpToolsListChangedNotification,
    readMcpSchemaConvergenceState,
    recordMcpDescriptorObservation,
    recordMcpToolsListObserved,
} from '../convergence.js';

export { classifyMcpToolContractRisk, projectMcpToolAnnotations, validateMcpToolContractSemantics } from '../contracts/semantics.js';
