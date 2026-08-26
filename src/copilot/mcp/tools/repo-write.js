// @ts-check
/**
 * Controlled workspace write MCP tools.
 *
 * @module copilot/mcp/tools/repo-write
 */

import {
    errorResult,
    estimateStructuredTextResultBytes,
    MCP_TOOL_EXECUTION_LIMITS,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolValidationConfig,
    requireMcpToolWorkspace,
    withResultExecutionHint,
    withResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';
import { canRunCopilotValidatorInline } from '#copilot/mcp/public/validation';
import {
    compactRepositoryPatchFailureRows,
    summarizeRepositoryPatchFailures,
} from '#copilot/mcp/public/workspace/repository/patch';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    createRepoWriteRuntime,
    executeRepoFileBatchWorkflow,
    executeRepoPatchBatchWorkflow,
    executeRepositoryCreateFile,
    executeRepositoryMoveFile,
    executeRepositoryQuarantineFile,
    executeRepositoryRemoveFile,
    executeRepositoryRestoreQuarantinedFile,
    executeRepositoryWriteFile,
    inspectRepositoryQuarantinedFile,
    listRepositoryQuarantine,
    MAX_POST_PATCH_VALIDATORS,
    normalizePostPatchValidationRequests,
    POST_PATCH_VALIDATOR_NAMES,
    quarantineIdSchema,
    resolveFileBatchApplyMode,
    runFileBatchPreflight,
    runRepoWritePatchTargetGroups,
    writeQuarantineMetadataDefault,
} from '#copilot/mcp/public/workspace/repository/write';
import { z } from 'zod';

/** @typedef {import('#copilot/mcp/public/workspace/repository/write').RepoWriteQuarantineMetadataInterceptor} RepoWriteQuarantineMetadataInterceptor */
/** @typedef {import('#copilot/mcp/public/workspace/repository/write').RepoWriteQuarantineMetadataWriter} RepoWriteQuarantineMetadataWriter */

const { maxOperations: MAX_BATCH_FILE_OPERATIONS } = MCP_TOOL_EXECUTION_LIMITS.repoFileBatch;
const {
    maxBatchOperations: MAX_PATCH_BATCH_OPERATIONS,
    maxBatchTargets: MAX_PATCH_BATCH_TARGETS,
    maxBatchInputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
    defaultPlanConcurrency: DEFAULT_PATCH_PLAN_CONCURRENCY,
    defaultFastConcurrency: DEFAULT_PATCH_FAST_CONCURRENCY,
    maxTargetConcurrency: MAX_PATCH_TARGET_CONCURRENCY,
} = MCP_TOOL_EXECUTION_LIMITS.repoPatch;

/**
 * Resolve batch write intent defensively. Some connector/host adapters may omit an optional boolean when its value is
 * false; confirmBatch=true is itself an explicit write acknowledgement, while dryRun=true always wins.
 *
 * @param {boolean | undefined} dryRun
 * @param {boolean | undefined} confirmBatch
 */
function resolveBatchDryRun(dryRun, confirmBatch) {
    if (dryRun === true) return true;
    if (dryRun === false) return false;
    return confirmBatch !== true;
}

/** @param {Record<string, unknown>[]} failures */
function countPatchFailuresWithInlineNextAction(failures) {
    return failures.filter((failure) => typeof failure['nextAction'] === 'string' && failure['nextAction'].length > 0)
        .length;
}

/** @param {Record<string, unknown>[]} failures */
function countPatchFailuresWithRecoveryAnchor(failures) {
    return failures.filter((failure) => hasPatchRecoveryAnchor(failure['details'])).length;
}

/** @param {unknown} details */
function hasPatchRecoveryAnchor(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
    return /** @type {Record<string, unknown>} */ (details)['recoveryExactAnchor'] === true;
}

const durabilitySchema = z
    .enum(['file-and-directory', 'file', 'none'])
    .optional()
    ['describe'](
        'Crash-durability profile. Default file-and-directory. file skips parent-directory fsync; none also skips file flush. Atomic publish, locks, path policy and hash preconditions remain enforced.',
    );

const postPatchValidationRequestSchema = z.object({
    validator: z.enum(POST_PATCH_VALIDATOR_NAMES),
    testFile: z.string().min(1).max(1024).optional(),
    timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    waitMs: z.number().int().min(0).max(120_000).optional(),
    failureTailBytes: z.number().int().min(1_000).max(12_000).optional(),
});

const patchBatchOperationSchema = z.object({
    path: z.string().min(1)['describe']('Workspace-relative file path.'),
    old_string: z.string().min(1)['describe']('Exact text to replace.'),
    new_string: z.string()['describe']('Replacement text. Use an empty string to delete matched text.'),
    replace_all: z.boolean().optional()['describe']('Replace every occurrence of old_string. Default: false.'),
    expected_occurrences: z
        .number()
        .int()
        .min(1)
        .optional()
        ['describe']('Require an exact occurrence count before applying.'),
    occurrence_index: z
        .number()
        .int()
        .min(1)
        .optional()
        ['describe']('1-based occurrence index to replace when old_string appears more than once.'),
    expectedHash: z
        .string()
        .optional()
        ['describe'](
            'Expected SHA-256. For repeated same-file operations, repeat the initial file hash to use one group-baseline precondition; distinct hashes keep per-operation virtual-state checks.',
        ),
    allowNoop: z.boolean().optional()['describe']('Allow old_string and new_string to be identical. Default: false.'),
    diffContextLines: z.number().int().min(0).max(20).optional()['describe']('Context lines in diff preview.'),
    maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
    includeDiffPreview: z
        .boolean()
        .optional()
        ['describe']('Include textual diffPreview in each operation result. Default: false.'),
});

const batchOperationSchema = z['discriminatedUnion']('type', [
    z.object({
        type: z.literal('create_file'),
        path: z.string().min(1)['describe']('Workspace-relative file path to create.'),
        content: z.string().optional()['describe']('Initial UTF-8 content. Default: empty string.'),
        createParentDirs: z.boolean().optional()['describe']('Create parent directories. Default: true.'),
        durability: durabilitySchema,
    }),
    z.object({
        type: z.literal('move_file'),
        source: z.string().min(1)['describe']('Workspace-relative existing source file.'),
        destination: z.string().min(1)['describe']('Workspace-relative destination path.'),
        overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
        confirmOverwrite: z.boolean().optional()['describe']('Must be true when overwrite=true.'),
    }),
    z.object({
        type: z.literal('quarantine_file'),
        path: z.string().min(1)['describe']('Workspace-relative file path to move into reversible quarantine.'),
    }),
    z.object({
        type: z.literal('set_executable'),
        path: z.string().min(1)['describe']('Workspace-relative regular file whose executable bits should be toggled.'),
        executable: z
            .boolean()
            ['describe']('When true, add POSIX executable bits; when false, remove only executable bits.'),
    }),
    z.object({
        type: z.literal('remove_file'),
        path: z
            .string()
            .min(1)
            ['describe']('Workspace-relative file path to delete. Prefer quarantine_file when possible.'),
        confirm: z.boolean().optional()['describe']('Must be true for remove_file when dryRun=false.'),
    }),
]);

/**
 * @param {boolean | undefined} include
 * @param {{ diff: string; truncated: boolean; lines: number; contextLines: number; bytes?: number }} diff
 * @returns {Record<string, unknown>}
 */
function maybeDiffPreview(include, diff) {
    return include === true
        ? {
              diffPreview: diff.diff,
              diffPreviewTruncated: diff.truncated,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          }
        : {
              diffPreviewSuppressed: true,
              diffPreviewAvailable: diff.lines > 0,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          };
}

/**
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>[]} operations
 */
