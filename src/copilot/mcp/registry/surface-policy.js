// @ts-check
/**
 * Configurable MCP tool-surface policy for reducing tools/list payload and connector startup latency.
 *
 * This module only changes which tools are advertised at runtime. It does not delete tool implementations.
 *
 * Environment:
 *
 * - COPILOT_MCP_TOOL_SURFACE=full|latency|minimal|cloudflare|readonly|claude|safe|research
 * - COPILOT_MCP_TOOL_SURFACE_INCLUDE=tool_a,tool_b
 * - COPILOT_MCP_TOOL_SURFACE_EXCLUDE=tool_c,tool_d
 * - COPILOT_MCP_TOOL_SURFACE_ALLOW_EMPTY=true|false
 *
 * @module copilot/mcp/registry/surface-policy
 */

/**
 * @typedef {'full' | 'latency' | 'minimal' | 'cloudflare' | 'readonly' | 'claude' | 'safe' | 'research'} McpToolSurfaceMode
 *
 *
 * @typedef {object} McpToolSurfacePolicy
 * @property {McpToolSurfaceMode} mode
 * @property {Set<string>} include
 * @property {Set<string>} exclude
 * @property {boolean} allowEmpty
 */

export const MCP_TOOL_SURFACE_MODES = Object.freeze([
    'full',
    'latency',
    'minimal',
    'cloudflare',
    'readonly',
    'claude',
    'safe',
    'research',
]);

const DEFAULT_TOOL_SURFACE = 'full';

const LATENCY_SURFACE_TOOL_NAMES = Object.freeze([
    'repo_status',
    'repo_root_tree',
    'repo_tree',
    'repo_search_text',
    'repo_read_file',
    'repo_bulk_inspect',
    'repo_read_file_chunks',
    'repo_file_outline',
    'repo_file_stats',
    'repo_symbol_search',
    'repo_find_orphan_imports',
    'search',
    'fetch',
    'terminal_exec',
    'terminal_session_control',
    'terminal_session_read',
    'repo_working_set',
    'repo_index_status',
    'repo_patch_plan',
    'repo_apply_patch',
    'repo_apply_patch_batch',
    'repo_apply_file_batch',
    'repo_write_file',
    'repo_remove_file',
    'repo_create_file',
    'repo_move_file',
    'repo_quarantine_file',
    'repo_restore_quarantined_file',
    'git_status',
    'git_branch_info',
    'git_diff',
    'git_log',
    'git_publish_changes',
    'run_copilot_validator',
    'mcp_run_safe_validation_suite',
    'mcp_validation_plan',
    'mcp_validation_dashboard',
    'mcp_last_validation_summary',
    'job_list',
    'job_get_summary',
    'job_get_output',
    'job_cancel',
    'mcp_client_latency_evidence',
    'mcp_latency_attribution',
    'mcp_latency_dashboard',
    'mcp_latency_pulse',
    'mcp_openai_endpoint_latency',
    'mcp_round_trip_analytics',
    'mcp_runtime_health',
    'mcp_tunnel_status',
    'mcp_connector_smoke_refresh',
    'mcp_post_restart_readiness',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_cloudflare_edge_audit',
    'mcp_cloudflare_edge_policy_plan',
    'mcp_cloudflare_edge_policy_diff',
    'mcp_cloudflare_edge_snapshot',
    'mcp_cloudflare_config_audit',
    'mcp_cloudflare_remote_audit',
    'mcp_cloudflare_post_change_gates',
    'mcp_cloudflare_transport_benchmark_plan',
    'mcp_cloudflare_mcp_passthrough_plan',
    'mcp_cloudflare_mcp_passthrough_diff',
    'mcp_cloudflare_plan_capabilities_audit',
    'mcp_host_block_diagnostics',
    'mcp_tools_status',
    'mcp_session_profile',
    'mcp_capabilities_summary',
    'chatgpt_connector_current_url_status',
    'chatgpt_connector_profile',
    'chatgpt_connector_url_check',
]);

