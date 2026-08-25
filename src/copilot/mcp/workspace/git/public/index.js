// @ts-check
/** Exact public membrane for governed workspace Git execution. */

export {
    createMcpGitProcessConfig,
    MCP_GIT_PROCESS_CONFIG_KIND,
    MCP_GIT_PROCESS_CONFIG_SCHEMA_VERSION,
} from '../config.js';
export { execWorkspaceGit } from '../runtime.js';
/** @typedef {import('../config.js').McpGitProcessConfig} McpGitProcessConfig */
/** @typedef {import('../runtime.js').WorkspaceGitExecutionResult} WorkspaceGitExecutionResult */
