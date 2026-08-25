// @ts-check
/** Exact public membrane for stateful MCP HTTP process/session configuration. */

/** @typedef {import('../session/config.js').McpHttpStatefulProcessConfig} McpHttpStatefulProcessConfig */
/** @typedef {import('../session/config.js').McpHttpStatefulRuntimePolicySnapshot} McpHttpStatefulRuntimePolicySnapshot */

export {
    DEFAULT_MCP_HTTP_MAX_SESSIONS,
    DEFAULT_MCP_HTTP_SESSION_TTL_MS,
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_KIND,
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_SCHEMA_VERSION,
    readMcpHttpStatefulProcessConfig,
    readMcpHttpStatefulRuntimePolicySnapshot,
    readMcpHttpStatefulSessionPolicy,
} from '../session/config.js';