function resolvePatchBatchResultMode(args, operations) {
    const requestedResultMode = args['resultMode'] === 'detailed' ? 'detailed' : 'compact';
    const forcedByDiffPreview = operations.some((operation) => operation['includeDiffPreview'] === true);
    return {
        requestedResultMode,
        resultMode: forcedByDiffPreview ? 'detailed' : requestedResultMode,
        forcedByDiffPreview,
    };
}

/** @param {Record<string, unknown>} row */
function compactPatchBatchSuccessRow(row) {
    return {
        index: row['index'],
        success: true,
        path: row['path'],
        noop: row['noop'] === true,
        replacedOccurrences: row['replacedOccurrences'],
        ...(typeof row['expectedHashMode'] === 'string' ? { expectedHashMode: row['expectedHashMode'] } : {}),
    };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {boolean} dryRun
 */
function summarizePatchBatchTargets(rows, dryRun) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const groups = new Map();
    for (const row of rows) {
        if (row['success'] !== true || typeof row['path'] !== 'string') continue;
        const group = groups.get(row['path']) ?? [];
        group.push(row);
        groups.set(row['path'], group);
    }
    return [...groups.entries()].map(([path, group]) => {
        const ordered = [...group].sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0));
        const first = /** @type {Record<string, unknown>} */ (ordered[0] ?? {});
        const last = /** @type {Record<string, unknown>} */ (ordered.at(-1) ?? {});
        const traceId = ordered.find((row) => typeof row['traceId'] === 'string')?.['traceId'];
        const replacedOccurrences = ordered.reduce((sum, row) => sum + Number(row['replacedOccurrences'] ?? 0), 0);
        return {
            path,
            operationIndices: ordered.map((row) => Number(row['index'] ?? 0)),
            operationCount: ordered.length,
            noopCount: ordered.filter((row) => row['noop'] === true).length,
            replacedOccurrences,
            ...(typeof first['expectedHashMode'] === 'string' ? { expectedHashMode: first['expectedHashMode'] } : {}),
            ...(typeof first['previousHash'] === 'string' ? { initialHash: first['previousHash'] } : {}),
            ...(typeof (dryRun ? last['projectedHash'] : last['contentHash']) === 'string'
                ? { finalHash: dryRun ? last['projectedHash'] : last['contentHash'] }
                : {}),
            ...(Number.isFinite(Number(last['projectedBytes']))
                ? { projectedBytes: Number(last['projectedBytes']) }
                : {}),
            ...(!dryRun && Number.isFinite(Number(first['batchBytesWritten'] ?? last['bytesWritten']))
                ? { bytesWritten: Number(first['batchBytesWritten'] ?? last['bytesWritten']) }
                : {}),
            ...(typeof traceId === 'string' ? { traceId } : {}),
        };
    });
}

/** @param {Record<string, unknown>[]} operations */
function inspectPatchBatchEnvelope(operations) {
    /** @type {number} */
    let inputBytes;
    try {
        inputBytes = Buffer.byteLength(JSON.stringify(operations), 'utf8');
    } catch {
        return { ok: false, code: 'ERR_PATCH_BATCH_INPUT_SERIALIZATION', inputBytes: null, targetCount: 0 };
    }
    const targetCount = new Set(operations.map((operation) => String(operation['path'] ?? ''))).size;
    if (operations.length > MAX_PATCH_BATCH_OPERATIONS) {
        return { ok: false, code: 'ERR_PATCH_BATCH_OPERATION_LIMIT', inputBytes, targetCount };
    }
    if (targetCount > MAX_PATCH_BATCH_TARGETS) {
        return { ok: false, code: 'ERR_PATCH_BATCH_TARGET_LIMIT', inputBytes, targetCount };
    }
    if (inputBytes > MAX_PATCH_BATCH_INPUT_BYTES) {
        return { ok: false, code: 'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT', inputBytes, targetCount };
    }
    return { ok: true, code: null, inputBytes, targetCount };
}

/**
 * Project one domain write outcome into the MCP result envelope while keeping audit in the exposure layer.
 *
 * @param {import('#copilot/mcp/public/workspace/repository/write').RepoWriteRuntime} runtime
 * @param {Awaited<ReturnType<typeof executeRepositoryWriteFile>>} outcome
 * @param {boolean} [includeDiffPreview]
 */
async function projectRepoWriteOutcome(runtime, outcome, includeDiffPreview = false) {
    if (outcome.audit) await runtime.audit.append(outcome.audit);
    if (!outcome.ok) return errorResult(outcome.message, outcome.details);
    const structured = outcome.diff
        ? { ...outcome.value, ...maybeDiffPreview(includeDiffPreview, outcome.diff) }
        : outcome.value;
    if (outcome.diff && includeDiffPreview) return okResult(structured, outcome.diff.diff);
    return typeof outcome.text === 'string' ? okResult(structured, outcome.text) : okResult(structured);
}

/**
 * Project the patch-batch domain state machine into the MCP result/audit surface.
 *
 * @param {import('#copilot/mcp/public/workspace/repository/write').RepoWriteRuntime} runtime
 * @param {Awaited<ReturnType<typeof executeRepoPatchBatchWorkflow>>} workflow
 * @param {{
 *     operations: Record<string, unknown>[];
 *     targetCount: number;
 *     inputBytes: number | null;
 *     requestedResultMode: string;
 *     resultMode: string;
 *     forcedByDiffPreview: boolean;
 *     includePreflightDetails: boolean;
 * }} presentation
 */
