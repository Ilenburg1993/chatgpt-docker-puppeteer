// @ts-check
/**
 * Public membrane for the MCP workspace owner.
 *
 * Cross-owner consumers receive workspace identity and the explicit capability factory only. Internal workspace
 * topology remains private.
 *
 * @module copilot/mcp/workspace/public
 */

export { createMcpWorkspaceCapability } from '../contracts/capability.js';
export { MCP_WORKSPACE_ROOT, toMcpWorkspaceRelativePath } from '../contracts/root.js';

/** @typedef {import('../contracts/capability.js').McpWorkspaceCapability} McpWorkspaceCapability */
/** @typedef {import('../contracts/capability.js').McpPathOk} McpPathOk */
/** @typedef {import('../contracts/capability.js').McpValidatedReadPathOk} McpValidatedReadPathOk */
/** @typedef {import('../contracts/capability.js').McpPathError} McpPathError */
