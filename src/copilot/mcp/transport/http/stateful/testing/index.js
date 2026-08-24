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
    DEFAULT_MCP_HTTP_MAX_SESSIONS,
    DEFAULT_MCP_HTTP_SESSION_TTL_MS,
    MCP_HTTP_SESSION_RUNTIME_VERSION,
    createMcpHttpSessionRuntime,
    previewMcpHttpSessionId,
    resetDefaultMcpHttpSessionRuntimeForTests,
    validateRawSessionId,
} from '../session/runtime.js';
export { createSqliteMcpHttpSessionStoreForDb, ensureMcpHttpSessionStoreSchema } from '../session/store.js';
export { MCP_STREAM_REGISTRY_VERSION, createMcpHttpStreamRegistry } from '../streams/registry.js';
