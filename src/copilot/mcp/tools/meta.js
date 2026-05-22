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
                read: [
                    'repo_status',
                    'repo_tree',
                    'repo_root_tree',
                    'repo_read_file',
                    'repo_read_file_chunks',
                    'repo_file_stats',
                    'repo_diff_files',
                    'repo_search_text',
                    'repo_find_symbol_usages',
                    'repo_symbol_search',
                    'repo_file_outline',
                ],
                index: [
                    'repo_index_status',
                    'repo_index_build',
                    'repo_index_search',
                    'repo_index_find_symbol',
                    'repo_find_imports',
                    'repo_index_invalidate',
                ],
                write: [
                    'repo_write_file',
                    'repo_create_file',
                    'repo_apply_patch',
                    'repo_move_file',
                    'repo_remove_file',
                ],
                git: ['git_status', 'git_diff', 'git_log', 'git_branch_info'],
                validation: [
                    'run_copilot_validator',
                    'run_typecheck_copilot',
                    'run_lint_copilot',
                    'run_unit_copilot',
                    'run_project_doctor',
                    'job_list',
                    'job_get_output',
                    'job_cancel',
                ],
                runtime: [
                    'project_doctor',
                    'mcp_runtime_health',
                    'mcp_smoke_workspace',
                    'mcp_tunnel_status',
                    'mcp_capabilities_summary',
                ],
                protocolVersion: 'workspace-mcp/0.3.0',
                capabilitiesVersion: 5,
                deprecated: [],
                experimental: [
                    'repo_symbol_search',
                    'repo_file_outline',
                    'repo_index_search',
                    'repo_index_find_symbol',
                ],
                securityPolicy: {
                    readProtectedPaths: 'blocked',
                    listProtectedPaths: 'redacted',
                    writeProtectedPaths: 'blocked',
                },
                connection: ['chatgpt_connector_profile', 'chatgpt_connector_url_check'],
                copilotSdk: ['copilot_sessions_list', 'copilot_session_get'],
                ioGuidance: [
                    'Use repo_read_file.sha256 as expectedHash for safe write/patch calls.',
                    'Use repo_read_file_chunks for large files instead of requesting entire content.',
                    'Use repo_search_text.contextLines for investigation and cursor/nextCursor for pagination.',
                    'Use repo_find_symbol_usages for impact analysis before refactors.',
                    'Use repo_index_build then repo_index_search/repo_index_find_symbol/repo_find_imports for indexed navigation.',
                    'Use repo_symbol_search and repo_file_outline before edits that need code navigation.',
                    'Use repo_root_tree or repo_tree path="." for the real workspace root.',
                    'LLM-B can consume MCP optionally, but does not depend on this MCP server.',
                ],
            }),
    },
];
