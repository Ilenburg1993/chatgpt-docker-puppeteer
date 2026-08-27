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

export const MCP_WORKFLOW_POLICY_VERSION = '1.0.0';

const WORKFLOW_POLICY = Object.freeze({
    validation: Object.freeze({
        happyPathTool: 'run_copilot_validator',
        batchPreferred: true,
        planTool: 'mcp_validation_plan',
        planPolicy: 'escalation-only',
        pollTools: Object.freeze(['job_get_summary', 'job_get_output']),
        pollPolicy: 'only-if-validator-returns-running-after-bounded-wait',
        broadFallbackTool: 'mcp_run_safe_validation_suite',
    }),
    patch: Object.freeze({
        happyPathTool: 'repo_apply_patch_batch',
        batchPreferred: true,
        planTool: 'repo_patch_batch_plan',
        planPolicy: 'preview-or-separate-approval-only',
        defaultApplyMode: 'per-target-fast',
        defaultFailureMode: 'best-effort',
    }),
    fileBatch: Object.freeze({
        happyPathTool: 'repo_apply_file_batch',
        batchPreferred: true,
        planTool: 'repo_apply_file_batch_plan',
        planPolicy: 'preview-or-separate-approval-only',
    }),
    publication: Object.freeze({
        happyPathTool: 'git_publish_changes',
        granularFallbackTools: Object.freeze([
            'git_stage_plan',
            'git_stage',
            'git_commit_plan',
            'git_commit',
            'git_push_plan',
            'git_push',
        ]),
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
});

/** Return the immutable canonical workflow policy. */
export function readMcpWorkflowPolicy() {
    return WORKFLOW_POLICY;
}

/** Projection used by mcp_tools_status approval/workflow guidance. */
export function buildMcpWorkflowStatusProjection() {
    return {
        workflowPolicyVersion: MCP_WORKFLOW_POLICY_VERSION,
        directBatchWorkflows: [
            [WORKFLOW_POLICY.patch.happyPathTool, WORKFLOW_POLICY.patch.planTool],
            [WORKFLOW_POLICY.fileBatch.happyPathTool, WORKFLOW_POLICY.fileBatch.planTool],
            [WORKFLOW_POLICY.validation.happyPathTool, WORKFLOW_POLICY.validation.planTool],
        ],
        planFirstWorkflows: [],
        escalationOnlyPlans: [WORKFLOW_POLICY.validation.planTool],
        pollOnlyWhenReturnedRunning: [...WORKFLOW_POLICY.validation.pollTools],
    };
}

/** Projection used by mcp_session_profile. */
export function buildMcpSessionWorkflowProjection() {
    return {
        workflowPolicyVersion: MCP_WORKFLOW_POLICY_VERSION,
        taskRouting: {
            patch: [WORKFLOW_POLICY.patch.happyPathTool, WORKFLOW_POLICY.patch.planTool],
            fileBatch: [WORKFLOW_POLICY.fileBatch.happyPathTool, WORKFLOW_POLICY.fileBatch.planTool],
            validate: [
                WORKFLOW_POLICY.validation.happyPathTool,
                WORKFLOW_POLICY.validation.planTool,
                ...WORKFLOW_POLICY.validation.pollTools,
            ],
            terminal: [WORKFLOW_POLICY.terminal.happyPathTool],
            publish: [WORKFLOW_POLICY.publication.happyPathTool],
        },
        preferredWriteWorkflows: [
            {
                task: 'patch',
                flow: [
                    'repo_apply_patch_batch dryRun=false confirmBatch=true when anchors/intent are already known; default per-target-fast+best-effort preserves atomicity per target and independent progress',
                    'repo_patch_batch_plan only when an explicit preview or separate approval boundary adds information',
                ],
            },
            {
                task: 'file-batch',
                flow: [
                    'repo_apply_file_batch dryRun=false confirmBatch=true; safe sequences use sequential-fast while destructive overwrite/remove keeps conservative preflight',
                    'repo_apply_file_batch_plan only when an explicit preview or separate approval boundary adds information',
                ],
            },
            {
                task: 'validate',
                flow: [
                    'run_copilot_validator directly; use batch for several already-known causal validators',
                    'mcp_validation_plan only for explicit preview/escalation; do not poll after inline completion',
                    'job_get_summary/job_get_output only if the validator explicitly returns running after the bounded wait',
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
        'Prefer repo_apply_patch_batch directly when exact-string anchors and intent are already known; use repo_patch_batch_plan only when a separate read-only preview or approval boundary adds information.',
        'Use repo_apply_file_batch directly for ordered filesystem workflows; use repo_apply_file_batch_plan only when a separate read-only preview or approval boundary adds information.',
        `Use run_copilot_validator directly for validation. For several already-known causal gates, use run_copilot_validator.batch so up to ${MCP_TOOL_EXECUTION_LIMITS.validator.maxBatchRequests} focused/shell/typecheck/lint gates share one MCP call. mcp_validation_plan is escalation/preview-only, never a happy-path prerequisite. Inline completion means stop: use job_get_summary/job_get_output only when the validator explicitly returns running after its bounded wait. Escalate to mcp_run_safe_validation_suite only for cross-cutting risk or a deliberate release gate.`,
        'When several independent terminal commands are already known before execution, send one terminal_exec.batch call. For deterministic sequential execution use batchConcurrency=1 and batchFailureMode=fail-fast instead of multiple terminal_exec calls.',
        'Use git_publish_changes when a clean-index set of explicit paths should be staged, committed and optionally pushed in one governed call. Keep granular Git plan/stage/commit/push tools only for the canonical fallback cases.',
    ];
}
