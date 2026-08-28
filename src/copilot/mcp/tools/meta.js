// @ts-check
/**
 * MCP meta/capability tools.
 *
 * @module copilot/mcp/tools/meta
 */

import { readMcpAuthConfig } from '#copilot/mcp/public/auth';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    MCP_TOOL_EXECUTION_LIMITS,
    MCP_TOOL_EXECUTION_LIMITS_VERSION,
    errorResult,
    okResult,
} from '#copilot/mcp/public/protocol/tools';
import { MCP_TOOL_CONTRACTS_VERSION } from '#copilot/mcp/public/tools/catalog/semantic-contracts';
import { MCP_WORKFLOW_POLICY_VERSION, buildMcpWorkflowGuidance } from '#copilot/mcp/public/workflow-policy';
import { z } from 'zod';

import { buildMcpSessionProfile } from './session-profile.js';
import { readMcpToolsStatus } from './tools-status.js';

const PROTOCOL_VERSION = 'workspace-mcp/0.3.0';
const CAPABILITIES_VERSION = 71;
const READ_TOOLS = [
    'repo_status',
    'repo_tree',
    'repo_root_redaction_status',
    'repo_read_file',
    'repo_bulk_inspect',
    'repo_read_file_chunks',
    'repo_file_stats',
    'repo_diff_files',
    'repo_quarantine_status',
    'repo_search_text',
    'repo_find_symbol_usages',
    'repo_symbol_search',
    'repo_file_outline',
    'repo_working_set',
    'search',
    'fetch',
];

