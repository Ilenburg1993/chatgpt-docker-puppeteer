// @ts-check
/** Listener-generation HTTP runtime state projection. */

import { readMcpHttpSessionRuntimeState as readStatefulMcpHttpSessionRuntimeState } from '#copilot/mcp/public/transport/http/stateful/runtime';
import { getDefaultMcpHttpStreamRegistry } from '#copilot/mcp/public/transport/http/stateful/streams';

/**
 * @param {ReturnType<typeof import('#copilot/mcp/public/transport/http/stateful/runtime').createMcpHttpSessionRuntimeForConfig>} runtime
 * @param {import('#copilot/mcp/public/transport/http/stateful/config').McpHttpStatefulProcessConfig} config
 * @returns {Record<string, unknown>}
 */
export function readMcpHttpSessionRuntimeState(runtime, config) {
    return {
        ...readStatefulMcpHttpSessionRuntimeState(runtime, config),
        streamRegistry: getDefaultMcpHttpStreamRegistry().snapshot(),
    };
}
