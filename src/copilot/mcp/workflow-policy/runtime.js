// @ts-check
/**
 * Single source of truth for low-round-trip MCP workflow policy.
 *
 * Tool descriptions may contain tool-specific details, but the happy path / plan / poll / fallback relationship is
 * defined only here. Session profile, tools-status and meta guidance consume projections of this policy so they cannot
 * silently teach incompatible workflows.
 *
 * @module copilot/mcp/workflow-policy/runtime
 */

import { MCP_TOOL_EXECUTION_LIMITS } from '#copilot/mcp/public/protocol/tools';

export const MCP_WORKFLOW_POLICY_VERSION = '1.3.0';

const WORKFLOW_POLICY = Object.freeze({
    validation: Object.freeze({
        happyPathTool: 'run_copilot_validator',
        batchPreferred: true,
        previewMode: 'dryRun=true',
        pollTools: Object.freeze(['job_get_summary', 'job_get_output']),
        pollPolicy: 'only-if-validator-returns-running-after-bounded-wait',
        broadFallbackTool: 'mcp_run_safe_validation_suite',
    }),
    patch: Object.freeze({
        happyPathTool: 'repo_apply_patch_batch',
        batchPreferred: true,
        previewMode: 'dryRun=true',
        defaultApplyMode: 'per-target-fast',
        defaultFailureMode: 'best-effort',
    }),
    fileBatch: Object.freeze({
        happyPathTool: 'repo_apply_file_batch',
        batchPreferred: true,
        previewMode: 'dryRun=true',
    }),
    publication: Object.freeze({
        happyPathTool: 'git_publish_changes',
        granularFallbackTools: Object.freeze(['git_stage', 'git_commit', 'git_push']),
        granularFallbackOnlyFor: Object.freeze([
            'preexisting-staged-index',
            'merge-or-rebase-state',
            'upstream-or-head-drift',
            'explicit-preview-or-forensics',
            'partial-publish-failure',
        ]),
    }),
    terminal: Object.freeze({
        happyPathTool: 'terminal_exec',
        batchPreferred: true,
        batchCapacity: 32,
        independentKnownCommandsPolicy: 'one-terminal-exec-batch',
        deterministicSequentialPolicy: 'batch-concurrency-1-and-fail-fast',
    }),
    reload: Object.freeze({
        previewMode: 'dryRun=true',
        scheduleTool: 'mcp_reload_schedule',
        statusTool: 'mcp_reload_status',
        smokeTool: 'mcp_connector_smoke_refresh',
        statusPolicy: 'only-on-failure-or-uncertain-transition',
        postRestartPolicy: 'connector-smoke-reconciles-reload-and-readiness',
    }),
});

/** Return the immutable canonical workflow policy. */
export function readMcpWorkflowPolicy() {
    return WORKFLOW_POLICY;
}

/** Projection used by the capabilities status view for approval/workflow guidance. */
export function buildMcpWorkflowStatusProjection() {
    return {
        workflowPolicyVersion: MCP_WORKFLOW_POLICY_VERSION,
        directBatchWorkflows: [
            [
                WORKFLOW_POLICY.patch.happyPathTool,
                `${WORKFLOW_POLICY.patch.happyPathTool}(${WORKFLOW_POLICY.patch.previewMode})`,
            ],
            [
                WORKFLOW_POLICY.fileBatch.happyPathTool,
                `${WORKFLOW_POLICY.fileBatch.happyPathTool}(${WORKFLOW_POLICY.fileBatch.previewMode})`,
            ],
            [
                WORKFLOW_POLICY.validation.happyPathTool,
                `${WORKFLOW_POLICY.validation.happyPathTool}(${WORKFLOW_POLICY.validation.previewMode})`,
            ],
        ],
        planFirstWorkflows: [],
        escalationOnlyPlans: [],
        pollOnlyWhenReturnedRunning: [...WORKFLOW_POLICY.validation.pollTools],
    };
}

