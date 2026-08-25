// @ts-check
/** MCP HTTP health projection assembled from already-owned runtime/config state. */

import { readMcpAuthJwksWarmupState } from '#copilot/mcp/public/auth';
import { readMcpIndexAutoBuildState } from '#copilot/mcp/public/indexing/auto-build';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { readMcpStartupMaintenanceState } from '#copilot/mcp/public/runtime/startup-maintenance';
import { buildMcpHttpProtocolReport } from '../http-protocol.js';
import { MCP_PATH } from './route-policy.js';
import { readMcpHttpSessionRuntimeState } from './runtime-state.js';

/**
 * @param {{
 *   implementationVersion: string;
 *   protocolState: import('../http-protocol.js').McpHttpProtocolState;
 *   requestPolicy: ReturnType<typeof import('./config.js').readMcpHttpRequestPolicy>;
 *   indexAutoBuildConfig?: import('#copilot/mcp/public/indexing/auto-build').McpIndexAutoBuildConfig;
 *   sessionRuntime: ReturnType<typeof import('#copilot/mcp/public/transport/http/stateful/runtime').createMcpHttpSessionRuntimeForConfig>;
 *   statefulConfig: import('#copilot/mcp/public/transport/http/stateful/config').McpHttpStatefulProcessConfig;
 *   anonymousRateLimitRuntime: { activeBuckets: number; maxBuckets: number };
 * }} options
 */
export function buildMcpHttpHealthPayload(options) {
    return {
        ok: true,
        name: 'copilot-mcp',
        mcpPath: MCP_PATH,
        metrics: readMcpMetricsSnapshot(),
        indexAutoBuild: readMcpIndexAutoBuildState(options.indexAutoBuildConfig),
        authJwksWarmup: readMcpAuthJwksWarmupState(),
        startupMaintenance: readMcpStartupMaintenanceState(),
        http: {
            implementationVersion: options.implementationVersion,
            timingPolicy: options.requestPolicy.timing,
            sessionRuntime: readMcpHttpSessionRuntimeState(options.sessionRuntime, options.statefulConfig),
            transportPolicy: options.requestPolicy.transport,
            corsPolicy: options.requestPolicy.cors,
            anonymousRateLimit: {
                ...options.requestPolicy.anonymousRateLimit,
                ...options.anonymousRateLimitRuntime,
            },
            protocol: buildMcpHttpProtocolReport(options.protocolState),
        },
    };
}