async function projectRepoPatchBatchWorkflow(runtime, workflow, presentation) {
    const { operations, targetCount, inputBytes, requestedResultMode, resultMode, forcedByDiffPreview } = presentation;
    if (workflow.kind === 'dry-run') {
        const outputFailures =
            resultMode === 'detailed' ? workflow.failed : compactRepositoryPatchFailureRows(workflow.failed);
        const outputOperations =
            resultMode === 'detailed'
                ? workflow.run.operations
                : workflow.run.operations
                      .filter((operation) => operation['success'] === true)
                      .map((operation) => compactPatchBatchSuccessRow(operation));
        const structured = {
            success: workflow.failed.length === 0,
            dryRun: true,
            applyMode: workflow.effectiveApplyMode,
            executionId: workflow.run.execution.executionId,
            operationCount: operations.length,
            targetCount,
            inputBytes,
            failedCount: workflow.failed.length,
            reportedFailureCount: outputFailures.length,
            ...(workflow.failed.length > 0 ? { failureSummary: workflow.failureSummary } : {}),
            skippedCount: workflow.run.execution.skippedCount,
            concurrency: workflow.run.execution.concurrency,
            durationMs: workflow.run.execution.durationMs,
            requestedResultMode,
            resultMode,
            resultModeForcedByDiffPreview: forcedByDiffPreview,
            detailsAvailable: true,
            targetSummaries: summarizePatchBatchTargets(workflow.run.operations, true),
            postValidation: workflow.postValidation,
            operations: outputOperations,
            failures: outputFailures,
            applied: [],
        };
        const text =
            workflow.failed.length === 0
                ? `Patch batch dry-run succeeded for ${operations.length} operation(s); no files modified.`
                : `Patch batch dry-run found ${workflow.failureSummary.causalFailureCount} causal target failure(s) affecting ${workflow.failureSummary.failedOperationCount} operation(s); no files modified.`;
        const result = withResultSizeHint(okResult(structured, text), {
            bytes: estimateStructuredTextResultBytes(structured, text),
            strategy: 'conservative-estimate',
            source: 'repo_apply_patch_batch',
        });
        return withResultExecutionHint(result, {
            logicalOperations: operations.length,
            failedOperations: workflow.failureSummary.causalFailureCount,
            skippedOperations: workflow.run.execution.skippedCount + workflow.failureSummary.abortedOperationCount,
            mode: 'patch-dry-run:best-effort',
        });
    }

    if (workflow.kind === 'preflight-blocked') {
        const outputFailures =
            resultMode === 'detailed'
                ? workflow.failedPreflight
                : compactRepositoryPatchFailureRows(workflow.failedPreflight);
        const structured = {
            success: false,
            dryRun: false,
            applyMode: workflow.effectiveApplyMode,
            preflightBlockedApply: true,
            operationCount: operations.length,
            targetCount,
            inputBytes,
            requestedResultMode,
            resultMode,
            resultModeForcedByDiffPreview: forcedByDiffPreview,
            detailsAvailable: true,
            failedCount: workflow.failedPreflight.length,
            reportedFailureCount: outputFailures.length,
            failureSummary: workflow.failureSummary,
            skippedCount: 0,
            preflightSummary: {
                ran: true,
                success: false,
                executionId: workflow.preflight.execution.executionId,
                failedCount: workflow.failedPreflight.length,
                durationMs: workflow.preflight.execution.durationMs,
            },
            preflight: presentation.includePreflightDetails ? workflow.preflight.operations : [],
            applied: [],
            failures: outputFailures,
        };
        const compactPreflightFailures = compactRepositoryPatchFailureRows(workflow.failedPreflight);
        await runtime.audit.append({
            event: 'repo_apply_patch_batch_preflight_blocked',
            tool: 'repo_apply_patch_batch',
            applyMode: workflow.effectiveApplyMode,
            operationCount: operations.length,
            targetCount,
            causalFailureCount: workflow.failureSummary.causalFailureCount,
            failedTargetCount: workflow.failureSummary.failedTargetCount,
            abortedOperationCount: workflow.failureSummary.abortedOperationCount,
            recoveryRequiredTargetCount: workflow.failureSummary.recoveryRequiredTargetCount,
            convergenceCandidateCount: workflow.failureSummary.convergenceCandidateCount,
            inlineNextActionTargetCount: countPatchFailuresWithInlineNextAction(compactPreflightFailures),
            inlineRecoveryAnchorTargetCount: countPatchFailuresWithRecoveryAnchor(compactPreflightFailures),
            causalByCode: workflow.failureSummary.causalByCode,
            failureClassCounts: workflow.failureSummary.failureClassCounts,
            retryabilityCounts: workflow.failureSummary.retryabilityCounts,
        });
        const text = `Global preflight found ${workflow.failureSummary.causalFailureCount} causal target failure(s) affecting ${workflow.failureSummary.failedOperationCount} operation(s); no files modified.`;
        const result = withResultSizeHint(okResult(structured, text), {
            bytes: estimateStructuredTextResultBytes(structured, text),
            strategy: 'conservative-estimate',
            source: 'repo_apply_patch_batch',
        });
        return withResultExecutionHint(result, {
            logicalOperations: operations.length,
            failedOperations: workflow.failureSummary.causalFailureCount,
            skippedOperations: workflow.failureSummary.abortedOperationCount,
            mode: 'patch-apply:global-preflight-blocked',
        });
    }

    const outputFailures =
        resultMode === 'detailed' ? workflow.failedApply : compactRepositoryPatchFailureRows(workflow.failedApply);
    const outputApplied =
        resultMode === 'detailed'
            ? workflow.applied
            : workflow.succeeded.map((operation) => compactPatchBatchSuccessRow(operation));
    const targetTransitions = summarizePatchBatchTargets(workflow.succeeded, false)
        .filter(
            (summary) =>
                typeof summary['path'] === 'string' &&
                typeof summary['initialHash'] === 'string' &&
                typeof summary['finalHash'] === 'string',
        )
        .map((summary) => ({
            path: summary['path'],
            previousHash: summary['initialHash'],
            contentHash: summary['finalHash'],
            traceId: typeof summary['traceId'] === 'string' ? summary['traceId'] : null,
        }));
    await runtime.audit.append({
        event: workflow.patchFullyApplied ? 'repo_apply_patch_batch_applied' : 'repo_apply_patch_batch_partial_failure',
        tool: 'repo_apply_patch_batch',
        executionId: workflow.applyRun.execution.executionId,
        applyMode: workflow.effectiveApplyMode,
        failureMode: workflow.effectiveFailureMode,
        operationCount: operations.length,
        targetCount,
        resultMode,
        preflightElided: workflow.preflightElided,
        appliedCount: workflow.succeeded.length,
        failedCount: workflow.failedApply.length,
        skippedCount: workflow.skipped.length,
        partial: workflow.partial,
        workflowSuccess: workflow.patchFullyApplied,
        targetTransitions,
        causalFailureCount: workflow.failureSummary.causalFailureCount,
        failedTargetCount: workflow.failureSummary.failedTargetCount,
        abortedOperationCount: workflow.failureSummary.abortedOperationCount,
        recoveryRequiredTargetCount: workflow.failureSummary.recoveryRequiredTargetCount,
        convergenceCandidateCount: workflow.failureSummary.convergenceCandidateCount,
        inlineNextActionTargetCount: countPatchFailuresWithInlineNextAction(
            compactRepositoryPatchFailureRows(workflow.failedApply),
        ),
        inlineRecoveryAnchorTargetCount: countPatchFailuresWithRecoveryAnchor(
            compactRepositoryPatchFailureRows(workflow.failedApply),
        ),
        causalByCode: workflow.failureSummary.causalByCode,
        failureClassCounts: workflow.failureSummary.failureClassCounts,
        retryabilityCounts: workflow.failureSummary.retryabilityCounts,
    });
    if (workflow.postValidation.requestedCount > 0) {
        await runtime.audit.append({
            event: 'repo_apply_patch_batch_post_validation',
            tool: 'repo_apply_patch_batch',
            executionId: workflow.applyRun.execution.executionId,
            patchFullyApplied: workflow.patchFullyApplied,
            requestedCount: workflow.postValidation.requestedCount,
            ran: workflow.postValidation.ran,
            skipped: workflow.postValidation.skipped,
            skippedReason: workflow.postValidation.skippedReason ?? null,
            allPassed: workflow.postValidation.allPassed,
            failedCount: workflow.postValidation.failedCount,
            durationMs: workflow.postValidation.durationMs,
        });
    }
    const structured = {
        success: workflow.patchFullyApplied,
        workflowSuccess: workflow.patchFullyApplied && workflow.postValidation.allPassed !== false,
        partial: workflow.partial,
        dryRun: false,
        applyMode: workflow.effectiveApplyMode,
        failureMode: workflow.effectiveFailureMode,
        executionId: workflow.applyRun.execution.executionId,
        operationCount: operations.length,
        targetCount,
        inputBytes,
        appliedCount: workflow.succeeded.length,
        failedCount: workflow.failedApply.length,
        reportedFailureCount: outputFailures.length,
        ...(workflow.failedApply.length > 0 ? { failureSummary: workflow.failureSummary } : {}),
        skippedCount: workflow.skipped.length,
        concurrency: workflow.applyRun.execution.concurrency,
        maxInFlight: workflow.applyRun.execution.maxInFlight,
        durationMs: workflow.applyRun.execution.durationMs,
        workflowDurationMs: workflow.applyRun.execution.durationMs + workflow.postValidation.durationMs,
        requestedResultMode,
        resultMode,
        resultModeForcedByDiffPreview: forcedByDiffPreview,
        detailsAvailable: true,
        targetSummaries: summarizePatchBatchTargets(workflow.succeeded, false),
        preflightElided: workflow.preflightElided,
        preflightElisionReason: workflow.preflightElisionReason,
        preflightSummary: workflow.preflight
            ? {
                  ran: true,
                  success: true,
                  executionId: workflow.preflight.execution.executionId,
                  failedCount: 0,
                  durationMs: workflow.preflight.execution.durationMs,
              }
            : { ran: false, success: null, executionId: null, failedCount: 0, durationMs: 0 },
        preflight: presentation.includePreflightDetails ? (workflow.preflight?.operations ?? []) : [],
        postValidation: workflow.postValidation,
        applied: outputApplied,
        failures: outputFailures,
        skipped: workflow.skipped,
    };
    const patchText = structured.success
        ? `Applied ${workflow.succeeded.length} patch operation(s) across ${targetCount} target(s).`
        : `Patch batch completed partially: ${workflow.succeeded.length} applied, ${workflow.failureSummary.causalFailureCount} causal target failure(s) affecting ${workflow.failureSummary.failedOperationCount} operation(s), ${workflow.skipped.length} skipped.`;
    const validationText =
        workflow.postValidation.requestedCount === 0
            ? ''
            : workflow.postValidation.skipped
              ? ` Post-validation skipped (${workflow.postValidation.skippedReason}); patch results above are unchanged.`
              : workflow.postValidation.allPassed
                ? ` Post-validation passed ${workflow.postValidation.requestedCount}/${workflow.postValidation.requestedCount} requested validator(s) in the same call.`
                : ` Post-validation reported ${workflow.postValidation.failedCount} non-passing validator(s); patches remain applied and must not be retried blindly.`;
    const text = `${patchText}${validationText}`;
    const result = withResultSizeHint(okResult(structured, text), {
        bytes: estimateStructuredTextResultBytes(structured, text),
        strategy: 'conservative-estimate',
        source: 'repo_apply_patch_batch',
    });
    return withResultExecutionHint(result, {
        logicalOperations:
            operations.length + (workflow.postValidation.ran ? workflow.postValidation.requestedCount : 0),
        failedOperations:
            workflow.failureSummary.causalFailureCount +
            (workflow.postValidation.ran ? workflow.postValidation.failedCount : 0),
        skippedOperations:
            workflow.skipped.length +
            workflow.failureSummary.abortedOperationCount +
            (workflow.postValidation.skipped ? workflow.postValidation.requestedCount : 0),
        mode: `patch-apply:${workflow.effectiveApplyMode}:${workflow.effectiveFailureMode}${workflow.postValidation.ran ? ':post-validated' : ''}`,
    });
}

