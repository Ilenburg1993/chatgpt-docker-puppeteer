// @ts-check
/** Production public membrane for the canonical MCP registry. */

export {
    buildCanonicalMcpRegistryManifest,
    classifyMcpToolRisk,
    COPILOT_MCP_REGISTRY_IMPLEMENTATION_NAME,
    COPILOT_MCP_REGISTRY_IMPLEMENTATION_VERSION,
    getCanonicalMcpRegistryState,
    getCanonicalMcpToolSurfaceState,
    getCanonicalMcpTools,
    readMcpRegistryPolicy,
    readMcpRegistryRuntimeState,
    registerCanonicalMcpTools,
    validateMcpToolDefinitions,
} from '../runtime.js';
/** @typedef {import('../runtime.js').RegisterCanonicalMcpToolsOptions} RegisterCanonicalMcpToolsOptions */
/** @typedef {import('../surface-policy.js').McpToolSurfacePolicy} McpToolSurfacePolicy */
