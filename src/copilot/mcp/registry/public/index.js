// @ts-check
/** Production public membrane for the canonical MCP registry. */

export {
    buildCanonicalMcpRegistryManifest,
    buildMcpToolWireDescriptorSnapshot,
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
export {
    MCP_TOOL_SURFACE_MODES,
    MCP_TOOL_SURFACE_POLICY_VERSION,
    createMcpToolSurfacePolicy,
    readMcpToolSurfacePolicy,
    resolveMcpToolSurfaceCanonicalProfile,
} from '../surface-policy.js';
/** @typedef {import('../runtime.js').RegisterCanonicalMcpToolsOptions} RegisterCanonicalMcpToolsOptions */
/** @typedef {import('../runtime.js').McpRegistryPolicy} McpRegistryPolicy */
/** @typedef {import('../surface-policy.js').McpToolSurfacePolicy} McpToolSurfacePolicy */
