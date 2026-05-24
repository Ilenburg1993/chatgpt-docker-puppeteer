// @ts-check
/**
 * MCP session profile for low-friction ChatGPT connector usage.
 *
 * @module copilot/mcp/tools/session-profile
 */

import { buildChatGptConnectorProfile } from '../connection/profile.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';
import { buildMcpCapabilitiesSummary } from './meta.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpSessionProfileTool = {
    name: 'mcp_session_profile',
    title: 'MCP session profile',
    description:
        'Return the recommended ChatGPT operating profile for this repo MCP session, including approval-minimizing workflows.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const connector = buildChatGptConnectorProfile();
        const capabilities = buildMcpCapabilitiesSummary();
        return okResult({
            success: true,
            profile: 'chatgpt-max-autonomy-permanent-cloudflare-oauth',
            connector: {
                name: connector.name,
                description: connector.description,
                mcpServerUrl: connector.chatgptFormFields.mcpServerUrl,
                authentication: connector.chatgptFormFields.authentication,
                authMode: connector.authMode,
                localMcpUrl: connector.localMcpUrl,
            },
            recommendedFirstCalls: [
                'repo_status',
                'mcp_tools_status',
                'mcp_capabilities_summary',
                'mcp_golden_prompts',
                'mcp_host_block_diagnostics',
                'mcp_maintenance_plan',
                'delegate_to_repo_autonomy_runner',
                'mcp_tunnel_status',
                'mcp_last_validation_summary',
                'mcp_auth_profile',
                'mcp_autonomy_power_score',
                'mcp_oauth_issuer_diagnostics',
                'project_doctor',
            ],
            lowFrictionReadCalls: [
                'repo_tree',
                'repo_root_tree',
                'repo_root_redaction_status',
                'repo_search_text',
                'repo_read_file',
                'repo_read_file_chunks',
                'repo_file_outline',
                'repo_symbol_search',
                'repo_index_search',
                'repo_list_quarantine',
                'repo_inspect_quarantined_file',
                'repo_patch_plan',
                'repo_create_file_plan',
                'repo_quarantine_file_plan',
                'repo_move_file_plan',
                'repo_index_refresh_plan',
                'mcp_validation_plan',
                'mcp_last_validation_summary',
                'mcp_host_block_diagnostics',
                'chatgpt_connector_current_url_status',
                'mcp_auth_profile',
                'mcp_autonomy_power_score',
                'mcp_oauth_issuer_diagnostics',
                'git_status',
                'git_diff',
            ],
            preferredWriteWorkflows: [
                {
                    task: 'patch-existing-file',
                    flow: ['repo_patch_plan includeDiffPreview=false', 'repo_apply_patch expectedHash=<sha256 from plan> includeDiffPreview=false'],
                    reason: 'Plan-only read is lower friction than dryRun inside the write tool; textual diffs are suppressed by default to avoid ChatGPT web stream interruptions.',
                },
                {
                    task: 'apply-multiple-file-ops',
                    flow: ['repo_apply_file_batch_plan', 'repo_apply_file_batch dryRun=false confirmBatch=true'],
                    reason:
                        'Plan the batch with a read-only tool first, then apply all trusted create/move/quarantine operations in one ChatGPT write confirmation.',
                },
                {
                    task: 'remove-file-safely',
                    flow: [
                        'repo_quarantine_file_plan',
                        'repo_quarantine_file',
                        'repo_restore_quarantined_file if rollback is needed',
                    ],
                    reason: 'Quarantine is reversible and should be preferred over repo_remove_file.',
                },
                {
                    task: 'validate-work',
                    flow: [
                        'mcp_validation_plan suite=mcp-full',
                        'mcp_run_safe_validation_suite suite=mcp-full',
                        'mcp_validation_dashboard',
                        'mcp_last_validation_summary includeOutputTail=false',
                        'job_get_summary <jobId> when inspecting one job',
                        'job_get_output tailBytes<=8000 only if the summary reports failure',
                    ],
                    reason: 'One allowlisted job reduces repeated validator calls; summary-first avoids ChatGPT web stream interruptions from long logs.',
                },
                {
                    task: 'routine-maintenance',
                    flow: ['mcp_maintenance_plan', 'mcp_maintenance_apply_safe_fixes dryRun=true'],
                    reason: 'Batched maintenance reduces separate planning/status/smoke calls.',
                },
                {
                    task: 'delegated-longer-work',
                    flow: [
                        'delegate_to_repo_autonomy_runner dryRun=true',
                        'delegate_to_repo_autonomy_runner dryRun=false',
                    ],
                    reason: 'The local runner executes only fixed missions and avoids arbitrary shell or destructive actions.',
                },
            ],
            approvalGuidance: {
                askUserToRememberWhenAvailable: [
                    'repo_apply_patch',
                    'repo_write_file',
                    'repo_create_file',
                    'repo_move_file',
                    'repo_quarantine_file',
                    'repo_restore_quarantined_file',
                    'mcp_run_safe_validation_suite',
                    'mcp_maintenance_apply_safe_fixes',
                    'delegate_to_repo_autonomy_runner',
                ],
                avoidUnlessExplicitlyNeeded: ['repo_remove_file', 'job_cancel'],
                cannotDisableHostPrompts:
                    'ChatGPT controls connector confirmation UI. This MCP reduces friction with precise annotations, narrow tools and reversible workflows; it cannot bypass host safety prompts.',
            },
            tunnelGuidance: {
                mode: 'Cloudflare named permanent tunnel',
                expectedUrlShape: 'https://mcp.aurelin.org/mcp',
                reconnectRule:
                    'Keep npm run copilot:mcp:cloudflare:up healthy; use COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick only as fallback.',
            },
            smokePrompts: connector.smokePrompts,
            capabilities,
        });
    },
};
