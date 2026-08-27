// @ts-check
/**
 * Public projection for MCP tool protocol contracts.
 *
 * @module copilot/mcp/protocol/tools/public
 */

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
export { MCP_RECOVERY_RECIPE_VERSION, createMcpRecoveryRecipe } from '../contracts/recovery.js';
export {
    MCP_TOOL_OPERATION_CONTEXT_VERSION,
    createMcpToolOperationContext,
    requireMcpToolAuthConfig,
    requireMcpToolAiArtifactsCapability,
    requireMcpToolAuditCapability,
    requireMcpToolAuthIssuerConfig,
    requireMcpToolAuthIssuerRuntime,
    requireMcpToolCloudflareConfig,
    requireMcpToolCloudflareEnvironmentAuthority,
    requireMcpToolCompanyKnowledgeConfig,
    requireMcpToolDevcontainerNetworkConfig,
    requireMcpToolGitConfig,
    requireMcpToolIoCacheConfig,
    requireMcpToolIndexAutoBuildConfig,
    requireMcpToolInfraHealthCapability,
    requireMcpToolModelGatewayLiveRunEnvironmentAuthority,
    requireMcpToolModelGatewaySqliteFingerprintCapability,
    requireMcpToolLatencyDashboardConfig,
    requireMcpToolReloadConfig,
    requireMcpToolRepositoryPatchConfig,
    requireMcpToolRepositoryReadCacheConfig,
    requireMcpToolRuntimeSourceGeneration,
    requireMcpToolRoundTripAnalyticsCapability,
    requireMcpToolSurface,
    requireMcpToolTerminalConfig,
    requireMcpToolPayloadAuditConfig,
    requireMcpToolValidationConfig,
    requireMcpToolWorkspace,
} from '../contracts/operation-context.js';

/** @typedef {import('../contracts/operation-context.js').McpToolOperationContext} McpToolOperationContext */
/** @typedef {import('../contracts/operation-context.js').McpToolConfigProjection} McpToolConfigProjection */
/** @typedef {import('../contracts/operation-context.js').McpToolCapabilityProjection} McpToolCapabilityProjection */
/** @typedef {import('../contracts/result.js').StructuredCallToolResult} StructuredCallToolResult */
