// @ts-check
/** Public runtime membrane for stateful MCP Streamable HTTP transport state. */

/** @typedef {import('../session/runtime.js').McpHttpSessionAuthBinding} McpHttpSessionAuthBinding */
/** @typedef {ReturnType<typeof import('../session/runtime.js').createMcpHttpSessionRuntime>} McpHttpSessionRuntime */
/** @typedef {import('../session/config.js').McpHttpStatefulProcessConfig} McpHttpStatefulProcessConfig */
/** @typedef {import('../session/config.js').McpHttpStatefulRuntimePolicySnapshot} McpHttpStatefulRuntimePolicySnapshot */
/** @typedef {import('../events/store.js').McpSdkCompatibleEventStore} McpSdkCompatibleEventStore */

export {
    DEFAULT_MCP_HTTP_MAX_SESSIONS,
    DEFAULT_MCP_HTTP_SESSION_TTL_MS,
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_KIND,
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_SCHEMA_VERSION,
    readMcpHttpStatefulProcessConfig,
    readMcpHttpStatefulRuntimePolicySnapshot,
    readMcpHttpStatefulSessionPolicy,
} from '../session/config.js';
export {
    createMcpHttpSessionRuntimeForConfig,
    hashMcpHttpSessionId,
    readMcpHttpSessionRuntimeState,
} from '../session/runtime.js';
export { createMcpInMemoryEventStore, createSqliteMcpEventStore, parseMcpEventId } from '../events/store.js';
export { getDefaultMcpHttpStreamRegistry } from '../streams/registry.js';

export { handleStatefulMcpHttpRequest } from '../router.js';
export { classifyMcpPostSessionRequirement, isMcpInitializeRequestBody, normalizeMcpSessionId } from '../request-contract.js';
