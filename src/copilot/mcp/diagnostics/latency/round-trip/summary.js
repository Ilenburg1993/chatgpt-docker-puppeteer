// @ts-check
/** Causal sequence/recovery/workflow summary over normalized round-trip event rows. */

import { MCP_ROUND_TRIP_NORMALIZER_VERSION } from './normalizer.js';

const RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_INTERACTIVE_TRANSITION_GAP_MS = 5 * 60 * 1000;
const INSPECTION_TOOLS = Object.freeze([
    'repo_read_file',
    'repo_read_file_chunks',
    'repo_search_text',
    'repo_file_stats',
    'repo_bulk_inspect',
    'repo_working_set',
]);
const PATCH_TOOLS = Object.freeze(['repo_apply_patch', 'repo_apply_patch_batch']);
/** @type {Readonly<Record<string, string>>} */
const PLAN_APPLY_PAIRS = Object.freeze({
    repo_patch_plan: 'repo_apply_patch',
    repo_patch_batch_plan: 'repo_apply_patch_batch',
    repo_apply_file_batch_plan: 'repo_apply_file_batch',
    git_stage_plan: 'git_stage',
    git_commit_plan: 'git_commit',
    git_push_plan: 'git_push',
});

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ windowMs: number; top: number; includeSynthetic: boolean }} options
 */