const MINIMAL_SURFACE_TOOL_NAMES = Object.freeze([
    'repo_status',
    'repo_search_text',
    'repo_read_file',
    'repo_bulk_inspect',
    'repo_file_outline',
    'repo_apply_patch',
    'git_status',
    'git_diff',
    'mcp_latency_dashboard',
    'mcp_runtime_health',
    'mcp_tunnel_status',
    'mcp_connector_smoke_refresh',
    'mcp_validation_dashboard',
    'mcp_run_safe_validation_suite',
    'job_get_summary',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_cloudflare_edge_policy_diff',
]);

const CLOUDFLARE_SURFACE_TOOL_NAMES = Object.freeze([
    'mcp_latency_dashboard',
    'mcp_runtime_health',
    'mcp_tunnel_status',
    'mcp_connector_smoke_refresh',
    'mcp_post_restart_readiness',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_cloudflare_edge_audit',
    'mcp_cloudflare_edge_policy_plan',
    'mcp_cloudflare_edge_policy_diff',
    'mcp_cloudflare_edge_snapshot',
    'mcp_cloudflare_config_audit',
    'mcp_cloudflare_remote_audit',
    'mcp_cloudflare_post_change_gates',
    'mcp_cloudflare_transport_benchmark_plan',
    'mcp_cloudflare_mcp_passthrough_plan',
    'mcp_cloudflare_mcp_passthrough_diff',
    'mcp_cloudflare_plan_capabilities_audit',
    'mcp_cloudflare_skip_audit',
    'mcp_devcontainer_network_posture_audit',
    'mcp_devcontainer_network_control_plane_refresh',
    'mcp_validation_dashboard',
    'mcp_run_safe_validation_suite',
    'job_get_summary',
    'job_get_output',
    'repo_status',
    'git_status',
    'git_diff',
]);

const SAFE_RESEARCH_SURFACE_TOOL_NAMES = Object.freeze([
    'repo_status',
    'repo_tree',
    'repo_search_text',
    'repo_read_file',
    'repo_bulk_inspect',
    'repo_read_file_chunks',
    'repo_file_outline',
    'repo_file_stats',
    'repo_symbol_search',
    'repo_index_status',
    'repo_index_search',
    'repo_index_find_symbol',
    'repo_find_imports',
    'repo_find_orphan_imports',
    'search',
    'fetch',
    'git_status',
    'git_branch_info',
    'git_diff',
    'git_log',
    'mcp_latency_dashboard',
    'mcp_runtime_health',
    'mcp_session_profile',
    'mcp_tools_status',
    'mcp_capabilities_summary',
    'mcp_validation_plan',
    'mcp_validation_dashboard',
    'mcp_last_validation_summary',
    'job_list',
    'job_get_summary',
    'job_get_output',
    'mcp_auth_profile',
    'mcp_connection_readiness',
    'mcp_oauth_issuer_diagnostics',
    'mcp_oauth_friction_audit',
    'claude_connector_profile',
    'chatgpt_connector_profile',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_tunnel_status',
    'mcp_post_restart_readiness',
]);

/**
 * Build one exact immutable surface policy without consulting ambient process state.
 *
 * @param {{ mode?: unknown; include?: Iterable<string>; exclude?: Iterable<string>; allowEmpty?: boolean }} [input]
 * @returns {McpToolSurfacePolicy}
 */
