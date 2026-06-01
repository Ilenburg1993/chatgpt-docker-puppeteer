// @ts-check
/**
 * Canonical MCP tool registry for ChatGPT connector.
 *
 * Latency hardening:
 *
 * - The registry is still canonical and all tool implementations remain available in the codebase.
 * - `COPILOT_MCP_TOOL_SURFACE` can advertise a smaller tool surface to reduce `tools/list` payload and connection latency
 *   without deleting tools.
 * - Audit/metrics failures are isolated from tool execution so telemetry cannot break an otherwise valid tool call.
 *
 * @module copilot/mcp/registry
 */

import { appendMcpAuditEvent } from './control-plane/audit.js';
import { authorizeMcpToolCall } from './control-plane/auth.js';
import { recordMcpToolMetric } from './control-plane/metrics.js';
import { errorResult } from './control-plane/result.js';
import { normalizeMcpToolDefinitions } from './control-plane/tool-metadata.js';
import {
    applyMcpToolSurfacePolicy,
    describeMcpToolSurfacePolicy,
    readMcpToolSurfacePolicy,
    toolSurfaceCacheKey,
} from './tool-surface.js';
import { mcpAppsSdkReadinessTool } from './tools/apps-sdk-readiness.js';
import { mcpCloudflareConfigAuditTool, mcpCloudflarePlanCapabilitiesAuditTool } from './tools/cloudflare-config.js';
import { mcpCloudflareEdgePolicyApplyTool } from './tools/cloudflare-edge-apply.js';
import { mcpCloudflareEdgeBackupCreateTool, mcpCloudflareEdgeBackupsListTool } from './tools/cloudflare-edge-backup.js';
import { mcpCloudflareEdgePolicyDiffTool } from './tools/cloudflare-edge-diff.js';
import { mcpCloudflareEdgePolicyPlanTool } from './tools/cloudflare-edge-policy.js';
import { mcpCloudflareEdgeSnapshotTool } from './tools/cloudflare-edge-snapshot.js';
import { mcpCloudflareEdgeAuditTool } from './tools/cloudflare-edge.js';
import { mcpCloudflareMetricsSnapshotTool } from './tools/cloudflare-metrics.js';
import {
    mcpCloudflareMcpPassthroughApplyTool,
    mcpCloudflareMcpPassthroughDiffTool,
    mcpCloudflareMcpPassthroughPlanTool,
} from './tools/cloudflare-passthrough.js';
import { mcpCloudflarePostChangeGatesTool } from './tools/cloudflare-post-change-gates.js';
import { mcpCloudflareRemoteAuditTool } from './tools/cloudflare-remote.js';
import { mcpCloudflareSkipAuditTool } from './tools/cloudflare-skip.js';
import { mcpCloudflareTransportBenchmarkPlanTool } from './tools/cloudflare-transport-benchmark.js';
import { connectionTools } from './tools/connection.js';
import { copilotSessionTools } from './tools/copilot-session.js';
import { delegateToRepoAutonomyRunnerTool } from './tools/delegation-runner.js';
import { mcpDevcontainerNetworkPostureAuditTool } from './tools/devcontainer-network-posture.js';
import { gitReadTools } from './tools/git-read.js';
import { mcpGoldenPromptsTool } from './tools/golden-prompts.js';
import { mcpHostBlockDiagnosticsTool } from './tools/host-blocks.js';
import { jobTools } from './tools/jobs.js';
import { maintenanceTools } from './tools/maintenance.js';
import { metaTools } from './tools/meta.js';
import { bindMcpOAuthFrictionAuditProvider, mcpOAuthFrictionAuditTool } from './tools/oauth-friction-audit.js';
import { projectDoctorTool } from './tools/project-doctor.js';
import { repoIndexTools } from './tools/repo-index.js';
import { repoPlanTools } from './tools/repo-plan.js';
import { repoReadTools } from './tools/repo-read.js';
import { repoWriteTools } from './tools/repo-write.js';
import { mcpRuntimeHealthTool } from './tools/runtime-health.js';
import { mcpSessionProfileTool } from './tools/session-profile.js';
import { mcpSmokeWorkspaceTool } from './tools/smoke-workspace.js';
import { bindMcpToolsStatusProvider, mcpAutonomyPowerScoreTool, mcpToolsStatusTool } from './tools/tools-status.js';
import {
    mcpConnectorSmokeRefreshTool,
    mcpPostRestartReadinessTool,
    mcpTunnelStatusTool,
} from './tools/tunnel-status.js';
const devcontainerNetworkTools = [mcpDevcontainerNetworkPostureAuditTool];

