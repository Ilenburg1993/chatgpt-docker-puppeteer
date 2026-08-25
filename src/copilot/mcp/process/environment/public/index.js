// @ts-check
/**
 * Public projection for generic MCP child-process environment policy.
 *
 * @module copilot/mcp/process/environment/public
 */

export {
    MCP_CHILD_ENVIRONMENT_POLICY_VERSION,
    buildMcpChildEnvironment,
    isOperationalEnvironmentKey,
    parseMcpEnvironmentFile,
} from '../contracts/child-environment.js';

/** @typedef {import('../contracts/child-environment.js').McpChildEnvironmentProjection} McpChildEnvironmentProjection */
