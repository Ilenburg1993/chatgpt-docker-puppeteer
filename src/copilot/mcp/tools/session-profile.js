// @ts-check
/**
 * MCP session profile for low-friction ChatGPT connector usage.
 *
 * The profile is intentionally compact: it should route the caller toward task-specific tools, not front-load a full
 * capability registry or a deep infrastructure audit on every conversation.
 *
 * @module copilot/mcp/tools/session-profile
 */

import { buildChatGptConnectorProfile } from '#copilot/mcp/connection';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpSessionProfileTool = {
    name: 'mcp_session_profile',
    title: 'MCP session profile',
    description: 'Return a compact task-first ChatGPT operating profile for this repo MCP session.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const connector = buildChatGptConnectorProfile();
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
            taskRouting: {
                navigate: ['repo_search_text', 'repo_read_file', 'repo_file_outline', 'repo_symbol_search'],
                inspectState: ['repo_status', 'git_diff'],
                patch: ['repo_apply_patch_batch', 'repo_patch_batch_plan'],
                fileBatch: ['repo_apply_file_batch_plan', 'repo_apply_file_batch'],
                validate: ['mcp_validation_plan', 'run_copilot_validator', 'job_get_summary'],
            },
            preferredWriteWorkflows: [
                {
                    task: 'patch',
                    flow: [
                        'repo_apply_patch_batch dryRun=false confirmBatch=true when anchors/intent are already known; default per-target-fast+best-effort preserves atomicity per target and independent progress',
                        'use applyMode=global-preflight only when all-target preview gating is deliberately desired; repo_patch_batch_plan only when a separate preview adds information',
                    ],
                },
                {
                    task: 'file-batch',
                    flow: [
                        'repo_apply_file_batch dryRun=false confirmBatch=true (adaptive: safe sequences sequential-fast; delete/overwrite global-preflight)',
                        'repo_apply_file_batch_plan only when an explicit preview adds information',
                    ],
                },
                {
                    task: 'validate',
                    flow: ['mcp_validation_plan', 'run_copilot_validator unit-focused when causal', 'job_get_summary'],
                },
            ],
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
};
