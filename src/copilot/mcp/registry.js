// @ts-check
/**
 * Canonical MCP tool registry for ChatGPT connector.
 *
 * @module copilot/mcp/registry
 */

import { appendMcpAuditEvent } from './control-plane/audit.js';
import { authorizeMcpToolCall } from './control-plane/auth.js';
import { recordMcpToolMetric } from './control-plane/metrics.js';
import { errorResult } from './control-plane/result.js';
import { normalizeMcpToolDefinitions } from './control-plane/tool-metadata.js';
import { mcpAppsSdkReadinessTool } from './tools/apps-sdk-readiness.js';
import { mcpCloudflareMetricsSnapshotTool } from './tools/cloudflare-metrics.js';
import { connectionTools } from './tools/connection.js';
import { mcpCloudflareRemoteAuditTool } from './tools/cloudflare-remote.js';
import { copilotSessionTools } from './tools/copilot-session.js';
import { delegateToRepoAutonomyRunnerTool } from './tools/delegation-runner.js';
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

/**
 * @typedef {object} McpToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodTypeAny>} inputSchema
 * @property {import('zod').ZodTypeAny | Record<string, import('zod').ZodTypeAny>} [outputSchema]
 * @property {Record<string, unknown>[]} [securitySchemes]
 * @property {Record<string, unknown>} [_meta]
 * @property {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations} annotations
 * @property {(
 *     args: any,
 * ) =>
 *     | Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>
 *     | import('@modelcontextprotocol/sdk/types.js').CallToolResult} handler
 *
 *
 * @typedef {object} RegisterCanonicalMcpToolsOptions
 * @property {import('./control-plane/auth.js').McpAuthContext} [authContext]
 */

/**
 * @returns {McpToolDefinition[]}
 */
export function getCanonicalMcpTools() {
    const tools = normalizeMcpToolDefinitions([
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
        mcpCloudflareMetricsSnapshotTool,
        mcpHostBlockDiagnosticsTool,
        ...connectionTools,
        mcpCloudflareRemoteAuditTool,
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
    bindMcpToolsStatusProvider(() => tools);
    bindMcpOAuthFrictionAuditProvider(() => tools);
    return tools;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {RegisterCanonicalMcpToolsOptions} [options]
 * @returns {McpToolDefinition[]}
 */
export function registerCanonicalMcpTools(server, options = {}) {
    const tools = getCanonicalMcpTools();
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
                ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
                ...(tool.securitySchemes !== undefined ? { securitySchemes: tool.securitySchemes } : {}),
                ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
            },
            async (args) => {
                const startedAt = Date.now();
                await appendMcpAuditEvent({
                    event: 'tool_call_started',
                    tool: tool.name,
                    readOnly: tool.annotations.readOnlyHint === true,
                });
                try {
                    const authorization = await authorizeMcpToolCall(tool, options.authContext);
                    if (!authorization.allowed) {
                        await appendMcpAuditEvent({
                            event: 'tool_call_auth_denied',
                            tool: tool.name,
                            durationMs: Date.now() - startedAt,
                            code: authorization.code,
                            requiredScopes: authorization.requiredScopes,
                        });
                        recordMcpToolMetric(tool.name, {
                            durationMs: Date.now() - startedAt,
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
                    await appendMcpAuditEvent({
                        event: 'tool_call_completed',
                        tool: tool.name,
                        durationMs: Date.now() - startedAt,
                        isError: result.isError === true,
                    });
                    recordMcpToolMetric(tool.name, {
                        durationMs: Date.now() - startedAt,
                        isError: result.isError === true,
                    });
                    return result;
                } catch (error) {
                    await appendMcpAuditEvent({
                        event: 'tool_call_failed',
                        tool: tool.name,
                        durationMs: Date.now() - startedAt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    recordMcpToolMetric(tool.name, {
                        durationMs: Date.now() - startedAt,
                        isError: true,
                    });
                    throw error;
                }
            },
        );
    }
    return tools;
}