export function summarizeMcpRoundTripRows(rows, options) {
    const transitions = new Map();
    const failureCodes = new Map();
    const failureClasses = new Map();
    const retryability = new Map();
    let causalFailureCount = 0;
    let recoveryRequiredTargetCount = 0;
    let inlineNextActionTargetCount = 0;
    let inlineRecoveryAnchorTargetCount = 0;
    const toolStarts = new Map();
    let lastCompleted = null;
    let pendingFailure = null;
    let recoveryTraceCount = 0;
    let recoveryWithInspectionCount = 0;
    let recoveryRoundTrips = 0;
    let recoveryGapMs = 0;
    let planThenApplyCount = 0;
    const planThenApplyByPair = new Map();
    let validatorPollCount = 0;
    let patchThenValidatorTransitions = 0;
    let compositePostValidationCount = 0;
    let gitGranularCalls = 0;
    const gitGranularByTool = new Map();
    let gitOneShotCalls = 0;
    let discontinuityCount = 0;
    let discontinuityTotalMs = 0;
    let discontinuityMaxMs = 0;

    for (const row of rows) {
        const event = String(row['event'] ?? '');
        const tool = stringOrNull(row['tool']);
        const tsMs = Number(row['ts_ms'] ?? row['tsMs'] ?? 0);
        if (
            event === 'repo_apply_patch_failed' ||
            event === 'repo_apply_patch_batch_preflight_blocked' ||
            event === 'repo_apply_patch_batch_partial_failure'
        ) {
            const causalCodeCounts = parseCountMap(row['causal_by_code_json'] ?? row['causalByCodeJson']);
            const failureClassMap = parseCountMap(row['failure_class_counts_json'] ?? row['failureClassCountsJson']);
            const retryabilityMap = parseCountMap(row['retryability_counts_json'] ?? row['retryabilityCountsJson']);
            if (causalCodeCounts.size > 0) mergeCountMap(failureCodes, causalCodeCounts);
            else increment(failureCodes, stringOrNull(row['code']) ?? 'aggregate-or-legacy');
            if (failureClassMap.size > 0) mergeCountMap(failureClasses, failureClassMap);
            else
                increment(
                    failureClasses,
                    stringOrNull(row['failure_class'] ?? row['failureClass']) ?? 'unknown-or-legacy',
                );
            if (retryabilityMap.size > 0) mergeCountMap(retryability, retryabilityMap);
            else increment(retryability, stringOrNull(row['retryability']) ?? 'unknown-or-legacy');

            causalFailureCount +=
                nonNegativeIntegerOrNull(row['causal_failure_count'] ?? row['causalFailureCount']) ?? 1;
            recoveryRequiredTargetCount +=
                nonNegativeIntegerOrNull(row['recovery_required_target_count'] ?? row['recoveryRequiredTargetCount']) ??
                (Number(row['recovery_required'] ?? row['recoveryRequired']) === 1 ? 1 : 0);
            inlineNextActionTargetCount +=
                nonNegativeIntegerOrNull(
                    row['inline_next_action_target_count'] ?? row['inlineNextActionTargetCount'],
                ) ?? (Number(row['inline_next_action_provided'] ?? row['inlineNextActionProvided']) === 1 ? 1 : 0);
            inlineRecoveryAnchorTargetCount +=
                nonNegativeIntegerOrNull(
                    row['inline_recovery_anchor_target_count'] ?? row['inlineRecoveryAnchorTargetCount'],
                ) ??
                (Number(row['inline_recovery_anchor_provided'] ?? row['inlineRecoveryAnchorProvided']) === 1 ? 1 : 0);
            pendingFailure = { tsMs, inspected: false, interveningCalls: 0 };
            continue;
        }
        if (event === 'repo_apply_patch_batch_post_validation') {
            compositePostValidationCount += 1;
            continue;
        }
        if (event === 'tool_call_completed' && tool) {
            lastCompleted = { tool, tsMs };
            continue;
        }
        if (event !== 'tool_call_started' || !tool) continue;
        increment(toolStarts, tool);
        if (tool === 'git_publish_changes') gitOneShotCalls += 1;
        if (
            ['git_stage_plan', 'git_stage', 'git_commit_plan', 'git_commit', 'git_push_plan', 'git_push'].includes(tool)
        ) {
            gitGranularCalls += 1;
            increment(gitGranularByTool, tool);
        }
        if (tool === 'job_get_summary' || tool === 'job_get_output') validatorPollCount += 1;
        if (lastCompleted) {
            const gapMs = Math.max(0, tsMs - lastCompleted.tsMs);
            if (gapMs > MAX_INTERACTIVE_TRANSITION_GAP_MS) {
                discontinuityCount += 1;
                discontinuityTotalMs += gapMs;
                discontinuityMaxMs = Math.max(discontinuityMaxMs, gapMs);
            } else {
                const key = `${lastCompleted.tool}→${tool}`;
                const aggregate = transitions.get(key) ?? {
                    from: lastCompleted.tool,
                    to: tool,
                    count: 0,
                    totalGapMs: 0,
                    gaps: [],
                };
                aggregate.count += 1;
                aggregate.totalGapMs += gapMs;
                aggregate.gaps.push(gapMs);
                transitions.set(key, aggregate);
                if (PLAN_APPLY_PAIRS[lastCompleted.tool] === tool) {
                    planThenApplyCount += 1;
                    increment(planThenApplyByPair, `${lastCompleted.tool}→${tool}`);
                }
                if (PATCH_TOOLS.includes(lastCompleted.tool) && tool === 'run_copilot_validator') {
                    patchThenValidatorTransitions += 1;
                }
            }
            lastCompleted = null;
        }
        if (pendingFailure) {
            if (tsMs - pendingFailure.tsMs > RECOVERY_WINDOW_MS) {
                pendingFailure = null;
            } else {
                pendingFailure.interveningCalls += 1;
                if (INSPECTION_TOOLS.includes(tool)) pendingFailure.inspected = true;
                if (PATCH_TOOLS.includes(tool)) {
                    recoveryTraceCount += 1;
                    if (pendingFailure.inspected) recoveryWithInspectionCount += 1;
                    recoveryRoundTrips += pendingFailure.interveningCalls;
                    recoveryGapMs += Math.max(0, tsMs - pendingFailure.tsMs);
                    pendingFailure = null;
                }
            }
        }
    }

    const rankedTransitions = [...transitions.values()]
        .map((row) => ({
            from: row.from,
            to: row.to,
            count: row.count,
            totalGapMs: row.totalGapMs,
            p50GapMs: percentile(row.gaps, 0.5),
            p95GapMs: percentile(row.gaps, 0.95),
        }))
        .sort((left, right) => right.totalGapMs - left.totalGapMs);
    const topTransitions = rankedTransitions.slice(0, options.top);
    const recurringTransitions = rankedTransitions.filter((row) => row.count >= 2).slice(0, options.top);
    const sameCallActionability = {
        causalFailureCount,
        recoveryRequiredTargetCount,
        inlineNextActionTargetCount,
        inlineRecoveryAnchorTargetCount,
        inlineNextActionCoverage:
            causalFailureCount > 0 ? Number((inlineNextActionTargetCount / causalFailureCount).toFixed(4)) : null,
        inlineRecoveryAnchorCoverage:
            causalFailureCount > 0 ? Number((inlineRecoveryAnchorTargetCount / causalFailureCount).toFixed(4)) : null,
    };
    const optimizationEvidence = buildRoundTripOptimizationEvidence({
        planThenApplyCount,
        validatorPollCount,
        patchThenValidatorTransitions,
        compositePostValidationCount,
        gitGranularCalls,
        gitOneShotCalls,
        recoveryWithInspectionCount,
        inlineNextActionTargetCount,
    });

    return {
        schemaVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        normalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        authority: 'derived-from-incrementally-indexed-mcp-audit',
        windowMs: options.windowMs,
        includeSynthetic: options.includeSynthetic,
        indexedRows: rows.length,
        topTransitions,
        sequenceEvidence: {
            authority: 'completed-tool-call-to-next-started-tool-call-within-interactive-window',
            recurringTransitions,
            recurringTransitionCount: recurringTransitions.length,
        },
        failures: {
            byCode: mapToObject(failureCodes),
            byClass: mapToObject(failureClasses),
            byRetryability: mapToObject(retryability),
            ...sameCallActionability,
        },
        recovery: {
            traceCount: recoveryTraceCount,
            withInspectionCount: recoveryWithInspectionCount,
            withoutInspectionCount: Math.max(0, recoveryTraceCount - recoveryWithInspectionCount),
            roundTrips: recoveryRoundTrips,
            totalGapMs: recoveryGapMs,
            averageGapMs: recoveryTraceCount > 0 ? Math.round(recoveryGapMs / recoveryTraceCount) : 0,
        },
        workflowPressure: {
            planThenApplyCount,
            planThenApplyByPair: mapToObject(planThenApplyByPair),
            validatorPollCount,
            patchThenValidatorTransitions,
            compositePostValidationCount,
            gitGranularCalls,
            gitGranularByTool: mapToObject(gitGranularByTool),
            gitOneShotCalls,
            gitGranularToOneShotRatio:
                gitOneShotCalls > 0 ? Number((gitGranularCalls / gitOneShotCalls).toFixed(2)) : null,
        },
        optimizationEvidence,
        discontinuities: {
            thresholdMs: MAX_INTERACTIVE_TRANSITION_GAP_MS,
            count: discontinuityCount,
            totalMs: discontinuityTotalMs,
            maxMs: discontinuityMaxMs,
        },
        toolStarts: [...toolStarts.entries()]
            .map(([tool, count]) => ({ tool, count }))
            .sort((left, right) => right.count - left.count)
            .slice(0, options.top),
    };
}

