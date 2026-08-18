// @ts-check
/**
 * MCP meta/capability tools.
 *
 * @module copilot/mcp/tools/meta
 */

import { MCP_AUTH_SCOPES, okResult, readMcpAuthConfig, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import { z } from 'zod';

const PROTOCOL_VERSION = 'workspace-mcp/0.3.0';
const CAPABILITIES_VERSION = 51;
const MAX_POWER_REPO_SCOPES = [
    MCP_AUTH_SCOPES.read,
    MCP_AUTH_SCOPES.write,
    MCP_AUTH_SCOPES.validate,
    MCP_AUTH_SCOPES.admin,
];

const READ_TOOLS = [
    'repo_status',
    'repo_tree',
    'repo_root_tree',
    'repo_root_redaction_status',
    'repo_read_file',
    'repo_bulk_inspect',
    'repo_read_file_chunks',
    'repo_file_stats',
    'repo_diff_files',
    'repo_list_quarantine',
    'repo_inspect_quarantined_file',
    'repo_patch_batch_plan',
    'repo_patch_plan',
    'repo_create_file_plan',
    'repo_quarantine_file_plan',
    'repo_move_file_plan',
    'repo_apply_file_batch_plan',
    'repo_index_refresh_plan',
    'mcp_validation_plan',
    'repo_search_text',
    'repo_find_symbol_usages',
    'repo_symbol_search',
    'repo_file_outline',
    'search',
    'fetch',
];

const INDEX_TOOLS = [
    'repo_index_status',
    'repo_index_build',
    'repo_index_search',
    'repo_index_find_symbol',
    'repo_find_imports',
    'repo_find_orphan_imports',
    'repo_index_invalidate',
];

const WRITE_TOOLS = [
    'repo_apply_file_batch',
    'repo_apply_patch_batch',
    'repo_write_file',
    'repo_create_file',
    'repo_apply_patch',
    'repo_move_file',
    'repo_quarantine_file',
    'repo_restore_quarantined_file',
    'repo_remove_file',
];

const GIT_TOOLS = [
    'git_status',
    'git_diff',
    'git_log',
    'git_branch_info',
    'git_publish_changes',
    'git_stage_plan',
    'git_stage',
    'git_commit_plan',
    'git_commit',
    'git_push_plan',
    'git_push',
];

const DEV_TOOLS = ['mcp_' + 'dev' + 'container_' + 'network_' + 'posture_' + 'audit'];

const VALIDATION_TOOLS = [
    'mcp_run_safe_validation_suite',
    'run_copilot_validator',
    'run_typecheck_copilot',
    'run_lint_copilot',
    'run_unit_copilot',
    'run_project_doctor',
    'mcp_validation_dashboard',
    'mcp_last_validation_summary',
    'job_list',
    'job_get_summary',
    'job_get_output',
    'job_cancel',
];

const RUNTIME_TOOLS = [
    'delegate_to_repo_autonomy_runner',
    ...DEV_TOOLS,
    'mcp_golden_prompts',
    'mcp_apps_sdk_readiness',
    'mcp_cloudflare_config_audit',
    'mcp_cloudflare_' + 'plan_capabilities_audit',
    'mcp_cloudflare_edge_backup_create',
    'mcp_cloudflare_edge_backups_list',
    'mcp_cloudflare_edge_audit',
    'mcp_cloudflare_edge_policy_apply',
    'mcp_cloudflare_edge_policy_diff',
    'mcp_cloudflare_edge_policy_plan',
    'mcp_cloudflare_edge_snapshot',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_cloudflare_post_change_gates',
    'mcp_cloudflare_transport_benchmark_plan',
    'mcp_host_block_diagnostics',
    'mcp_cleanup_ai_artifacts',
    'mcp_maintenance_plan',
    'mcp_maintenance_apply_safe_fixes',
    'project_doctor',
    'mcp_latency_dashboard',
    'mcp_runtime_health',
    'mcp_session_profile',
    'mcp_smoke_workspace',
    'mcp_tool_payload_audit',
    'mcp_autonomy_power_score',
    'mcp_tools_status',
    'mcp_tunnel_status',
    'mcp_cloudflare_remote_audit',
    'mcp_cloudflare_skip_audit',
    'mcp_cloudflare_mcp_passthrough_plan',
    'mcp_cloudflare_mcp_passthrough_diff',
    'mcp_cloudflare_mcp_passthrough_apply',
    'mcp_connector_smoke_refresh',
    'mcp_post_restart_readiness',
    'mcp_reload_plan',
    'mcp_reload_status',
    'mcp_reload_schedule',
    'llmb_live_readiness',
    'llmb_live_runs',
    'llmb_live_test_cancel',
    'llmb_live_test_plan',
    'llmb_live_test_run',
    'mcp_capabilities_summary',
];

const CONNECTION_TOOLS = [
    'chatgpt_connector_profile',
    'chatgpt_connector_url_check',
    'chatgpt_connector_current_url_status',
    'mcp_auth_profile',
    'mcp_connection_readiness',
    'mcp_oauth_issuer_diagnostics',
    'mcp_oauth_friction_audit',
    'claude_connector_profile',
];
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
    readOnlyTools: 'readOnlyHint=true, idempotentHint=true, destructiveHint=false, openWorldHint=false by default',
    boundedWriteTools: 'readOnlyHint=false, idempotentHint=false, destructiveHint=false, openWorldHint=false by default',
    destructiveTools: 'readOnlyHint=false, idempotentHint=false, destructiveHint=true, openWorldHint=false by default',
    openWorldExceptions:
        'git_push_plan/git_push/git_publish_changes and llmb_live_test_run are explicitly open-world because they can contact configured upstream/provider services; their inputs remain closed/allowlisted.',
    hostControl:
        'ChatGPT host authorization prompts are controlled by chatgpt.com; this MCP can reduce friction with precise annotations and narrow tools, but cannot disable host safety UI.',
};