const INDEX_TOOLS = [
    'repo_index_status',
    'repo_index_build',
    'repo_index_search',
    'repo_find_imports',
    'repo_find_orphan_imports',
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

const DEV_TOOLS = [
    'mcp_' + 'dev' + 'container_' + 'network_' + 'posture_' + 'audit',
    'mcp_' + 'dev' + 'container_' + 'network_' + 'control_' + 'plane_' + 'refresh',
];

const VALIDATION_TOOLS = [
    'mcp_run_safe_validation_suite',
    'run_copilot_validator',
    'mcp_validation_dashboard',
    'job_get_summary',
    'job_get_output',
    'job_cancel',
];

const RUNTIME_TOOLS = [
    'delegate_to_repo_autonomy_runner',
    ...DEV_TOOLS,
    'mcp_apps_sdk_readiness',
    'mcp_cloudflare_edge_backup_create',
    'mcp_cloudflare_edge_backups_list',
    'mcp_cloudflare_edge_policy_apply',
    'mcp_cloudflare_edge_snapshot',
    'mcp_cloudflare_metrics_snapshot',
    'mcp_host_block_diagnostics',
    'mcp_cleanup_ai_artifacts',
    'mcp_dependency_outdated',
    'mcp_dependency_upgrade',
    'mcp_maintenance_apply_safe_fixes',
    'terminal_exec',
    'terminal_session_control',
    'terminal_session_read',
    'project_doctor',
    'mcp_client_latency_evidence',
    'mcp_latency_attribution',
    'mcp_latency_dashboard',
    'mcp_latency_pulse',
    'mcp_openai_endpoint_latency',
    'mcp_round_trip_analytics',
    'mcp_runtime_health',
    'mcp_smoke_workspace',
    'mcp_tool_payload_audit',
    'mcp_tunnel_status',
    'mcp_connector_smoke_refresh',
    'mcp_post_restart_readiness',
    'mcp_reload_plan',
    'mcp_reload_status',
    'mcp_reload_schedule',
    'llmb_live_readiness',
    'llmb_live_test_cancel',
    'llmb_live_test_plan',
    'llmb_live_test_run',
    'mcp_capabilities_summary',
];

const CONNECTION_TOOLS = ['mcp_connection_readiness', 'mcp_oauth_issuer_diagnostics', 'mcp_oauth_friction_audit'];
const COPILOT_SDK_TOOLS = ['copilot_sessions'];
/** @type {string[]} */
const DEPRECATED_TOOLS = [];
const EXPERIMENTAL_TOOLS = ['repo_symbol_search', 'repo_file_outline', 'repo_index_search'];

const SECURITY_POLICY = {
    readProtectedPaths: 'blocked',
    listProtectedPaths: 'redacted',
    writeProtectedPaths: 'blocked',
};

const ANNOTATION_PROFILE = {
    readOnlyTools: 'readOnlyHint=true, idempotentHint=true, destructiveHint=false, openWorldHint=false by default',
    boundedWriteTools:
        'readOnlyHint=false, idempotentHint=false, destructiveHint=false, openWorldHint=false by default',
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
    'Use mcp_capabilities_summary view=status before planning broad work when contract/risk/descriptor detail is needed.',
    'Use mcp_capabilities_summary view=session when a compact task-first operating profile is useful.',
    'Use mcp_maintenance_apply_safe_fixes dryRun=true as the canonical batched maintenance preview; execute selected safe fixes only when they add evidence.',
    'Use delegate_to_repo_autonomy_runner dryRun=true for fixed longer workflows before requesting real execution.',
    'Use mcp_host_block_diagnostics after any ChatGPT host-side block to classify it and select a lower-friction replacement.',
    'Use dryRun=true on canonical owners when explicit preview or human inspection is useful; do not pay a separate plan-tool round trip.',
    'Keep includeDiffPreview=false by default for repo_apply_patch, repo_write_file, repo_create_file and repo_diff_files; request textual diffs only when explicitly needed.',
    `Prefer repo_read_file.batch and repo_search_text.batch for up to ${MCP_TOOL_EXECUTION_LIMITS.repoRead.maxBatchRequests} independent operations, with repo_search_text.contextLines up to ${MCP_TOOL_EXECUTION_LIMITS.repoRead.maxSearchContextLines}. Use repo_bulk_inspect when read/search/stat work can be mixed in one call; all three preserve per-item failures and bounded output payloads.`,
    ...buildMcpWorkflowGuidance(),
    `Use repo_apply_patch_batch for up to ${MCP_TOOL_EXECUTION_LIMITS.repoPatch.maxBatchOperations} exact-string patches across up to ${MCP_TOOL_EXECUTION_LIMITS.repoPatch.maxBatchTargets} targets and ${Math.floor(MCP_TOOL_EXECUTION_LIMITS.repoPatch.maxBatchInputBytes / (1024 * 1024))} MiB input. Direct apply defaults to ${MCP_TOOL_EXECUTION_LIMITS.repoPatch.defaultApplyMode} + ${MCP_TOOL_EXECUTION_LIMITS.repoPatch.defaultFailureMode}: each target is compute-before-write atomic, same-file operations publish together, and independent targets can progress even when another fails. global-preflight is explicit all-target preview gating, not a cross-file transaction. Compact failures report one causal row per failed target plus affected operation indices and bounded recovery evidence.`,
    'For repo_apply_patch_batch, use canonical targets[]: declare each path once, put the initial sha256 baseline in target.expectedHash, optional durability on that target, and keep only relative edit semantics in target.operations[]. This avoids repeated path/hash payload and makes baseline intent explicit.',
    'Keep repo_apply_patch_batch resultMode=compact by default for low-context success feedback; request detailed only for forensic per-operation hash/line/byte metadata. includeDiffPreview automatically forces detailed output.',
    'repo_apply_file_batch defaults adaptively: create/move-without-overwrite/quarantine sequences use sequential-fast; remove_file or overwrite moves use global-preflight. Explicit applyMode overrides that risk-aware default.',
    'Repository text scripts (.sh/.ps1/.bat/.cmd) are writable source code; editing is not execution. Secret/credential paths, .git/symlink escapes, and opaque native binaries remain blocked by the canonical path policy. Use repo_read_file.sha256 as expectedHash for safe write/patch calls when stale-write detection matters.',
    'Write/create/patch tools accept durability=file-and-directory|file|none. Keep file-and-directory as the default for strongest crash durability; file skips parent-directory fsync; none also skips file flush but still preserves path policy, locks, atomic publish and hash preconditions.',
    'Use repo_quarantine_file before repo_remove_file when reversible cleanup is acceptable.',
    'Use repo_read_file_chunks for large files instead of requesting entire content.',
    'Use repo_search_text as the completeness-oriented filesystem search; it prefers rg when available and avoids treating temporarily partial derived-index hits as complete. Use repo_index_search explicitly for FTS/discovery over the convergent SQLite index.',
    'Use repo_search_text.contextLines for investigation and cursor/nextCursor for pagination.',
    'Use repo_find_symbol_usages for impact analysis before refactors.',
    'Use repo_index_search/repo_find_imports for explicit indexed navigation; repo_symbol_search already uses the shared symbol index as its fast path and falls back to filesystem search when needed.',
    'Use repo_find_orphan_imports before or after file moves to detect broken local imports.',
    'COPILOT_MCP_INDEX_AUTO_BUILD defaults to true so indexed navigation is warmed outside ChatGPT host calls.',
    'Use repo_symbol_search and repo_file_outline before edits that need code navigation.',
    'Use repo_working_set when repeated work is concentrated in a subtree: open defaults to source-first coverage selection, find stays process-local, and refresh defaults to O(delta). Add seedPaths for known causal files or seedSymbols to resolve exact symbols through the local index in the same open call; both stay inside maxFiles. Refresh converges legitimate file removals by shrinking the live set without silent backfill, and contextMode=auto omits empty-delta manifests while keeping changed/removed/failure context inline; use include/omit only when explicitly desired. Use lexical only for explicit historical prefix ordering.',
    `Validator concurrency remains intentionally capped at ${MCP_TOOL_EXECUTION_LIMITS.validator.maxBatchConcurrency} to protect WSL/runtime headroom; devcontainer-shell remains fixed to bash -n over canonical allowlisted scripts and accepts no caller command/path.`,
    'Use mcp_validation_dashboard for dashboard/list/latest validator-state views, then job_get_summary before job_get_output; read job logs only with small tailBytes and only when needed.',
    'Use repo_tree path="." for the real workspace root.',
    'Use repo_root_redaction_status to audit hidden/protected root redaction without returning hidden names.',
    'Use mcp_connection_readiness view=current-url to recover the configured/current connector URL without passing it as input.',
    'Use mcp_connection_readiness view=auth-profile to confirm OAuth scopes, Protected Resource Metadata and WWW-Authenticate challenge metadata.',
    'Use mcp_oauth_issuer_diagnostics before changing issuer, CIMD, OIDC or Cloudflare OAuth settings.',
    'Use mcp_oauth_friction_audit after OAuth or connector changes to detect reauth risk and metadata drift.',
    'After an MCP/Cloudflare reload, use mcp_connector_smoke_refresh as the single normal post-restart gate: it refreshes OAuth/tools/SSE smoke and returns reconciled post-restart readiness in the same response. Keep includeDetails=false unless deep smoke diagnostics are needed.',
    'Use mcp_cloudflare_edge_snapshot with no view (overview) for the consolidated tunnel/DNS/edge/policy-diff rollback snapshot; use explicit view=remote|edge|policy-plan|policy-diff|config|capabilities|skip|passthrough-diff|post-change when only one external Cloudflare projection is needed.',
    'Cloudflare read views are fixed-external and dispatch directly; view=remote remains compact, cache controls belong only to view=edge|config, and includeDetails belongs only to view=post-change.',
    'Use mcp_cloudflare_edge_backup_create for an explicit rollback snapshot before manual dashboard/API changes; canonical apply tools create their own mandatory backup immediately before real mutation.',
    'Use mcp_cloudflare_edge_backups_list to find the latest rollback reference before and after Cloudflare policy changes.',
    'Use mcp_cloudflare_edge_policy_apply target=edge-policy|passthrough with dryRun=true first; real Cloudflare mutation requires dryRun=false and confirmApply=true, and creates a mandatory backup immediately before mutation.',
    'Use mcp_cloudflare_metrics_snapshot (view=metrics by default) for local cloudflared metrics; use view=transport-plan for the controlled transport benchmark design and last persisted comparison. Treat cloudflared_tunnel_request_errors as a process-lifetime origin-proxy signal that is advisory by itself: correlate its window delta with HTTP status-code deltas, fresh connector smoke, origin cancellations/errors and HA connection state before classifying transport health.',
    'Use mcp_devcontainer_network_posture_audit to distinguish current DNS/control-plane faults from stale DevContainer metadata. The canonical Network Control Plane script is .devcontainer/scripts/network-control-plane-state.sh; lifecycle hooks self-heal an unreadable stale configured path when that canonical script is available. Use mcp_devcontainer_network_control_plane_refresh when only the passive aggregated /tmp state needs regeneration: it accepts no command/path, runs exactly bash <canonical-script> --quiet summary with bounds, performs no external network probes, then returns a fresh posture audit.',
    'Use mcp_post_restart_readiness as a read-only diagnostic fallback when you do not want to refresh connector smoke; it is no longer a mandatory step after a successful smoke refresh.',
    'Use mcp_reload_plan then mcp_reload_schedule only when a new MCP source version must become live; after reconnect prefer one mcp_connector_smoke_refresh call. Read mcp_reload_status separately only when reload/smoke reports failure or ambiguity.',
    'Governed Git publication never accepts force, arbitrary remote or arbitrary refspec.',
    'Use llmb_live_readiness view=readiness or view=runs for read-only Model Gateway live evidence; keep llmb_live_test_plan as least-authority preview; llmb_live_test_run defaults control-only and requires explicit confirmation for real model/provider usage.',
    'Use mcp_connection_readiness view=profile client=claude when adding the same remote MCP server to claude.ai custom connectors.',
    'LLM-B remains a separate runtime process, but the MCP exposes an allowlisted control/test plane over its canonical live harness.',
];

const DEFAULT_IO_GUIDANCE = Object.freeze([
    'Start broad work with repo_status; use mcp_capabilities_summary view=session or view=status only when operating-profile or contract detail is needed.',
    'Batch independent reads/searches with repo_read_file.batch, repo_search_text.batch or repo_bulk_inspect to reduce round-trips.',
    'Use repo_working_set when repeated context/symbol work benefits from one bounded prewarmed manifest and O(delta) refresh; broad opens use source-first coverage, known files/symbols can be pinned inside the same cap, and empty refreshes omit duplicate context by default.',
    'Use repo_apply_patch_batch targets[] for several exact edits; operations within each target remain sequential and atomic for that file.',
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
    const broadInitialGrant = auth.scopesSupported.every((scope) => auth.initialScopes.includes(scope));
    const groupCounts = Object.fromEntries(Object.entries(groups).map(([name, tools]) => [name, tools.length]));
    const authProfile = {
        mode: auth.mode,
        enforcement: auth.enforcement,
        authorizationServersConfigured: auth.authorizationServers.length > 0,
        initialScopes: [...auth.initialScopes],
        initialScopeProfile: auth.initialScopeProfile,
        stepUpPreferred: auth.stepUpPreferred,
        broadInitialGrant,
    };
    const compact = {
        success: true,
        protocolVersion: PROTOCOL_VERSION,
        capabilitiesVersion: CAPABILITIES_VERSION,
        executionLimitsVersion: MCP_TOOL_EXECUTION_LIMITS_VERSION,
        executionLimits: MCP_TOOL_EXECUTION_LIMITS,
        workflowPolicyVersion: MCP_WORKFLOW_POLICY_VERSION,
        toolSurfaceRevision: {
            semanticContractVersion: MCP_TOOL_CONTRACTS_VERSION,
            wireRevisionAuthority: 'mcp_capabilities_summary(view=status).descriptorRevisionProfile.globalFingerprint',
            migrationLedgerAuthority:
                'src/copilot/docs/WORKSPACE_MCP_TOOL_SURFACE_AUDITORIA_SUPLEMENTAR_RACIONALIZACAO_DESTINO_131_TOOLS_2026-08-27.md',
        },
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
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const metaTools = [
    defineMcpRawTool({
        name: 'mcp_capabilities_summary',
        title: 'MCP capabilities summary',
        description:
            'Read one local capability projection: compact/full summary, task-first session profile, or contract/risk/wire status.',
        inputSchema: {
            view: z
                .enum(['summary', 'session', 'status'])
                .optional()
                ['describe']('Projection to read. Default: summary.'),
            includeDetails: z
                .boolean()
                .optional()
                ['describe']('view=summary only: include grouped tool names and complete IO guidance.'),
        },

        handler: async ({ view, includeDetails }, operationContext) => {
            const projection = view ?? 'summary';
            if (projection === 'session') {
                if (includeDetails !== undefined) {
                    return errorResult('includeDetails is valid only with view=summary.', {
                        code: 'ERR_CAPABILITIES_VIEW_FIELDS',
                        view: projection,
                    });
                }
                return okResult(buildMcpSessionProfile());
            }
            if (projection === 'status') {
                if (includeDetails !== undefined) {
                    return errorResult('includeDetails is valid only with view=summary.', {
                        code: 'ERR_CAPABILITIES_VIEW_FIELDS',
                        view: projection,
                    });
                }
                return okResult(await readMcpToolsStatus(operationContext));
            }
            return okResult(buildMcpCapabilitiesSummary({ includeDetails: includeDetails === true }));
        },
    }),
];