/**
 * Project the file-batch state machine into MCP result/audit semantics.
 *
 * @param {import('#copilot/mcp/public/workspace/repository/write').RepoWriteRuntime} runtime
 * @param {Awaited<ReturnType<typeof executeRepoFileBatchWorkflow>>} workflow
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} includePreflightDetails
 */
async function projectRepoFileBatchWorkflow(runtime, workflow, operations, includePreflightDetails) {
    const { mode: applyMode, reason: applyModeReason, conservativeOperationIndices } = workflow.applyModeDecision;
    if (workflow.kind === 'preflight-failed') {
        const result = errorResult(workflow.preflight.error ?? 'File-batch preflight failed.', {
            code: 'ERR_BATCH_FILE_OPERATION_FAILED',
            phase: 'preflight',
            partial: false,
            dryRun: workflow.dryRun,
            applyMode,
            applyModeReason,
            conservativeOperationIndices,
            operationCount: operations.length,
            planned: workflow.preflight.previews,
            plannedCount: workflow.preflight.previews.length,
            applied: [],
            appliedCount: 0,
            failedCount: 1,
            failureIndex: workflow.preflight.failureIndex,
            skippedCount: workflow.skippedCount,
            timings: { totalMs: workflow.totalMs, preflightMs: workflow.preflight.durationMs, applyMs: 0 },
            nextAction: 'No operation was applied; fix failureIndex and retry the batch.',
        });
        return withResultExecutionHint(result, {
            logicalOperations: operations.length,
            failedOperations: 1,
            skippedOperations: workflow.skippedCount,
            mode: 'file-batch:preflight-failure',
        });
    }
    if (workflow.kind === 'dry-run') {
        const previews = workflow.preflight.previews;
        await runtime.audit.append({
            event: 'repo_apply_file_batch_dry_run',
            tool: 'repo_apply_file_batch',
            operations: previews.map((preview) => preview['type']),
            operationCount: previews.length,
        });
        return withResultExecutionHint(
            okResult({
                success: true,
                dryRun: true,
                applyMode,
                applyModeReason,
                conservativeOperationIndices,
                operationCount: previews.length,
                durationMs: workflow.preflight.durationMs,
                operations: previews,
                applied: [],
            }),
            { logicalOperations: operations.length, mode: 'file-batch:dry-run' },
        );
    }
    if (workflow.kind === 'apply-failed') {
        const result = errorResult(workflow.error, {
            code: 'ERR_BATCH_FILE_OPERATION_FAILED',
            phase: 'apply',
            partial: workflow.partial,
            dryRun: false,
            applyMode,
            applyModeReason,
            conservativeOperationIndices,
            operationCount: operations.length,
            preflightSummary: workflow.preflightSummary,
            planned: includePreflightDetails ? (workflow.preflight?.previews ?? []) : [],
            applied: workflow.applied,
            appliedCount: workflow.applied.length,
            failedCount: 1,
            failureIndex: workflow.failureIndex,
            skippedCount: workflow.skippedCount,
            timings: {
                totalMs: workflow.totalMs,
                preflightMs: workflow.preflightSummary.durationMs,
                applyMs: workflow.applyMs,
            },
            nextAction: workflow.partial
                ? 'Do not repeat already-applied operations; inspect failureIndex and retry only the failed/skipped suffix after reconciling current state.'
                : 'No operation was applied; fix failureIndex and retry the batch.',
        });
        return withResultExecutionHint(result, {
            logicalOperations: operations.length,
            failedOperations: 1,
            skippedOperations: workflow.skippedCount,
            mode: `file-batch:${applyMode}:apply-failure`,
        });
    }
    await runtime.audit.append({
        event: 'repo_apply_file_batch_applied',
        tool: 'repo_apply_file_batch',
        applyMode,
        applyModeReason,
        operations: workflow.applied.map((operation) => operation['type']),
        operationCount: workflow.applied.length,
    });
    return withResultExecutionHint(
        okResult({
            success: true,
            dryRun: false,
            applyMode,
            applyModeReason,
            conservativeOperationIndices,
            operationCount: workflow.applied.length,
            preflightSummary: workflow.preflightSummary,
            planned: includePreflightDetails ? (workflow.preflight?.previews ?? []) : [],
            applied: workflow.applied,
            appliedCount: workflow.applied.length,
            failedCount: 0,
            skippedCount: 0,
            timings: {
                totalMs: workflow.totalMs,
                preflightMs: workflow.preflightSummary.durationMs,
                applyMs: workflow.applyMs,
            },
        }),
        { logicalOperations: operations.length, mode: `file-batch:${applyMode}:apply` },
    );
}

