// @ts-check
/**
 * MCP meta/capability tools.
 *
 * @module copilot/mcp/tools/meta
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const metaTools = [
    {
        name: 'mcp_capabilities_summary',
        title: 'MCP capabilities summary',
        description: 'Return a concise categorized summary of the MCP tools exposed for this repo.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () =>
            okResult({
                success: true,
                read: ['repo_status', 'repo_tree', 'repo_root_tree', 'repo_read_file', 'repo_search_text'],
                write: ['repo_write_file', 'repo_create_file', 'repo_apply_patch', 'repo_move_file', 'repo_remove_file'],
                git: ['git_status', 'git_diff', 'git_log', 'git_branch_info'],
                validation: [
                    'run_copilot_validator',
                    'run_typecheck_copilot',
                    'run_lint_copilot',
                    'run_unit_copilot',
                    'run_project_doctor',
                    'job_get_output',
                    'job_cancel',
                ],
                runtime: [
                    'project_doctor',
                    'mcp_runtime_health',
                    'mcp_tunnel_status',
                    'mcp_capabilities_summary',
                ],
                connection: ['chatgpt_connector_profile', 'chatgpt_connector_url_check'],
                copilotSdk: ['copilot_sessions_list', 'copilot_session_get'],
                ioGuidance: [
                    'Use repo_read_file.sha256 as expectedHash for safe write/patch calls.',
                    'Use repo_search_text.contextLines for investigation and cursor/nextCursor for pagination.',
                    'Use repo_root_tree or repo_tree path="." for the real workspace root.',
                    'LLM-B can consume MCP optionally, but does not depend on this MCP server.',
                ],
            }),
    },
];