/** Projection used by the capabilities session view. */
export function buildMcpSessionWorkflowProjection() {
    return {
        workflowPolicyVersion: MCP_WORKFLOW_POLICY_VERSION,
        taskRouting: {
            patch: [WORKFLOW_POLICY.patch.happyPathTool],
            fileBatch: [WORKFLOW_POLICY.fileBatch.happyPathTool],
            validate: [WORKFLOW_POLICY.validation.happyPathTool, ...WORKFLOW_POLICY.validation.pollTools],
            terminal: [WORKFLOW_POLICY.terminal.happyPathTool],
            reload: [
                WORKFLOW_POLICY.reload.scheduleTool,
                WORKFLOW_POLICY.reload.smokeTool,
                WORKFLOW_POLICY.reload.statusTool,
            ],
            publish: [WORKFLOW_POLICY.publication.happyPathTool],
        },
        preferredWriteWorkflows: [
            {
                task: 'patch',
                flow: [
                    'repo_apply_patch_batch with canonical targets[] and dryRun=false confirmBatch=true when anchors/intent are already known; path/hash/durability are target-owned and default per-target-fast+best-effort preserves atomicity per target and independent progress',
                    'use repo_apply_patch_batch with dryRun=true (and resultMode=detailed when needed) for preview without a separate plan tool',
                ],
            },
            {
                task: 'file-batch',
                flow: [
                    'repo_apply_file_batch dryRun=false confirmBatch=true; safe sequences use sequential-fast while destructive overwrite/remove keeps conservative preflight',
                    'use repo_apply_file_batch with dryRun=true for the same canonical preflight without a separate plan tool',
                ],
            },
            {
                task: 'validate',
                flow: [
                    'run_copilot_validator directly; use batch for several already-known causal validators',
                    'use run_copilot_validator dryRun=true for command preview/inspect-first guidance; do not poll after inline completion',
                    'job_get_summary/job_get_output only if the validator explicitly returns running after the bounded wait',
                ],
            },
            {
                task: 'reload',
                flow: [
                    'use mcp_reload_schedule dryRun=true for profile/safety preview; schedule exactly once with the certified source barrier and confirmRestart=true when the plan is accepted',
                    'after restart/reconnect use mcp_connector_smoke_refresh because it reconciles reload status and post-restart readiness in the same call',
                    'use mcp_reload_status only when the schedule/restart transition failed or remains uncertain; never poll it mechanically',
                ],
            },
            {
                task: 'publish',
                flow: [
                    'git_publish_changes for clean-index publication of explicit paths',
                    'granular Git tools only for the canonical fallback conditions',
                ],
            },
        ],
    };
}

/**
 * Canonical policy sentences inserted into the long-form meta guidance. Tool-specific technical guidance may remain
 * adjacent, but happy-path ordering must come from this projection.
 */
export function buildMcpWorkflowGuidance() {
    return [
        'Prefer repo_apply_patch_batch with canonical targets[] directly when exact-string anchors and intent are already known; each target owns path/baseline hash/durability and its operations are path-relative. Use the same tool with dryRun=true for preview; request resultMode=detailed only when compact preview is insufficient.',
        'Use repo_apply_file_batch directly for ordered filesystem workflows; use the same tool with dryRun=true for canonical preflight/preview.',
        `Use run_copilot_validator directly for validation. For several already-known causal gates, use run_copilot_validator.batch so up to ${MCP_TOOL_EXECUTION_LIMITS.validator.maxBatchRequests} focused/shell/typecheck/lint gates share one MCP call. Use dryRun=true on the same owner to preview exact commands; dryRun=true without a validator returns inspect-first/no-validator guidance. Inline completion means stop: use job_get_summary/job_get_output only when the validator explicitly returns running after its bounded wait. Escalate to mcp_run_safe_validation_suite only for cross-cutting risk or a deliberate release gate.`,
        'When several independent terminal commands are already known before execution, send one terminal_exec.batch call. For deterministic sequential execution use batchConcurrency=1 and batchFailureMode=fail-fast instead of multiple terminal_exec calls.',
        'After a certified mcp_reload_schedule, prefer one mcp_connector_smoke_refresh after restart/reconnect because it reconciles reload and readiness. Use mcp_reload_status only for a failed or uncertain transition; never poll it mechanically.',
        'Use git_publish_changes when a clean-index set of explicit paths should be staged, committed and optionally pushed in one governed call. Keep granular git_stage/git_commit/git_push only for canonical fallback cases; use dryRun=true on those same owners when preview is needed.',
    ];
}