export function createMcpToolSurfacePolicy(input = {}) {
    return {
        mode: normalizeMode(input.mode),
        include: new Set(Array.from(input.include ?? [], normalizeToolName).filter(Boolean)),
        exclude: new Set(Array.from(input.exclude ?? [], normalizeToolName).filter(Boolean)),
        allowEmpty: input.allowEmpty === true,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpToolSurfacePolicy}
 */
export function readMcpToolSurfacePolicy(env = process.env) {
    return createMcpToolSurfacePolicy({
        mode: env['COPILOT_MCP_TOOL_SURFACE'],
        include: readCsv(env['COPILOT_MCP_TOOL_SURFACE_INCLUDE']),
        exclude: readCsv(env['COPILOT_MCP_TOOL_SURFACE_EXCLUDE']),
        allowEmpty: readBoolean(env['COPILOT_MCP_TOOL_SURFACE_ALLOW_EMPTY'], false),
    });
}

/**
 * @param {McpToolSurfacePolicy} policy
 * @returns {string}
 */
export function toolSurfaceCacheKey(policy) {
    return JSON.stringify({
        mode: policy.mode,
        include: Array.from(policy.include).sort(),
        exclude: Array.from(policy.exclude).sort(),
        allowEmpty: policy.allowEmpty,
    });
}

/**
 * @template {{ name: string; annotations?: { readOnlyHint?: boolean | undefined } }} T
 * @param {T[]} tools
 * @param {McpToolSurfacePolicy} [policy]
 * @returns {T[]}
 */
export function applyMcpToolSurfacePolicy(tools, policy = readMcpToolSurfacePolicy()) {
    if (policy.mode === 'full' && policy.include.size === 0 && policy.exclude.size === 0) return tools;
    const selected = tools.filter((tool) => {
        const includedByMode = matchesToolSurfaceMode(tool, policy.mode);
        const explicitlyIncluded = policy.include.has(tool.name);
        const explicitlyExcluded = policy.exclude.has(tool.name);
        return (includedByMode || explicitlyIncluded) && !explicitlyExcluded;
    });
    if (selected.length === 0 && !policy.allowEmpty) return tools;
    return selected;
}

/**
 * @template {{ name: string }} T
 * @param {T[]} selectedTools
 * @param {T[]} allTools
 * @param {McpToolSurfacePolicy} policy
 * @returns {Record<string, unknown>}
 */
export function describeMcpToolSurfacePolicy(selectedTools, allTools, policy) {
    const allNames = new Set(allTools.map((tool) => tool.name));
    return {
        mode: policy.mode,
        selectedTools: selectedTools.length,
        totalTools: allTools.length,
        reduced: selectedTools.length < allTools.length,
        selectedPercent: allTools.length > 0 ? Math.round((selectedTools.length / allTools.length) * 100) : 0,
        include: Array.from(policy.include).sort(),
        exclude: Array.from(policy.exclude).sort(),
        unknownInclude: Array.from(policy.include)
            .filter((name) => !allNames.has(name))
            .sort(),
        unknownExclude: Array.from(policy.exclude)
            .filter((name) => !allNames.has(name))
            .sort(),
        allowEmpty: policy.allowEmpty,
    };
}

/**
 * @param {{ name: string; annotations?: { readOnlyHint?: boolean | undefined } }} tool
 * @param {McpToolSurfaceMode} mode
 * @returns {boolean}
 */
function matchesToolSurfaceMode(tool, mode) {
    if (mode === 'full') return true;
    if (mode === 'latency') return LATENCY_SURFACE_TOOL_NAMES.includes(tool.name);
    if (mode === 'minimal') return MINIMAL_SURFACE_TOOL_NAMES.includes(tool.name);
    if (mode === 'cloudflare') return CLOUDFLARE_SURFACE_TOOL_NAMES.includes(tool.name);
    if (mode === 'claude' || mode === 'safe' || mode === 'research')
        return SAFE_RESEARCH_SURFACE_TOOL_NAMES.includes(tool.name);
    if (mode === 'readonly') return tool.annotations?.readOnlyHint === true;
    return true;
}

/** @param {unknown} value @returns {McpToolSurfaceMode} */
function normalizeMode(value) {
    const raw = String(value ?? DEFAULT_TOOL_SURFACE)
        .trim()
        .toLowerCase();
    if (MCP_TOOL_SURFACE_MODES.includes(/** @type {McpToolSurfaceMode} */ (raw))) {
        return /** @type {McpToolSurfaceMode} */ (raw);
    }
    throw new TypeError(
        `Unsupported MCP tool surface ${JSON.stringify(raw)}; expected one of ${MCP_TOOL_SURFACE_MODES.join(', ')}.`,
    );
}

/** @param {unknown} value @returns {string[]} */
function readCsv(value) {
    return String(value ?? '')
        .split(',')
        .map(normalizeToolName)
        .filter(Boolean);
}

/** @param {unknown} value @returns {string} */
function normalizeToolName(value) {
    return String(value ?? '').trim();
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
