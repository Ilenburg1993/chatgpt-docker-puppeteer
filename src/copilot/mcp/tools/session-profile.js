// @ts-check
/**
 * MCP session profile for low-friction ChatGPT connector usage.
 *
 * The profile is intentionally compact: it should route the caller toward task-specific tools, not front-load a full
 * capability registry or a deep infrastructure audit on every conversation.
 *
 * @module copilot/mcp/tools/session-profile
 */

import { buildChatGptConnectorProfile } from '#copilot/mcp/public/connection';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult } from '#copilot/mcp/public/protocol/tools';
import { buildMcpSessionWorkflowProjection } from '#copilot/mcp/public/workflow-policy';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpSessionProfileTool = defineMcpRawTool({
    name: 'mcp_session_profile',
    title: 'MCP session profile',
    description: 'Return a compact task-first ChatGPT operating profile for this repo MCP session.',
    inputSchema: {},

    handler: async () => {
        const connector = buildChatGptConnectorProfile();
        const workflows = buildMcpSessionWorkflowProjection();
        return okResult({
            success: true,
            profile: 'chatgpt-max-autonomy-permanent-cloudflare-oauth',
            connector: {
                name: connector.name,
                mcpServerUrl: connector.chatgptFormFields.mcpServerUrl,
                authentication: connector.chatgptFormFields.authentication,
                authMode: connector.authMode,
                localMcpUrl: connector.localMcpUrl,
            },
            recommendedFirstCalls: ['repo_status'],
            operatingRule:
                'After repo_status, call the task-specific repo/git tool directly. Run infrastructure diagnostics only when a restart, connector/network change, error, or explicit investigation makes them relevant.',
            workflowPolicyVersion: workflows.workflowPolicyVersion,
            taskRouting: {
                navigate: ['repo_search_text', 'repo_read_file', 'repo_file_outline', 'repo_symbol_search'],
                inspectState: ['repo_status', 'git_diff'],
                ...workflows.taskRouting,
            },
            preferredWriteWorkflows: workflows.preferredWriteWorkflows,
            diagnosticsOnDemand: {
                runtime: ['mcp_runtime_health', 'mcp_latency_dashboard'],
                afterRestart: ['mcp_post_restart_readiness'],
                connector: ['mcp_connector_smoke_refresh'],
                cloudflare: [
                    'mcp_tunnel_status',
                    'mcp_cloudflare_metrics_snapshot',
                    'mcp_cloudflare_remote_audit',
                    'mcp_cloudflare_edge_audit',
                ],
                auth: ['mcp_auth_profile', 'mcp_oauth_friction_audit', 'mcp_oauth_issuer_diagnostics'],
                capabilities: ['mcp_capabilities_summary', 'mcp_tools_status'],
            },
            approvalGuidance: {
                rememberTrustedBoundedWritesWhenOffered: true,
                avoidUnlessExplicitlyNeeded: ['repo_remove_file', 'job_cancel'],
                strategy:
                    'apply bounded batches directly when intent is clear; plan only when preview adds value; prefer reversible operations',
            },
            performancePolicy: {
                deepDiagnosticsDefault: false,
                broadValidationDefault: false,
                preferBatching: true,
                preferCompactResults: true,
            },
            tunnelGuidance: {
                mode: 'Cloudflare named permanent tunnel',
                expectedUrlShape: 'https://mcp.aurelin.org/mcp',
                deepAuditTrigger: 'restart, network/edge change, connector failure, or explicit investigation',
            },
        });
    },
});
