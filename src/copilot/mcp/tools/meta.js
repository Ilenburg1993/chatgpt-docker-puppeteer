// @ts-check
/**
 * MCP meta/capability tools.
 *
 * @module copilot/mcp/tools/meta
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

const PROTOCOL_VERSION = 'workspace-mcp/0.3.0';
const CAPABILITIES_VERSION = 6;

const READ_TOOLS = [
    'repo_status',
    'repo_tree',
    'repo_root_tree',
    'repo_read_file',
    'repo_read_file_chunks',
    'repo_file_stats',
    'repo_diff_files',
    'repo_list_quarantine',
    'repo_inspect_quarantined_file',
    'repo_search_text',
    'repo_find_symbol_usages',
    'repo_symbol_search',
    'repo_file_outline',
];

const INDEX_TOOLS = [
    'repo_index_status',
    'repo_index_build',
    'repo_index_search',
    'repo_index_find_symbol',
    'repo_find_imports',
    'repo_index_invalidate',
];

const WRITE_TOOLS = [
    'repo_write_file',
    'repo_create_file',
    'repo_apply_patch',
    'repo_move_file',
    'repo_quarantine_file',
    'repo_restore_quarantined_file',
    'repo_remove_file',
];

const GIT_TOOLS = ['git_status', 'git_diff', 'git_log', 'git_branch_info'];

const VALIDATION_TOOLS = [
    'mcp_run_safe_validation_suite',
    'run_copilot_validator',
    'run_typecheck_copilot',
    'run_lint_copilot',
    'run_unit_copilot',
    'run_project_doctor',
    'job_list',
    'job_get_output',
    'job_cancel',
];

const RUNTIME_TOOLS = [
    'mcp_maintenance_plan',
    'mcp_maintenance_apply_safe_fixes',
    'project_doctor',
    'mcp_runtime_health',
    'mcp_session_profile',
    'mcp_smoke_workspace',
    'mcp_tools_status',
    'mcp_tunnel_status',
    'mcp_capabilities_summary',
];

const CONNECTION_TOOLS = ['chatgpt_connector_profile', 'chatgpt_connector_url_check'];
const COPILOT_SDK_TOOLS = ['copilot_sessions_list', 'copilot_session_get'];
/** @type {string[]} */
const DEPRECATED_TOOLS = [];
const EXPERIMENTAL_TOOLS = ['repo_symbol_search', 'repo_file_outline', 'repo_index_search', 'repo_index_find_symbol'];

const SECURITY_POLICY = {
    readProtectedPaths: 'blocked',
    listProtectedPaths: 'redacted',
    writeProtectedPaths: 'blocked',
};

const ANNOTATION_PROFILE = {
    readOnlyTools: 'readOnlyHint=true, idempotentHint=true, destructiveHint=false, openWorldHint=false',
    boundedWriteTools: 'readOnlyHint=false, idempotentHint=false, destructiveHint=false, openWorldHint=false',
    destructiveTools: 'readOnlyHint=false, idempotentHint=false, destructiveHint=true, openWorldHint=false',
    hostControl:
        'ChatGPT host authorization prompts are controlled by chatgpt.com; this MCP can reduce friction with precise annotations and narrow tools, but cannot disable host safety UI.',
};

const IO_GUIDANCE = [
    'Use mcp_tools_status before planning broad work to inspect read-only, bounded-write, destructive and approval-friendly tools.',
    'Use mcp_session_profile at the start of a new ChatGPT conversation to load the recommended autonomy profile.',
    'Use mcp_maintenance_plan then mcp_maintenance_apply_safe_fixes dryRun=true for batched low-risk maintenance.',
    'Use repo_read_file.sha256 as expectedHash for safe write/patch calls.',
    'Use repo_quarantine_file before repo_remove_file when reversible cleanup is acceptable.',
    'Use repo_read_file_chunks for large files instead of requesting entire content.',
    'Use repo_search_text.contextLines for investigation and cursor/nextCursor for pagination.',
    'Use repo_find_symbol_usages for impact analysis before refactors.',
    'Use repo_index_build then repo_index_search/repo_index_find_symbol/repo_find_imports for indexed navigation.',
    'Use repo_symbol_search and repo_file_outline before edits that need code navigation.',
    'Use mcp_run_safe_validation_suite suite="mcp-full" before separate validator calls when ChatGPT needs one canonical verification step.',
    'Use repo_root_tree or repo_tree path="." for the real workspace root.',
    'LLM-B can consume MCP optionally, but does not depend on this MCP server.',
];

/**
 * @returns {{
 *     read: string[];
 *     index: string[];
 *     write: string[];
 *     git: string[];
 *     validation: string[];
 *     runtime: string[];
 *     connection: string[];
 *     copilotSdk: string[];
 * }}
 */
export function getMcpCapabilityGroups() {
    return {
        read: [...READ_TOOLS],
        index: [...INDEX_TOOLS],
        write: [...WRITE_TOOLS],
        git: [...GIT_TOOLS],
        validation: [...VALIDATION_TOOLS],
        runtime: [...RUNTIME_TOOLS],
        connection: [...CONNECTION_TOOLS],
        copilotSdk: [...COPILOT_SDK_TOOLS],
    };
}

/**
 * @returns {string[]}
 */
export function getAdvertisedMcpToolNames() {
    const groups = getMcpCapabilityGroups();
    return [...new Set(Object.values(groups).flat())].sort();
}

/**
 * @returns {Record<string, unknown>}
 */
export function buildMcpCapabilitiesSummary() {
    const groups = getMcpCapabilityGroups();
    return {
        success: true,
        ...groups,
        protocolVersion: PROTOCOL_VERSION,
        capabilitiesVersion: CAPABILITIES_VERSION,
        advertisedToolCount: getAdvertisedMcpToolNames().length,
        advertisedTools: getAdvertisedMcpToolNames(),
        deprecated: [...DEPRECATED_TOOLS],
        experimental: [...EXPERIMENTAL_TOOLS],
        securityPolicy: { ...SECURITY_POLICY },
        annotationProfile: { ...ANNOTATION_PROFILE },
        ioGuidance: [...IO_GUIDANCE],
    };
}

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
        handler: async () => okResult(buildMcpCapabilitiesSummary()),
    },
];