/**
 * Build one repo-write tool set with instance-local fault-injection dependencies. Production uses the canonical
 * defaults; tests can create an isolated tool set without mutating process-global state observed by other requests.
 *
 * @param {{ quarantineMetadataWriter?: RepoWriteQuarantineMetadataInterceptor; quarantineDir?: string }} [options]
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export function createRepoWriteTools(options = {}) {
    const quarantineMetadataInterceptor = options.quarantineMetadataWriter;
    /** @type {RepoWriteQuarantineMetadataWriter} */
    const quarantineMetadataWriter = quarantineMetadataInterceptor
        ? (io, metadata, metadataPath, signal) =>
              quarantineMetadataInterceptor(
                  io,
                  metadata,
                  metadataPath,
                  (defaultIo, defaultMetadata, defaultMetadataPath) =>
                      writeQuarantineMetadataDefault(defaultIo, defaultMetadata, defaultMetadataPath, signal),
              )
        : writeQuarantineMetadataDefault;
    const createRuntime = (
        /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} */ operationContext,
    ) =>
        createRepoWriteRuntime(
            requireMcpToolWorkspace(operationContext),
            requireMcpToolAuditCapability(operationContext),
            quarantineMetadataWriter,
            operationContext?.signal,
            options.quarantineDir ? { quarantineDir: options.quarantineDir } : {},
        );

    return [
        defineMcpRawTool({
            name: 'repo_patch_batch_plan',
            title: 'Plan repository patch batch',
            description:
                'Plan a bounded batch of exact-string repository patches without modifying files. Repeated paths are evaluated sequentially against one virtual file state.',
            inputSchema: {
                operations: z
                    .array(patchBatchOperationSchema)
                    .min(1)
                    .max(MAX_PATCH_BATCH_OPERATIONS)
                    ['describe'](
                        'Patch operations to validate in order. This tool never writes; max 128 operations / 64 targets.',
                    ),
                targetConcurrency: z
                    .number()
                    .int()
                    .min(1)
                    .max(MAX_PATCH_TARGET_CONCURRENCY)
                    .optional()
                    ['describe'](
                        'Parallel target groups during planning. Default: 4; same-file operations remain sequential.',
                    ),
            },

            handler: async ({ operations, targetConcurrency }, operationContext) => {
                const runtime = createRuntime(operationContext);
                const normalizedOperations = /** @type {Record<string, unknown>[]} */ (operations);
                const envelope = inspectPatchBatchEnvelope(normalizedOperations);
                if (!envelope.ok) {
                    return errorResult('Patch batch exceeds its bounded execution envelope.', {
                        code: envelope.code,
                        operationCount: normalizedOperations.length,
                        targetCount: envelope.targetCount,
                        inputBytes: envelope.inputBytes,
                        limits: {
                            operations: MAX_PATCH_BATCH_OPERATIONS,
                            targets: MAX_PATCH_BATCH_TARGETS,
                            inputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
                        },
                    });
                }
                const run = await runRepoWritePatchTargetGroups(runtime, normalizedOperations, true, {
                    failureMode: 'best-effort',
                    concurrency: targetConcurrency ?? DEFAULT_PATCH_PLAN_CONCURRENCY,
                });
                const planned = run.operations;
                const failed = planned.filter((operation) => operation['success'] !== true);
                const failureSummary = summarizeRepositoryPatchFailures(failed);
                await runtime.audit.append({
                    event: 'repo_patch_batch_plan',
                    tool: 'repo_patch_batch_plan',
                    operationCount: planned.length,
                    targetCount: envelope.targetCount,
                    failedCount: failed.length,
                    executionId: run.execution.executionId,
                });
                const structured = {
                    success: failed.length === 0,
                    plannedTool: 'repo_apply_patch_batch',
                    dryRun: true,
                    executionId: run.execution.executionId,
                    operationCount: planned.length,
                    targetCount: envelope.targetCount,
                    inputBytes: envelope.inputBytes,
                    failedCount: failed.length,
                    concurrency: run.execution.concurrency,
                    maxInFlight: run.execution.maxInFlight,
                    durationMs: run.execution.durationMs,
                    operations: planned,
                    nextCall:
                        failed.length === 0
                            ? {
                                  tool: 'repo_apply_patch_batch',
                                  args: {
                                      operations,
                                      dryRun: false,
                                      confirmBatch: true,
                                      applyMode: 'per-target-fast',
                                      failureMode: 'best-effort',
                                  },
                              }
                            : null,
                };
                const text =
                    failed.length === 0
                        ? `Planned ${planned.length} patch operation(s) across ${envelope.targetCount} target(s); no files modified.`
                        : `Planned ${planned.length} patch operation(s) with ${failed.length} failure(s); no files modified.`;
                const result = withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_patch_batch_plan',
                });
                return withResultExecutionHint(result, {
                    logicalOperations: normalizedOperations.length,
                    failedOperations: failureSummary.causalFailureCount,
                    skippedOperations: failureSummary.abortedOperationCount,
                    mode: 'patch-plan:best-effort',
                });
            },
        }),
        defineMcpRawTool({
            name: 'repo_apply_patch_batch',
            title: 'Apply repository patch batch',
            description:
                'Dry-run or apply a bounded exact-string patch batch. Real writes require confirmBatch=true; repeated paths are sequential and atomic per file. Direct apply defaults to independent per-target atomic progress without a duplicate global preview; global-preflight remains opt-in when all-target preview gating is desired.',
            inputSchema: {
                operations: z
                    .array(patchBatchOperationSchema)
                    .min(1)
                    .max(MAX_PATCH_BATCH_OPERATIONS)
                    ['describe'](
                        'Patch operations to validate or apply; max 128 operations / 64 targets / 3 MiB input.',
                    ),
                dryRun: z.boolean().optional()['describe']('Validate all operations without writing. Default: true.'),
                confirmBatch: z
                    .boolean()
                    .optional()
                    ['describe']('Must be true when dryRun=false because this applies multiple patches.'),
                applyMode: z
                    .enum(['global-preflight', 'per-target-fast'])
                    .optional()
                    ['describe'](
                        'Apply policy. Default per-target-fast applies independent target groups directly with atomic compute-before-write per file. global-preflight is opt-in and blocks all writes when any preview target already fails.',
                    ),
                failureMode: z
                    .enum(['best-effort', 'fail-fast'])
                    .optional()
                    ['describe'](
                        'Target failure policy during apply. Defaults best-effort for the default per-target-fast mode; global-preflight defaults fail-fast after its preview gate.',
                    ),
                targetConcurrency: z
                    .number()
                    .int()
                    .min(1)
                    .max(MAX_PATCH_TARGET_CONCURRENCY)
                    .optional()
                    ['describe'](
                        'Parallel independent targets. Defaults 4 in per-target-fast; global-preflight apply uses 1 unless explicitly raised.',
                    ),
                resultMode: z
                    .enum(['compact', 'detailed'])
                    .optional()
                    ['describe'](
                        'Successful operation result detail. Default compact; detailed preserves full per-operation hashes/line/byte metadata. includeDiffPreview forces detailed.',
                    ),
                includePreflightDetails: z
                    .boolean()
                    .optional()
                    ['describe'](
                        'Echo full successful preflight rows in real apply output. Default false to avoid payload duplication.',
                    ),
                postValidate: z
                    .array(postPatchValidationRequestSchema)
                    .min(1)
                    .max(MAX_POST_PATCH_VALIDATORS)
                    .optional()
                    ['describe'](
                        'Optional allowlisted post-write validators executed in this same tool call; max 4. Dry-run only validates this plan and never starts jobs.',
                    ),
                postValidateOnPartial: z
                    .boolean()
                    .optional()
                    ['describe'](
                        'Run postValidate even after partial patch application. Default false; otherwise validation is skipped on partial apply.',
                    ),
                durability: durabilitySchema,
            },

            handler: async (
                {
                    operations,
                    dryRun,
                    confirmBatch,
                    applyMode,
                    failureMode,
                    targetConcurrency,
                    resultMode,
                    includePreflightDetails,
                    postValidate,
                    postValidateOnPartial,
                    durability,
                },
                operationContext,
            ) => {
                const runtime = createRuntime(operationContext);
                const isDryRun = resolveBatchDryRun(dryRun, confirmBatch);
                let postValidationRequests;
                try {
                    postValidationRequests = normalizePostPatchValidationRequests(postValidate ?? []);
                } catch (error) {
                    return errorResult('Invalid postValidate configuration; no files were modified.', {
                        code: 'ERR_POST_PATCH_VALIDATION_CONFIG',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                const validationConfig =
                    postValidationRequests.length > 0 ? requireMcpToolValidationConfig(operationContext) : null;
                if (
                    postValidationRequests.length > 0 &&
                    validationConfig &&
                    !canRunCopilotValidatorInline(validationConfig)
                ) {
                    return errorResult('postValidate is disabled inside test runners; no files were modified.', {
                        code: 'ERR_POST_PATCH_VALIDATION_RECURSION_GUARD',
                        requestedCount: postValidationRequests.length,
                    });
                }
                const normalizedOperations = /** @type {Record<string, unknown>[]} */ (
                    operations.map((/** @type {Record<string, unknown>} */ operation) => ({
                        ...operation,
                        ...(durability ? { durability } : {}),
                    }))
                );
                const resultSurface = resolvePatchBatchResultMode({ resultMode }, normalizedOperations);
                const envelope = inspectPatchBatchEnvelope(normalizedOperations);
                if (!envelope.ok) {
                    return errorResult('Patch batch exceeds its bounded execution envelope.', {
                        code: envelope.code,
                        operationCount: normalizedOperations.length,
                        targetCount: envelope.targetCount,
                        inputBytes: envelope.inputBytes,
                        limits: {
                            operations: MAX_PATCH_BATCH_OPERATIONS,
                            targets: MAX_PATCH_BATCH_TARGETS,
                            inputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
                        },
                    });
                }
                const effectiveApplyMode = applyMode ?? 'per-target-fast';
                if (!isDryRun && confirmBatch !== true) {
                    return errorResult('confirmBatch must be true when dryRun=false.', {
                        code: 'ERR_PATCH_BATCH_CONFIRM_REQUIRED',
                        operationCount: normalizedOperations.length,
                        applyMode: effectiveApplyMode,
                    });
                }
                const workflow = await executeRepoPatchBatchWorkflow(runtime, normalizedOperations, isDryRun, {
                    targetCount: envelope.targetCount,
                    defaultPlanConcurrency: DEFAULT_PATCH_PLAN_CONCURRENCY,
                    defaultFastConcurrency: DEFAULT_PATCH_FAST_CONCURRENCY,
                    postValidationRequests,
                    validationConfig,
                    ...(applyMode === undefined ? {} : { applyMode }),
                    ...(failureMode === undefined ? {} : { failureMode }),
                    ...(targetConcurrency === undefined ? {} : { targetConcurrency }),
                    ...(postValidateOnPartial === undefined ? {} : { postValidateOnPartial }),
                });
                return projectRepoPatchBatchWorkflow(runtime, workflow, {
                    operations: normalizedOperations,
                    targetCount: envelope.targetCount,
                    inputBytes: envelope.inputBytes,
                    requestedResultMode: resultSurface.requestedResultMode,
                    resultMode: resultSurface.resultMode,
                    forcedByDiffPreview: resultSurface.forcedByDiffPreview,
                    includePreflightDetails: includePreflightDetails === true,
                });
            },
        }),
        defineMcpRawTool({
            name: 'repo_apply_file_batch_plan',
            title: 'Plan repository file batch',
            description:
                'Read-only plan for a bounded batch of workspace file operations. Does not modify files; use before repo_apply_file_batch to reduce high-risk prompts.',
            inputSchema: {
                operations: z
                    .array(batchOperationSchema)
                    .min(1)
                    .max(MAX_BATCH_FILE_OPERATIONS)
                    ['describe']('Ordered file operations to validate and preview.'),
            },

            handler: async ({ operations }, operationContext) => {
                const runtime = createRuntime(operationContext);
                const preflight = await runFileBatchPreflight(runtime, operations);
                if (!preflight.success) {
                    return errorResult(preflight.error ?? 'File-batch preflight failed.', {
                        code: 'ERR_BATCH_FILE_PLAN_FAILED',
                        operationCount: operations.length,
                        planned: preflight.previews,
                        plannedCount: preflight.previews.length,
                        failureIndex: preflight.failureIndex,
                        durationMs: preflight.durationMs,
                    });
                }
                const previews = preflight.previews;
                await runtime.audit.append({
                    event: 'repo_apply_file_batch_plan',
                    tool: 'repo_apply_file_batch_plan',
                    operations: previews.map((preview) => preview['type']),
                    operationCount: previews.length,
                });
                return okResult({
                    success: true,
                    plannedTool: 'repo_apply_file_batch',
                    dryRun: true,
                    operationCount: previews.length,
                    durationMs: preflight.durationMs,
                    operations: previews,
                    applied: [],
                    nextCall: {
                        tool: 'repo_apply_file_batch',
                        args: {
                            operations,
                            confirmBatch: true,
                        },
                    },
                });
            },
        }),
        defineMcpRawTool({
            name: 'repo_apply_file_batch',
            title: 'Apply repository file batch',
            description:
                'Apply a bounded ordered batch of workspace file operations in one tool call. Supports create, move, quarantine, metadata-only executable-bit repair and explicit removal. Safe non-destructive sequences default to direct sequential apply; remove_file and overwrite moves retain a conservative whole-batch preflight unless applyMode is explicitly chosen.',
            inputSchema: {
                operations: z
                    .array(batchOperationSchema)
                    .min(1)
                    .max(MAX_BATCH_FILE_OPERATIONS)
                    ['describe']('Ordered file operations. Later operations can depend on earlier ones.'),
                dryRun: z
                    .boolean()
                    .optional()
                    ['describe']('Validate and preview all operations without writing. Default: true.'),
                confirmBatch: z
                    .boolean()
                    .optional()
                    ['describe'](
                        'Must be true when applying file operations; confirmBatch=true also survives adapters that omit dryRun=false.',
                    ),
                applyMode: z
                    .enum(['global-preflight', 'sequential-fast'])
                    .optional()
                    ['describe'](
                        'Adaptive default: sequential-fast for create/move-without-overwrite/quarantine sequences; global-preflight when remove_file or overwrite move is present. Explicit value overrides the adaptive choice.',
                    ),
                includePreflightDetails: z
                    .boolean()
                    .optional()
                    ['describe']('Include full successful preflight rows in a real apply response. Default: false.'),
            },

            handler: async (
                { operations, dryRun, confirmBatch, applyMode, includePreflightDetails },
                operationContext,
            ) => {
                const runtime = createRuntime(operationContext);
                const isDryRun = resolveBatchDryRun(dryRun, confirmBatch);
                const normalizedOperations = /** @type {Record<string, unknown>[]} */ (operations);
                const applyModeDecision = resolveFileBatchApplyMode(normalizedOperations, applyMode);
                if (!isDryRun && confirmBatch !== true) {
                    return errorResult('confirmBatch deve ser true quando aplicando operações de arquivo.', {
                        code: 'ERR_BATCH_CONFIRM_REQUIRED',
                        applyMode: applyModeDecision.mode,
                        applyModeReason: applyModeDecision.reason,
                    });
                }
                const workflow = await executeRepoFileBatchWorkflow(runtime, normalizedOperations, {
                    dryRun: isDryRun,
                    ...(applyMode === undefined ? {} : { applyMode }),
                });
                return projectRepoFileBatchWorkflow(
                    runtime,
                    workflow,
                    normalizedOperations,
                    includePreflightDetails === true,
                );
            },
        }),
        defineMcpRawTool({
            name: 'repo_write_file',
            title: 'Write repository file',
            description:
                'Replace the full content of an existing UTF-8 workspace file. Returns hashes and a unified diff preview.',
            inputSchema: {
                path: z.string().min(1)['describe']('Workspace-relative existing file path.'),
                content: z.string()['describe']('Full replacement content.'),
                expectedHash: z.string().optional()['describe']('Expected SHA-256 of current file content.'),
                dryRun: z.boolean().optional()['describe']('Return diff and hashes without writing. Default: false.'),
                diffContextLines: z
                    .number()
                    .int()
                    .min(0)
                    .max(20)
                    .optional()
                    ['describe']('Context lines in diff preview.'),
                maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
                includeDiffPreview: z
                    .boolean()
                    .optional()
                    ['describe']('Include textual diffPreview in the tool result. Default: false.'),
                durability: durabilitySchema,
            },

            handler: async (
                { path, content, expectedHash, dryRun, diffContextLines, maxDiffLines, includeDiffPreview, durability },
                operationContext,
            ) => {
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryWriteFile(runtime, {
                    path,
                    content,
                    ...(expectedHash === undefined ? {} : { expectedHash }),
                    ...(dryRun === undefined ? {} : { dryRun }),
                    ...(diffContextLines === undefined ? {} : { diffContextLines }),
                    ...(maxDiffLines === undefined ? {} : { maxDiffLines }),
                    ...(durability === undefined ? {} : { durability }),
                });
                return projectRepoWriteOutcome(runtime, outcome, includeDiffPreview === true);
            },
        }),
        defineMcpRawTool({
            name: 'repo_create_file',
            title: 'Create repository file',
            description:
                'Create a new UTF-8 workspace file. It fails if the file already exists and returns a creation diff preview.',
            inputSchema: {
                path: z.string().min(1)['describe']('Workspace-relative file path to create.'),
                content: z.string().optional()['describe']('Initial UTF-8 content. Default: empty string.'),
                createParentDirs: z.boolean().optional()['describe']('Create parent directories. Default: true.'),
                dryRun: z.boolean().optional()['describe']('Validate and return diff without writing. Default: false.'),
                maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
                includeDiffPreview: z
                    .boolean()
                    .optional()
                    ['describe']('Include textual diffPreview in the tool result. Default: false.'),
                durability: durabilitySchema,
            },

            handler: async (
                { path, content, createParentDirs, dryRun, maxDiffLines, includeDiffPreview, durability },
                operationContext,
            ) => {
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryCreateFile(runtime, {
                    path,
                    ...(content === undefined ? {} : { content }),
                    ...(createParentDirs === undefined ? {} : { createParentDirs }),
                    ...(dryRun === undefined ? {} : { dryRun }),
                    ...(maxDiffLines === undefined ? {} : { maxDiffLines }),
                    ...(durability === undefined ? {} : { durability }),
                });
                return projectRepoWriteOutcome(runtime, outcome, includeDiffPreview === true);
            },
        }),
        defineMcpRawTool({
            name: 'repo_apply_patch',
            title: 'Apply repository patch',
            description:
                'Apply a controlled exact-string patch to one workspace file. Returns hashes, line/byte deltas and a unified diff preview.',
            inputSchema: {
                path: z.string().min(1)['describe']('Workspace-relative file path.'),
                old_string: z.string().min(1)['describe']('Exact text to replace. It must match once by default.'),
                new_string: z.string()['describe']('Replacement text. Use an empty string to delete matched text.'),
                replace_all: z
                    .boolean()
                    .optional()
                    ['describe']('Replace every occurrence of old_string. Default: false.'),
                expected_occurrences: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    ['describe']('Require an exact occurrence count before applying.'),
                occurrence_index: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    ['describe']('1-based occurrence index to replace when old_string appears more than once.'),
                expectedHash: z.string().optional()['describe']('Expected SHA-256 of current file content.'),
                dryRun: z.boolean().optional()['describe']('Validate and return diff without writing. Default: false.'),
                allowNoop: z
                    .boolean()
                    .optional()
                    ['describe']('Allow old_string and new_string to be identical. Default: false.'),
                diffContextLines: z
                    .number()
                    .int()
                    .min(0)
                    .max(20)
                    .optional()
                    ['describe']('Context lines in diff preview.'),
                maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
                includeDiffPreview: z
                    .boolean()
                    .optional()
                    ['describe']('Include textual diffPreview in the tool result. Default: false.'),
                durability: durabilitySchema,
            },

            handler: async (
                {
                    path,
                    old_string,
                    new_string,
                    replace_all,
                    expected_occurrences,
                    occurrence_index,
                    expectedHash,
                    dryRun,
                    allowNoop,
                    diffContextLines,
                    maxDiffLines,
                    includeDiffPreview,
                    durability,
                },
                operationContext,
            ) => {
                if (replace_all === true && occurrence_index !== undefined) {
                    return errorResult('Use replace_all ou occurrence_index, nao ambos na mesma chamada.', {
                        code: 'ERR_PATCH_CONFLICTING_MODE',
                    });
                }
                const runtime = createRuntime(operationContext);
                const operation = {
                    path,
                    old_string,
                    new_string,
                    __toolName: 'repo_apply_patch',
                    ...(replace_all === undefined ? {} : { replace_all }),
                    ...(expected_occurrences === undefined ? {} : { expected_occurrences }),
                    ...(occurrence_index === undefined ? {} : { occurrence_index }),
                    ...(expectedHash === undefined ? {} : { expectedHash }),
                    ...(allowNoop === undefined ? {} : { allowNoop }),
                    ...(diffContextLines === undefined ? {} : { diffContextLines }),
                    ...(maxDiffLines === undefined ? {} : { maxDiffLines }),
                    ...(includeDiffPreview === undefined ? {} : { includeDiffPreview }),
                    ...(durability === undefined ? {} : { durability }),
                };
                const run = await runRepoWritePatchTargetGroups(runtime, [operation], dryRun === true, {
                    failureMode: 'best-effort',
                    concurrency: 1,
                    maxTargets: 1,
                });
                const row = run.operations[0];
                if (!row || row['success'] !== true) {
                    const failure = row ?? {
                        path,
                        code: 'ERR_PATCH_UNKNOWN',
                        error: 'Patch execution returned no result row.',
                        failureClass: 'unknown',
                        retryability: 'unknown',
                        mutationState: 'not-applied',
                        recoveryRequired: false,
                        convergenceCandidate: false,
                    };
                    await runtime.audit.append({
                        event: 'repo_apply_patch_failed',
                        tool: 'repo_apply_patch',
                        path: failure['path'] ?? path,
                        code: typeof failure['code'] === 'string' ? failure['code'] : 'ERR_PATCH_UNKNOWN',
                        failureClass: failure['failureClass'] ?? 'unknown',
                        retryability: failure['retryability'] ?? 'unknown',
                        mutationState: failure['mutationState'] ?? 'not-applied',
                        recoveryRequired: failure['recoveryRequired'] === true,
                        convergenceCandidate: failure['convergenceCandidate'] === true,
                        inlineNextActionProvided: typeof failure['nextAction'] === 'string',
                        inlineRecoveryAnchorProvided: hasPatchRecoveryAnchor(failure['details']),
                    });
                    return errorResult(String(failure['error'] ?? 'Patch failed.'), {
                        path: failure['path'] ?? path,
                        code: failure['code'],
                        failureClass: failure['failureClass'],
                        retryability: failure['retryability'],
                        mutationState: failure['mutationState'],
                        recoveryRequired: failure['recoveryRequired'],
                        convergenceCandidate: failure['convergenceCandidate'],
                        ...(failure['details'] && typeof failure['details'] === 'object'
                            ? { details: failure['details'] }
                            : {}),
                        ...(failure['nextAction'] ? { nextAction: failure['nextAction'] } : {}),
                    });
                }
                const contentHash = row['contentHash'] ?? row['projectedHash'];
                const io = row['io'] && typeof row['io'] === 'object' ? row['io'] : {};
                await runtime.audit.append({
                    event: row['dryRun'] === true ? 'repo_patch_dry_run' : 'repo_patch_applied',
                    tool: 'repo_apply_patch',
                    path: row['path'],
                    occurrences: row['occurrences'],
                    replacedOccurrences: row['replacedOccurrences'],
                    previousHash: row['previousHash'],
                    contentHash,
                    traceId: /** @type {Record<string, unknown>} */ (io)['traceId'] ?? row['traceId'] ?? null,
                });
                const structured = {
                    success: true,
                    workflowSuccess: true,
                    mutationState: row['noop'] === true ? 'already-converged' : 'fully-applied',
                    path: row['path'],
                    dryRun: row['dryRun'] === true,
                    occurrences: row['occurrences'],
                    replacedOccurrences: row['replacedOccurrences'],
                    previousBytes: row['previousBytes'],
                    projectedBytes: row['projectedBytes'],
                    bytesWritten: Number(row['bytesWritten'] ?? 0),
                    byteDelta: row['byteDelta'],
                    firstMatchLine: row['firstMatchLine'],
                    lastMatchLine: row['lastMatchLine'],
                    lineDelta: row['lineDelta'],
                    occurrenceIndex: row['occurrenceIndex'],
                    noop: row['noop'] === true,
                    previousHash: row['previousHash'],
                    contentHash,
                    ...(includeDiffPreview === true
                        ? {
                              diffPreview: row['diffPreview'],
                              diffPreviewTruncated: row['diffPreviewTruncated'],
                              diffPreviewLines: row['diffPreviewLines'],
                              diffPreviewBytes: row['diffPreviewBytes'],
                              diffContextLines: row['diffContextLines'],
                          }
                        : {
                              diffPreviewSuppressed: true,
                              diffPreviewAvailable: row['diffPreviewAvailable'] === true,
                              diffPreviewLines: row['diffPreviewLines'],
                              diffPreviewBytes: row['diffPreviewBytes'],
                              diffContextLines: row['diffContextLines'],
                          }),
                    io,
                };
                const text =
                    includeDiffPreview === true
                        ? String(row['diffPreview'] ?? '')
                        : `Patch ${row['dryRun'] === true ? 'planned' : 'applied'}: ${row['replacedOccurrences']} replacement(s), diff preview suppressed.`;
                return withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_apply_patch',
                });
            },
        }),
        defineMcpRawTool({
            name: 'repo_move_file',
            title: 'Move repository file',
            description:
                'Move or rename one workspace file. Destination overwrite is disabled unless overwrite and confirmOverwrite are both true.',
            inputSchema: {
                source: z.string().min(1)['describe']('Workspace-relative existing source file.'),
                destination: z.string().min(1)['describe']('Workspace-relative destination path.'),
                overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
                confirmOverwrite: z
                    .boolean()
                    .optional()
                    ['describe']('Must be true when overwrite is true because destination replacement is destructive.'),
                dryRun: z.boolean().optional()['describe']('Validate without moving. Default: false.'),
            },

            handler: async ({ source, destination, overwrite, confirmOverwrite, dryRun }, operationContext) => {
                if (overwrite === true && confirmOverwrite !== true) {
                    return errorResult('confirmOverwrite deve ser true quando overwrite=true.', {
                        code: 'ERR_MOVE_CONFIRM_OVERWRITE_REQUIRED',
                    });
                }
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryMoveFile(runtime, {
                    source,
                    destination,
                    ...(overwrite === undefined ? {} : { overwrite }),
                    ...(dryRun === undefined ? {} : { dryRun }),
                });
                return projectRepoWriteOutcome(runtime, outcome);
            },
        }),
        defineMcpRawTool({
            name: 'repo_list_quarantine',
            title: 'List quarantined repository files',
            description:
                'List files currently known to the MCP quarantine area, including restored and restorable items.',
            inputSchema: {
                status: z
                    .enum(['quarantined', 'restored', 'all'])
                    .optional()
                    ['describe']('Filter by status. Default: all.'),
                limit: z.number().int().min(1).max(200).optional()['describe']('Maximum items returned. Default: 50.'),
            },

            handler: async ({ status, limit }, operationContext) => {
                const runtime = createRuntime(operationContext);
                const filter = status === 'quarantined' || status === 'restored' ? status : 'all';
                const max = Math.max(1, Math.min(200, Number(limit ?? 50)));
                return okResult(await listRepositoryQuarantine(runtime, filter, max));
            },
        }),
        defineMcpRawTool({
            name: 'repo_inspect_quarantined_file',
            title: 'Inspect quarantined repository file',
            description:
                'Inspect metadata and current stored-object state for one item created by repo_quarantine_file.',
            inputSchema: {
                quarantineId: quarantineIdSchema.describe('quarantineId returned by repo_quarantine_file.'),
                includeHash: z
                    .boolean()
                    .optional()
                    ['describe']('Compute SHA-256 for stored data if present. Default: true.'),
            },

            handler: async ({ quarantineId, includeHash }, operationContext) => {
                const runtime = createRuntime(operationContext);
                const outcome = await inspectRepositoryQuarantinedFile(
                    runtime,
                    String(quarantineId),
                    includeHash !== false,
                );
                return projectRepoWriteOutcome(runtime, outcome);
            },
        }),
        defineMcpRawTool({
            name: 'repo_quarantine_file',
            title: 'Quarantine repository file',
            description:
                'Move one workspace file to a reversible MCP quarantine area instead of deleting it. Returns a quarantineId for restore.',
            inputSchema: {
                path: z.string().min(1)['describe']('Workspace-relative file path to quarantine.'),
                dryRun: z.boolean().optional()['describe']('Validate without moving. Default: false.'),
            },

            handler: async ({ path, dryRun }, operationContext) => {
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryQuarantineFile(runtime, {
                    path,
                    ...(dryRun === undefined ? {} : { dryRun }),
                });
                return projectRepoWriteOutcome(runtime, outcome);
            },
        }),
        defineMcpRawTool({
            name: 'repo_restore_quarantined_file',
            title: 'Restore quarantined repository file',
            description:
                'Restore a file previously moved by repo_quarantine_file. Destination defaults to the original path and overwrite requires explicit confirmation.',
            inputSchema: {
                quarantineId: quarantineIdSchema.describe('quarantineId returned by repo_quarantine_file.'),
                destinationPath: z.string().optional()['describe']('Optional workspace-relative restore path.'),
                overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
                confirmOverwrite: z
                    .boolean()
                    .optional()
                    ['describe']('Must be true when overwrite is true because destination replacement is destructive.'),
                dryRun: z.boolean().optional()['describe']('Validate without restoring. Default: false.'),
            },

            handler: async (
                { quarantineId, destinationPath, overwrite, confirmOverwrite, dryRun },
                operationContext,
            ) => {
                if (overwrite === true && confirmOverwrite !== true) {
                    return errorResult('confirmOverwrite deve ser true quando overwrite=true.', {
                        code: 'ERR_RESTORE_CONFIRM_OVERWRITE_REQUIRED',
                    });
                }
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryRestoreQuarantinedFile(runtime, {
                    quarantineId: String(quarantineId),
                    ...(destinationPath === undefined ? {} : { destinationPath }),
                    ...(overwrite === undefined ? {} : { overwrite }),
                    ...(dryRun === undefined ? {} : { dryRun }),
                });
                return projectRepoWriteOutcome(runtime, outcome);
            },
        }),
        defineMcpRawTool({
            name: 'repo_remove_file',
            title: 'Remove repository file',
            description:
                'Delete one workspace file. Requires confirm=true and always returns prior hash/size; rollback snapshot metadata is available only when automatic I/O rollback is explicitly enabled.',
            inputSchema: {
                path: z.string().min(1)['describe']('Workspace-relative file path to delete.'),
                confirm: z.boolean().optional()['describe']('Must be true to delete.'),
                dryRun: z.boolean().optional()['describe']('Validate without deleting. Default: false.'),
            },

            handler: async ({ path, confirm, dryRun }, operationContext) => {
                if (confirm !== true) {
                    return errorResult('confirm deve ser true para remover arquivo.', {
                        code: 'ERR_REMOVE_CONFIRM_REQUIRED',
                    });
                }
                const runtime = createRuntime(operationContext);
                const outcome = await executeRepositoryRemoveFile(runtime, {
                    path,
                    ...(dryRun === undefined ? {} : { dryRun }),
                });
                return projectRepoWriteOutcome(runtime, outcome);
            },
        }),
    ];
}

export const repoWriteTools = createRepoWriteTools();
