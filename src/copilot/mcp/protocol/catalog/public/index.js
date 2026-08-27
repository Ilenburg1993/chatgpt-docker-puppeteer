// @ts-check
/** @module copilot/mcp/protocol/catalog/public */

/** @typedef {import('../contracts/types.js').McpToolDefinition} McpToolDefinition */
/** @typedef {import('../contracts/types.js').McpRawToolDefinition} McpRawToolDefinition */
/** @typedef {import('../contracts/types.js').McpToolExecutionContract} McpToolExecutionContract */
/** @typedef {import('../contracts/types.js').McpToolContract} McpToolContract */

export { normalizeMcpToolDefinitions } from '../metadata.js';
export { defineMcpRawTool } from '../contracts/definition.js';
export {
    MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND,
    MCP_TOOL_DESCRIPTOR_REVISION_TOKEN_KIND,
    MCP_TOOL_DESCRIPTOR_SET_FINGERPRINT_KIND,
    buildMcpToolDescriptorRevisionToken,
    buildMcpToolWireFingerprintIndex,
    buildMcpToolWireParityProjection,
    compareMcpToolWireFingerprintIndexes,
    extractMcpToolWireDescriptors,
    fingerprintMcpToolWireDescriptor,
    fingerprintMcpToolWireDescriptorSet,
    previewMcpToolNames,
} from '../descriptor-fingerprint.js';
export {
    MCP_DESCRIPTOR_OBSERVATION_VERSION,
    maybeSendMcpToolsListChangedNotification,
    readMcpDescriptorObservationState,
    recordMcpDescriptorObservation,
    recordMcpToolsListObserved,
} from '../descriptor-observation.js';

export { classifyMcpToolContractRisk, projectMcpToolAnnotations, validateMcpToolContractSemantics } from '../contracts/semantics.js';