/** @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */

/**
 * @param {number} windowMs
 * @param {boolean} includeSynthetic
 * @param {string} authority
 */
export function buildUnavailableRoundTripSnapshot(windowMs, includeSynthetic, authority) {
    return {
        available: false,
        schemaVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        normalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        authority,
        windowMs,
        includeSynthetic,
        indexedRows: 0,
        topTransitions: [],
        failures: emptyFailureAnalytics(),
        sequenceEvidence: emptySequenceEvidence(),
        recovery: {
            traceCount: 0,
            withInspectionCount: 0,
            withoutInspectionCount: 0,
            roundTrips: 0,
            totalGapMs: 0,
            averageGapMs: 0,
        },
        workflowPressure: {
            planThenApplyCount: 0,
            planThenApplyByPair: {},
            validatorPollCount: 0,
            patchThenValidatorTransitions: 0,
            compositePostValidationCount: 0,
            gitGranularCalls: 0,
            gitGranularByTool: {},
            gitOneShotCalls: 0,
            gitGranularToOneShotRatio: null,
        },
        optimizationEvidence: emptyOptimizationEvidence(),
        discontinuities: {
            thresholdMs: MAX_INTERACTIVE_TRANSITION_GAP_MS,
            count: 0,
            totalMs: 0,
            maxMs: 0,
        },
        toolStarts: [],
    };
}

function emptyFailureAnalytics() {
    return {
        byCode: {},
        byClass: {},
        byRetryability: {},
        causalFailureCount: 0,
        recoveryRequiredTargetCount: 0,
        inlineNextActionTargetCount: 0,
        inlineRecoveryAnchorTargetCount: 0,
        inlineNextActionCoverage: null,
        inlineRecoveryAnchorCoverage: null,
    };
}