const METADATA_PROFILE = {
    outputSchema:
        'tool-specific only; generic passthrough output schemas are intentionally omitted because they add wire bytes without meaningful validation',
    securitySchemes: 'registry-wide OAuth securitySchemes with repo max-power scopes advertised by default for ChatGPT',
};

const IO_GUIDANCE = [
    'Use mcp_tools_status before planning broad work to inspect read-only, bounded-write, destructive and approval-friendly tools.',
    'Use mcp_autonomy_power_score after broad changes to measure connector autonomy posture.',
    'Use mcp_session_profile at the start of a new ChatGPT conversation to load the recommended autonomy profile.',
    'Use mcp_maintenance_plan then mcp_maintenance_apply_safe_fixes dryRun=true for batched low-risk maintenance.',
    'Use delegate_to_repo_autonomy_runner dryRun=true for fixed longer workflows before requesting real execution.',
    'Use mcp_golden_prompts when measuring real ChatGPT approval prompts and host blocks.',
    'Use mcp_host_block_diagnostics after any ChatGPT host-side block to classify it and select a lower-friction replacement.',
    'Use plan-only tools only when an explicit preview, human inspection or separate approval boundary is useful; governed apply tools revalidate their own preconditions and should not pay an automatic plan round-trip.',
    'Keep includeDiffPreview=false by default for repo_patch_plan, repo_create_file_plan, repo_apply_patch, repo_write_file, repo_create_file and repo_diff_files; request textual diffs only when explicitly needed.',
    'Prefer repo_read_file.batch for 2-32 independent small/medium reads and repo_search_text.batch for 2-32 independent searches. Use repo_bulk_inspect when read/search/stat work can be mixed in one call; all three preserve per-item failures and bounded output payloads.',
    'Use repo_patch_batch_plan before several exact-string repo_apply_patch calls to validate all patch preconditions in one read-only planning step.',
    'Use repo_apply_patch_batch for up to 64 exact-string patches across up to 32 targets. Keep global-preflight for conservative all-target validation, or use per-target-fast when independent targets may apply/fail separately; repeated paths stay sequential and atomic per file.',
    'When several exact-string edits target one file, keep them in one repo_apply_patch_batch so the server performs one lock/read/write/cache-invalidation cycle instead of one cycle per edit.',
    'Use repo_apply_file_batch directly for trusted multi-file operations: global-preflight is conservative default, while sequential-fast skips the duplicate global preview and reports partial prefix state. Use repo_apply_file_batch_plan only when a separate read-only preview is actually needed.',
    'Use repo_read_file.sha256 as expectedHash for safe write/patch calls.',
    'Write/create/patch tools accept durability=file-and-directory|file|none. Keep file-and-directory as the default for strongest crash durability; file skips parent-directory fsync; none also skips file flush but still preserves path policy, locks, atomic publish and hash preconditions.',
    'Use repo_quarantine_file before repo_remove_file when reversible cleanup is acceptable.',
    'Use repo_read_file_chunks for large files instead of requesting entire content.',
    'Use repo_search_text as the completeness-oriented filesystem search; it prefers rg when available and avoids treating temporarily partial derived-index hits as complete. Use repo_index_search explicitly for FTS/discovery over the convergent SQLite index.',
    'Use repo_search_text.contextLines for investigation and cursor/nextCursor for pagination.',
    'Use repo_find_symbol_usages for impact analysis before refactors.',
    'Use repo_index_build then repo_index_search/repo_index_find_symbol/repo_find_imports for indexed navigation.',
    'Use repo_find_orphan_imports before or after file moves to detect broken local imports.',
    'COPILOT_MCP_INDEX_AUTO_BUILD defaults to true so indexed navigation is warmed outside ChatGPT host calls.',
    'Use repo_symbol_search and repo_file_outline before edits that need code navigation.',
    'Use mcp_validation_plan with no suite by default. For one gate, use run_copilot_validator validator="unit-focused"; for several causal gates, use run_copilot_validator.batch so focused test(s), typecheck and lint share one MCP round-trip. Batch defaults concurrency=1 to avoid CPU thrashing; use 2 only for genuinely independent focused tests. Inline completion means no polling unless a returned wait expires; escalate to mcp_run_safe_validation_suite only for cross-cutting risk or a deliberate release gate.',
    'Use mcp_validation_dashboard, mcp_last_validation_summary and job_get_summary before job_get_output; read job logs only with small tailBytes and only when needed.',
    'Use repo_root_tree or repo_tree path="." for the real workspace root.',
    'Use repo_root_redaction_status to audit hidden/protected root redaction without returning hidden names.',
    'Use chatgpt_connector_current_url_status to recover the saved temporary tunnel URL without passing it as input.',
    'Use mcp_auth_profile to confirm OAuth max-power scopes and WWW-Authenticate challenge metadata.',
    'Use mcp_oauth_issuer_diagnostics before changing issuer, CIMD, OIDC or Cloudflare OAuth settings.',
    'Use mcp_oauth_friction_audit after OAuth or connector changes to detect reauth risk and metadata drift.',
    'After an MCP/Cloudflare reload, use mcp_connector_smoke_refresh as the single normal post-restart gate: it refreshes OAuth/tools/SSE smoke and returns reconciled post-restart readiness in the same response. Keep includeDetails=false unless deep smoke diagnostics are needed.',
    'Use mcp_cloudflare_remote_audit to compare the Cloudflare-hosted tunnel config, DNS CNAME and expected local origin without exposing API tokens.',
    'Use mcp_cloudflare_edge_audit to inspect Cloudflare zone rulesets for cache, WAF, rate-limit and transform interference with MCP/OAuth.',
    'Use mcp_cloudflare_edge_policy_plan before proposing Cloudflare edge changes; it is plan-only and does not mutate rulesets.',
    'Use mcp_cloudflare_edge_policy_diff to compare actual Cloudflare rulesets with the desired MCP edge policy before any dashboard/API change.',
    'Use mcp_cloudflare_edge_snapshot to capture tunnel, DNS, edge rulesets and desired-policy diff before any Cloudflare mutation.',
    'Use mcp_cloudflare_edge_backup_create to persist that snapshot locally before changing Cloudflare cache, WAF or rate-limit policy.',
    'Use mcp_cloudflare_edge_backups_list to find the latest rollback reference before and after Cloudflare policy changes.',
    'Use mcp_cloudflare_edge_policy_apply dryRun=true first; real Cloudflare mutation requires dryRun=false and confirmApply=true.',
    'Use mcp_cloudflare_metrics_snapshot to inspect local cloudflared version, orchestration config version and registration counters.',
    'Use mcp_post_restart_readiness as a read-only diagnostic fallback when you do not want to refresh connector smoke; it is no longer a mandatory step after a successful smoke refresh.',
    'Use mcp_reload_plan then mcp_reload_schedule only when a new MCP source version must become live; after reconnect prefer one mcp_connector_smoke_refresh call. Read mcp_reload_status separately only when reload/smoke reports failure or ambiguity.',
    'Use git_publish_changes when a clean-index set of explicit paths should be staged, committed and optionally pushed in one governed call. Keep git_stage_plan/git_commit_plan/git_push_plan as granular fallback; governed Git never accepts force, arbitrary remote or arbitrary refspec.',
    'Use llmb_live_readiness and llmb_live_runs for read-only Model Gateway live evidence; llmb_live_test_run defaults control-only and requires explicit confirmation for real model/provider usage.',
    'Use claude_connector_profile when adding the same remote MCP server to claude.ai custom connectors.',
    'LLM-B remains a separate runtime process, but the MCP exposes an allowlisted control/test plane over its canonical live harness.',
];

