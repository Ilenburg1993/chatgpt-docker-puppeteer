// @ts-check
/** Test-only membrane for stateful HTTP session/event/stream internals. */

export {
    DEFAULT_MCP_EVENTS_PER_STREAM,
    DEFAULT_MCP_EVENT_TTL_MS,
    MCP_EVENT_STORE_VERSION,
    buildMcpEventId,
    createMcpInMemoryEventStore,
    createSqliteMcpEventStore,
    ensureMcpEventStoreSchema,
    normalizeStreamId,
    parseMcpEventId,
} from '../events/store.js';
export {
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_KIND,
    MCP_HTTP_STATEFUL_PROCESS_CONFIG_SCHEMA_VERSION,
    readMcpHttpStatefulProcessConfig,
    readMcpHttpStatefulRuntimePolicySnapshot,
    readMcpHttpStatefulSessionPolicy,
} from '../session/config.js';
export {
    DEFAULT_MCP_HTTP_MAX_SESSIONS,
    DEFAULT_MCP_HTTP_SESSION_TTL_MS,
    MCP_HTTP_SESSION_RUNTIME_VERSION,
    createMcpHttpSessionRuntime,
    createMcpHttpSessionRuntimeForConfig,
    hashMcpHttpSessionId,
    previewMcpHttpSessionId,
    readMcpHttpSessionRuntimeState,
    validateRawSessionId,
} from '../session/runtime.js';
export { createSqliteMcpHttpSessionStoreForDb, ensureMcpHttpSessionStoreSchema } from '../session/store.js';
export { MCP_STREAM_REGISTRY_VERSION, createMcpHttpStreamRegistry } from '../streams/registry.js';