function emptySequenceEvidence() {
    return {
        authority: 'completed-tool-call-to-next-started-tool-call-within-interactive-window',
        recurringTransitions: [],
        recurringTransitionCount: 0,
    };
}

function emptyOptimizationEvidence() {
    return {
        newCompositeRecommendation: 'none-from-analytics-alone',
        existingMechanisms: [],
        caveat: 'Observed sequence pressure ranks existing mechanisms; semantic review is required before removing deliberate plan, validation or Git boundaries.',
    };
}

/**
 * @param {{
 *   planThenApplyCount:number; validatorPollCount:number; patchThenValidatorTransitions:number;
 *   compositePostValidationCount:number; gitGranularCalls:number; gitOneShotCalls:number;
 *   recoveryWithInspectionCount:number; inlineNextActionTargetCount:number;
 * }} evidence
 */
function buildRoundTripOptimizationEvidence(evidence) {
    /** @type {{mechanism:string; observedCount:number; evidence:string; caveat:string}[]} */
    const existingMechanisms = [];
    if (evidence.planThenApplyCount > 0)
        existingMechanisms.push({
            mechanism: 'direct-governed-apply',
            observedCount: evidence.planThenApplyCount,
            evidence: 'plan→apply transitions observed',
            caveat: 'Keep plan calls when preview, destructive-risk review or a separate approval boundary is intentional.',
        });
    if (evidence.patchThenValidatorTransitions > 0)
        existingMechanisms.push({
            mechanism: 'repo_apply_patch_batch.postValidation',
            observedCount: evidence.patchThenValidatorTransitions,
            evidence: 'patch→validator transitions observed',
            caveat: 'Use composite post-validation only for validators causally tied to the patch.',
        });
    if (evidence.validatorPollCount > 0)
        existingMechanisms.push({
            mechanism: 'inline-or-batched-validator-completion',
            observedCount: evidence.validatorPollCount,
            evidence: 'validator job polling calls observed',
            caveat: 'Polling remains legitimate when the validator explicitly returns before completion.',
        });
    if (evidence.gitGranularCalls > 0)
        existingMechanisms.push({
            mechanism: 'git_publish_changes',
            observedCount: evidence.gitGranularCalls,
            evidence: `granular Git calls observed; one-shot calls=${String(evidence.gitOneShotCalls)}`,
            caveat: 'Retain granular Git boundaries when staging selection, review or publication intent differs.',
        });
    if (evidence.recoveryWithInspectionCount > 0)
        existingMechanisms.push({
            mechanism: 'inline-causal-next-action/recovery-evidence',
            observedCount: evidence.recoveryWithInspectionCount,
            evidence: `failure→inspection→retry traces observed; inline next-actions indexed=${String(evidence.inlineNextActionTargetCount)}`,
            caveat: 'A bounded reread is still correct when returned evidence does not prove the recovery anchor or current state.',
        });
    return {
        newCompositeRecommendation: 'none-from-analytics-alone',
        existingMechanisms,
        caveat: 'Observed sequence pressure ranks existing mechanisms; semantic review is required before removing deliberate plan, validation or Git boundaries.',
    };
}

/** @param {unknown} value */
function parseCountMap(value) {
    if (typeof value !== 'string' || value.length === 0) return new Map();
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
        /** @type {Map<string, number>} */
        const out = new Map();
        for (const [key, rawCount] of Object.entries(/** @type {Record<string, unknown>} */ (parsed)).slice(0, 64)) {
            const count = nonNegativeIntegerOrNull(rawCount);
            if (!key || count === null || count === 0) continue;
            out.set(key, count);
        }
        return out;
    } catch {
        return new Map();
    }
}

/** @param {Map<string, number>} target @param {Map<string, number>} source */
function mergeCountMap(target, source) {
    for (const [key, count] of source) target.set(key, (target.get(key) ?? 0) + count);
}

/** @param {Map<string, number>} map @param {string} key */
function increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

/** @param {Map<string, number>} map */
function mapToObject(map) {
    return Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1]));
}

/** @param {number[]} values @param {number} ratio */
function percentile(values, ratio) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return Math.round(sorted[index] ?? 0);
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value */
function nonNegativeIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