const DEFAULT_IO_GUIDANCE = Object.freeze([
    'Start broad work with mcp_session_profile and mcp_tools_status; request the full capabilities manifest only when needed.',
    'Batch independent reads/searches with repo_read_file.batch, repo_search_text.batch or repo_bulk_inspect to reduce round-trips.',
    'Use repo_apply_patch_batch for several exact edits; repeated paths remain sequential and atomic per file.',
    'Use repo_read_file.sha256 as expectedHash for safe write/patch calls and keep file-and-directory durability as the normal default.',
    'Use repo_search_text for completeness-oriented filesystem search; use repo_index_search explicitly for convergent FTS/discovery.',
    'Prefer focused validator batches; escalate to broad suites only for cross-cutting or release risk.',
    'After a controlled MCP reload, use mcp_connector_smoke_refresh as the single normal post-restart gate.',
    'Use git_publish_changes for governed stage+commit+upstream push over an explicit path set.',
]);

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
 * @param {{ includeDetails?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildMcpCapabilitiesSummary(options = {}) {
    const groups = getMcpCapabilityGroups();
    const advertisedTools = getAdvertisedMcpToolNames();
    const auth = readMcpAuthConfig();
    const maxPowerDefault = MAX_POWER_REPO_SCOPES.every((scope) => auth.initialScopes.includes(scope));
    const groupCounts = Object.fromEntries(Object.entries(groups).map(([name, tools]) => [name, tools.length]));
    const authProfile = {
        mode: auth.mode,
        enforcement: auth.enforcement,
        authorizationServersConfigured: auth.authorizationServers.length > 0,
        initialScopes: [...auth.initialScopes],
        maxPowerDefault,
    };
    const compact = {
        success: true,
        protocolVersion: PROTOCOL_VERSION,
        capabilitiesVersion: CAPABILITIES_VERSION,
        advertisedToolCount: advertisedTools.length,
        groupCounts,
        deprecatedCount: DEPRECATED_TOOLS.length,
        experimentalCount: EXPERIMENTAL_TOOLS.length,
        securityPolicy: { ...SECURITY_POLICY },
        metadataProfile: {
            outputSchemaPolicy: 'specific-only',
            oauthSecuritySchemes: true,
        },
        authProfile,
        guidanceCount: IO_GUIDANCE.length,
        ioGuidance: [...DEFAULT_IO_GUIDANCE],
        detailsAvailable: true,
    };
    if (options.includeDetails !== true) return compact;
    return {
        ...compact,
        ...groups,
        advertisedTools,
        deprecated: [...DEPRECATED_TOOLS],
        experimental: [...EXPERIMENTAL_TOOLS],
        annotationProfile: { ...ANNOTATION_PROFILE },
        metadataProfile: { ...METADATA_PROFILE },
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
        description: 'Return a compact capability decision surface; request details only for the full tool manifest and guidance.',
        inputSchema: {
            includeDetails: z.boolean().optional().describe('Include full grouped tool names and complete IO guidance. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ includeDetails }) => okResult(buildMcpCapabilitiesSummary({ includeDetails: includeDetails === true })),
    },
];