/** @type {McpToolDefinition[] | null} */
let canonicalMcpToolsCache = null;
/** @type {string | null} */
let canonicalMcpToolsCacheKey = null;
/** @type {Record<string, unknown> | null} */
let canonicalMcpToolSurfaceState = null;

/**
 * @typedef {object} McpToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodType>} inputSchema
 * @property {import('zod').ZodType | Record<string, import('zod').ZodType>} [outputSchema]
 * @property {Record<string, unknown>[]} [securitySchemes]
 * @property {Record<string, unknown>} [_meta]
 * @property {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations} annotations
 * @property {(
 *     args: any,
 * ) =>
 *     | Promise<import('./control-plane/result.js').StructuredCallToolResult>
 *     | import('./control-plane/result.js').StructuredCallToolResult} handler
 *
 *
 * @typedef {object} RegisterCanonicalMcpToolsOptions
 * @property {import('./control-plane/auth.js').McpAuthContext} [authContext]
 * @property {import('./tool-surface.js').McpToolSurfacePolicy} [toolSurfacePolicy]
 */

/**
 * @param {{
 *     toolSurfacePolicy?: import('./tool-surface.js').McpToolSurfacePolicy;
 * }} [options]
 * @returns {McpToolDefinition[]}
 */
export function getCanonicalMcpTools(options = {}) {
    const policy = options.toolSurfacePolicy ?? readMcpToolSurfacePolicy();
    const cacheKey = toolSurfaceCacheKey(policy);
    if (canonicalMcpToolsCache && canonicalMcpToolsCacheKey === cacheKey) return canonicalMcpToolsCache;

    const allTools = normalizeMcpToolDefinitions([
        ...repoReadTools,
        ...repoPlanTools,
        ...repoIndexTools,
        ...gitReadTools,
        projectDoctorTool,
        ...jobTools,
        ...maintenanceTools,
        delegateToRepoAutonomyRunnerTool,
        mcpGoldenPromptsTool,
        mcpAppsSdkReadinessTool,
        ...devcontainerNetworkTools,
        mcpCloudflareConfigAuditTool,
        mcpCloudflarePlanCapabilitiesAuditTool,
        mcpCloudflareEdgeBackupCreateTool,
        mcpCloudflareEdgeBackupsListTool,
        mcpCloudflareEdgeAuditTool,
        mcpCloudflareEdgePolicyApplyTool,
        mcpCloudflareEdgePolicyDiffTool,
        mcpCloudflareEdgePolicyPlanTool,
        mcpCloudflareEdgeSnapshotTool,
        mcpCloudflareMetricsSnapshotTool,
        mcpCloudflarePostChangeGatesTool,
        mcpCloudflareTransportBenchmarkPlanTool,
        mcpHostBlockDiagnosticsTool,
        ...connectionTools,
        mcpCloudflareRemoteAuditTool,
        mcpCloudflareSkipAuditTool,
        mcpCloudflareMcpPassthroughPlanTool,
        mcpCloudflareMcpPassthroughDiffTool,
        mcpCloudflareMcpPassthroughApplyTool,
        ...repoWriteTools,
        ...copilotSessionTools,
        ...metaTools,
        mcpOAuthFrictionAuditTool,
        mcpSessionProfileTool,
        mcpAutonomyPowerScoreTool,
        mcpToolsStatusTool,
        mcpSmokeWorkspaceTool,
        mcpTunnelStatusTool,
        mcpConnectorSmokeRefreshTool,
        mcpPostRestartReadinessTool,
        mcpRuntimeHealthTool,
    ]);

    const tools = applyMcpToolSurfacePolicy(allTools, policy);
    assertUniqueToolNames(tools);
    canonicalMcpToolsCache = tools;
    canonicalMcpToolsCacheKey = cacheKey;
    canonicalMcpToolSurfaceState = describeMcpToolSurfacePolicy(tools, allTools, policy);
    bindMcpToolsStatusProvider(() => canonicalMcpToolsCache ?? tools);
    bindMcpOAuthFrictionAuditProvider(() => canonicalMcpToolsCache ?? tools);
    return tools;
}

/**
 * @returns {Record<string, unknown>}
 */
