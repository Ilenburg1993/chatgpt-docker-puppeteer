// @ts-check
/**
 * Public projection for MCP tool protocol contracts.
 *
 * @module copilot/mcp/protocol/tools/public
 */

export {
    boundedWriteAnnotations,
    destructiveAnnotations,
    openWorldBoundedWriteAnnotations,
    openWorldDestructiveAnnotations,
    openWorldReadOnlyAnnotations,
    readOnlyAnnotations,
} from '../contracts/annotations.js';
export { MCP_TOOL_EXECUTION_LIMITS, MCP_TOOL_EXECUTION_LIMITS_VERSION } from '../contracts/execution-limits.js';
export {
    asRecord,
    errorResult,
    estimateStructuredTextResultBytes,
    getResultExecutionHint,
    getResultSizeHint,
    okResult,
    stringifyForModel,
    withResultExecutionHint,
    withResultSizeHint,
} from '../contracts/result.js';
export {
    MCP_TOOL_OPERATION_CONTEXT_VERSION,
    createMcpToolOperationContext,
    requireMcpToolWorkspace,
} from '../contracts/operation-context.js';

/** @typedef {import('../contracts/operation-context.js').McpToolOperationContext} McpToolOperationContext */
/** @typedef {import('../contracts/result.js').StructuredCallToolResult} StructuredCallToolResult */