export function getCanonicalMcpToolSurfaceState() {
    if (!canonicalMcpToolSurfaceState) {
        getCanonicalMcpTools();
    }
    return canonicalMcpToolSurfaceState ?? {};
}

/**
 * Test helper for env/profile switching inside one Node process.
 *
 * @returns {void}
 */
export function resetCanonicalMcpToolsCacheForTests() {
    canonicalMcpToolsCache = null;
    canonicalMcpToolsCacheKey = null;
    canonicalMcpToolSurfaceState = null;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {RegisterCanonicalMcpToolsOptions} [options]
 * @returns {McpToolDefinition[]}
 */
export function registerCanonicalMcpTools(server, options = {}) {
    const tools = getCanonicalMcpTools(
        options.toolSurfacePolicy === undefined ? {} : { toolSurfacePolicy: options.toolSurfacePolicy },
    );
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            /** @type {Parameters<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>[1]} */ ({
                title: tool.title,
                description: tool.description,
                inputSchema: /** @type {Parameters<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>[1]['inputSchema']} */ (/** @type {unknown} */ (tool.inputSchema)),
                annotations: tool.annotations,
                ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
                ...(tool.securitySchemes !== undefined ? { securitySchemes: tool.securitySchemes } : {}),
                ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
            }),
            /** @param {Record<string, unknown>} args */
            async (args) => {
                const startedAt = Date.now();
                await safeAppendMcpAuditEvent({
                    event: 'tool_call_started',
                    tool: tool.name,
                    readOnly: tool.annotations.readOnlyHint === true,
                });
                try {
                    const authorization = await authorizeMcpToolCall(tool, options.authContext);
                    if (!authorization.allowed) {
                        await safeAppendMcpAuditEvent({
                            event: 'tool_call_auth_denied',
                            tool: tool.name,
                            durationMs: elapsedMs(startedAt),
                            code: authorization.code,
                            requiredScopes: authorization.requiredScopes,
                        });
                        safeRecordMcpToolMetric(tool.name, {
                            durationMs: elapsedMs(startedAt),
                            isError: true,
                        });
                        return errorResult(
                            authorization.message ?? 'MCP authorization failed.',
                            {
                                code: authorization.code ?? 'MCP_AUTH_DENIED',
                                hint: authorization.hint,
                                requiredScopes: authorization.requiredScopes,
                                enforcement: authorization.enforcement,
                            },
                            authorization.challenge
                                ? {
                                      'mcp/www_authenticate': authorization.challenge,
                                  }
                                : undefined,
                        );
                    }
                    const result = await tool.handler(args);
                    await safeAppendMcpAuditEvent({
                        event: 'tool_call_completed',
                        tool: tool.name,
                        durationMs: elapsedMs(startedAt),
                        isError: result.isError === true,
                    });
                    safeRecordMcpToolMetric(tool.name, {
                        durationMs: elapsedMs(startedAt),
                        isError: result.isError === true,
                    });
                    return result;
                } catch (error) {
                    await safeAppendMcpAuditEvent({
                        event: 'tool_call_failed',
                        tool: tool.name,
                        durationMs: elapsedMs(startedAt),
                        error: error instanceof Error ? error.message : String(error),
                    });
                    safeRecordMcpToolMetric(tool.name, {
                        durationMs: elapsedMs(startedAt),
                        isError: true,
                    });
                    throw error;
                }
            },
        );
    }
    return tools;
}

/**
 * @param {McpToolDefinition[]} tools
 * @returns {void}
 */
function assertUniqueToolNames(tools) {
    const names = new Set();
    for (const tool of tools) {
        if (names.has(tool.name)) {
            throw new Error(`Duplicate MCP tool name after surface filtering: ${tool.name}`);
        }
        names.add(tool.name);
    }
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Date.now() - startedAt;
}

/**
 * @param {Parameters<typeof appendMcpAuditEvent>[0]} event
 * @returns {Promise<void>}
 */
async function safeAppendMcpAuditEvent(event) {
    try {
        await appendMcpAuditEvent(event);
    } catch {
        // Telemetry failures must not break a tool call.
    }
}

/**
 * @param {string} toolName
 * @param {Parameters<typeof recordMcpToolMetric>[1]} metric
 * @returns {void}
 */
function safeRecordMcpToolMetric(toolName, metric) {
    try {
        recordMcpToolMetric(toolName, metric);
    } catch {
        // Metrics failures must not break a tool call.
    }
}
