// @ts-check
/** Lineage-aware temporal/recovery/workflow summary over normalized MCP round-trip event rows. */

import { MCP_ROUND_TRIP_NORMALIZER_VERSION, MCP_TOOL_CALL_TERMINAL_EVENTS } from './normalizer.js';

const RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_INTERACTIVE_TRANSITION_GAP_MS = 5 * 60 * 1000;
const HEAVY_RESULT_THRESHOLD_BYTES = 64 * 1024;
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
 * @typedef {{
 *   callId: string | null;
 *   tool: string;
 *   tsMs: number;
 *   traceKey: string | null;
 *   targetPrecision: string | null;
 *   targetKeys: Set<string>;
 *   batchSize: number | null;
 *   batchCapacity: number | null;
 *   truncatedOperations: number;
 *   continuationRequired: boolean;
 *   resultBytes: number;
 * }} CallEvidence
 *
 * @typedef {{
 *   callId: string;
 *   tsMs: number;
 *   traceKey: string;
 *   targetPrecision: string | null;
 *   targetKeys: Set<string>;
 *   inspected: boolean;
 *   sameTargetInspected: boolean;
 *   interveningCalls: number;
 * }} RecoveryCandidate
 */

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{
 *   windowMs: number;
 *   top: number;
 *   includeSynthetic: boolean;
 *   completeness?: {rowsEligible:number;rowsAnalyzed:number;maxRows:number;truncated:boolean;selection:string;coverageRatio:number};
 * }} options
 */
export function summarizeMcpRoundTripRows(rows, options) {
    /** @type {Map<string, {from:string;to:string;count:number;totalGapMs:number;gaps:number[]}>} */
    const temporalTransitions = new Map();
    /** @type {Map<string, {from:string;to:string;count:number;totalGapMs:number;gaps:number[]}>} */
    const lineageTransitions = new Map();
    const failureCodes = new Map();
    const failureClasses = new Map();
    const retryability = new Map();
    const failureCohorts = new Map();
    let causalFailureCount = 0;
    let recoveryRequiredTargetCount = 0;
    let inlineNextActionTargetCount = 0;
    let inlineRecoveryAnchorTargetCount = 0;
    const toolStarts = new Map();
    const callStarts = new Map();
    const activeCallIds = new Set();
    let startedCallCount = 0;
    let terminalCallCount = 0;
    let pairedCallCount = 0;
    let orphanTerminalCount = 0;
    let missingCallIdStartCount = 0;
    let missingCallIdTerminalCount = 0;
    let activeOverlapExcludedCount = 0;
    /** @type {CallEvidence | null} */
    let lastQuiescentCompletion = null;
    let unknownLineageTransitionCount = 0;
    let crossTracePairRejectedCount = 0;
    let lineageKnownPairCount = 0;
    const traceContextStates = new Map();
    let validTraceStartCount = 0;
    let temporalHeavyResultReadFollowupCount = 0;
    let lineageHeavyResultReadFollowupCount = 0;
    let sameTargetHeavyResultRereadCount = 0;

    /** Temporal compatibility pressure: deliberately not causal. */
    /** @type {{ tsMs: number; inspected: boolean; interveningCalls: number } | null} */
    let temporalPendingFailure = null;
    let temporalRecoveryTraceCount = 0;
    let temporalRecoveryWithInspectionCount = 0;
    let temporalRecoveryRoundTrips = 0;
    let temporalRecoveryGapMs = 0;

    /** @type {RecoveryCandidate[]} */
    const lineageRecoveryCandidates = [];
    let recoveryCandidateWithLineageCount = 0;
    let recoveryCandidateWithoutLineageCount = 0;
    let lineageRecoveryTraceCount = 0;
    let lineageRecoveryWithInspectionCount = 0;
    let lineageRecoveryRoundTrips = 0;
    let lineageRecoveryGapMs = 0;
    let sameTargetRecoveryTraceCount = 0;
    let sameTargetRecoveryWithInspectionCount = 0;

    let planThenApplyCount = 0;
    let lineagePlanThenApplyCount = 0;
    const planThenApplyByPair = new Map();
    let validatorPollCount = 0;
    let patchThenValidatorTransitions = 0;
    let lineagePatchThenValidatorTransitions = 0;
    let compositePostValidationCount = 0;
    let gitGranularCalls = 0;
    const gitGranularByTool = new Map();
    let gitOneShotCalls = 0;
    let discontinuityCount = 0;
    let discontinuityTotalMs = 0;
    let discontinuityMaxMs = 0;

    const executionByTool = new Map();
    const payloadByTool = new Map();
    let executionCompletedCalls = 0;
    let executionAccountedCalls = 0;
    let totalLogicalOperations = 0;
    let totalCoalescedLogicalOperations = 0;
    let totalBatchCalls = 0;
    let totalSaturatedBatchCalls = 0;
    let totalTruncatedOperations = 0;
    let totalContinuationCalls = 0;
    const repeatAfterBatch = {
        unsaturatedComplete: 0,
        saturated: 0,
        truncated: 0,
        continuation: 0,
    };
    const repeatAfterBatchByTool = new Map();
    const runtimeCohorts = new Map();

    for (const row of rows) {
        const event = String(row['event'] ?? '');
        const tool = stringOrNull(row['tool']);
        const tsMs = Number(row['ts_ms'] ?? row['tsMs'] ?? 0);
        if (!Number.isFinite(tsMs)) continue;

        if (isPatchFailureEvent(event)) {
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

            const failureCount =
                nonNegativeIntegerOrNull(row['causal_failure_count'] ?? row['causalFailureCount']) ?? 1;
            const recoveryRequiredCount =
                nonNegativeIntegerOrNull(row['recovery_required_target_count'] ?? row['recoveryRequiredTargetCount']) ??
                (Number(row['recovery_required'] ?? row['recoveryRequired']) === 1 ? 1 : 0);
            const inlineNextCount =
                nonNegativeIntegerOrNull(
                    row['inline_next_action_target_count'] ?? row['inlineNextActionTargetCount'],
                ) ?? (Number(row['inline_next_action_provided'] ?? row['inlineNextActionProvided']) === 1 ? 1 : 0);
            const inlineAnchorCount =
                nonNegativeIntegerOrNull(
                    row['inline_recovery_anchor_target_count'] ?? row['inlineRecoveryAnchorTargetCount'],
                ) ??
                (Number(row['inline_recovery_anchor_provided'] ?? row['inlineRecoveryAnchorProvided']) === 1 ? 1 : 0);
            causalFailureCount += failureCount;
            recoveryRequiredTargetCount += recoveryRequiredCount;
            inlineNextActionTargetCount += inlineNextCount;
            inlineRecoveryAnchorTargetCount += inlineAnchorCount;
            mergeFailureCohort(failureCohorts, cohortKey(row), {
                causal: failureCount,
                recoveryRequired: recoveryRequiredCount,
                inlineNext: inlineNextCount,
                inlineAnchor: inlineAnchorCount,
            });

            temporalPendingFailure = { tsMs, inspected: false, interveningCalls: 0 };
            const failureEvidence = readCallEvidence(row, tool ?? 'repo_apply_patch', tsMs);
            if (failureEvidence.callId && failureEvidence.traceKey) {
                recoveryCandidateWithLineageCount += 1;
                lineageRecoveryCandidates.push({
                    callId: failureEvidence.callId,
                    tsMs,
                    traceKey: failureEvidence.traceKey,
                    targetPrecision: failureEvidence.targetPrecision,
                    targetKeys: failureEvidence.targetKeys,
                    inspected: false,
                    sameTargetInspected: false,
                    interveningCalls: 0,
                });
            } else {
                recoveryCandidateWithoutLineageCount += 1;
            }
            expireRecoveryCandidates(lineageRecoveryCandidates, tsMs);
            continue;
        }

        if (event === 'repo_apply_patch_batch_post_validation') {
            compositePostValidationCount += 1;
            continue;
        }

        if (event === 'tool_call_started' && tool) {
            startedCallCount += 1;
            const traceContextState = stringOrNull(row['trace_context_state'] ?? row['traceContextState']) ?? 'unknown';
            increment(traceContextStates, traceContextState);
            if (traceContextState === 'valid') validTraceStartCount += 1;
            increment(toolStarts, tool);
            mergeRuntimeCohort(runtimeCohorts, cohortKey(row));
            if (tool === 'git_publish_changes') gitOneShotCalls += 1;
            if (
                ['git_stage_plan', 'git_stage', 'git_commit_plan', 'git_commit', 'git_push_plan', 'git_push'].includes(
                    tool,
                )
            ) {
                gitGranularCalls += 1;
                increment(gitGranularByTool, tool);
            }
            if (tool === 'job_get_summary' || tool === 'job_get_output') validatorPollCount += 1;

            const start = readCallEvidence(row, tool, tsMs);
            if (start.callId) {
                callStarts.set(start.callId, start);
                if (activeCallIds.size > 0) activeOverlapExcludedCount += 1;
                else if (lastQuiescentCompletion) {
                    classifyTemporalTransition(lastQuiescentCompletion, start);
                }
                activeCallIds.add(start.callId);
            } else {
                missingCallIdStartCount += 1;
            }

            processTemporalRecoveryStart(tool, tsMs);
            processLineageRecoveryStart(start);
            continue;
        }

        if (MCP_TOOL_CALL_TERMINAL_EVENTS.includes(event) && tool) {
            terminalCallCount += 1;
            const terminal = readCallEvidence(row, tool, tsMs);
            if (event === 'tool_call_completed') recordExecutionCompletion(row, tool);
            if (!terminal.callId) {
                missingCallIdTerminalCount += 1;
                continue;
            }
            const start = callStarts.get(terminal.callId);
            if (!start || !activeCallIds.has(terminal.callId)) {
                orphanTerminalCount += 1;
                continue;
            }
            pairedCallCount += 1;
            activeCallIds.delete(terminal.callId);
            const completion = mergeCallEvidence(start, terminal);
            if (activeCallIds.size === 0) lastQuiescentCompletion = completion;
            continue;
        }
    }

    const orphanStartCount = activeCallIds.size;
    const rankedTemporalTransitions = rankTransitions(temporalTransitions);
    const rankedLineageTransitions = rankTransitions(lineageTransitions);
    const topTransitions = rankedTemporalTransitions.slice(0, options.top);
    const recurringTransitions = rankedTemporalTransitions.filter((row) => row.count >= 2).slice(0, options.top);
    const lineageBoundTransitions = rankedLineageTransitions.slice(0, options.top);
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
        temporalRecoveryWithInspectionCount,
        inlineNextActionTargetCount,
    });
    const completeness = options.completeness ?? {
        rowsEligible: rows.length,
        rowsAnalyzed: rows.length,
        maxRows: rows.length,
        truncated: false,
        selection: 'caller-provided-complete-rows',
        coverageRatio: 1,
    };
    const knownCohorts = [...runtimeCohorts.entries()].filter(([key]) => key !== 'unknown');

    return {
        schemaVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        normalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        authority: completeness.truncated
            ? 'derived-from-bounded-newest-tail-of-incrementally-indexed-mcp-audit'
            : 'derived-from-incrementally-indexed-mcp-audit',
        windowMs: options.windowMs,
        includeSynthetic: options.includeSynthetic,
        indexedRows: rows.length,
        completeness,
        callPairing: {
            startedCallCount,
            terminalCallCount,
            pairedCallCount,
            orphanStartCount,
            orphanTerminalCount,
            missingCallIdStartCount,
            missingCallIdTerminalCount,
            pairingCoverage: startedCallCount > 0 ? Number((pairedCallCount / startedCallCount).toFixed(4)) : null,
            terminalEvents: [...MCP_TOOL_CALL_TERMINAL_EVENTS],
        },
        topTransitions,
        lineageContext: {
            authority: 'sanitized-request-meta-trace-context-state-on-tool-call-starts',
            traceContextStateCounts: mapToObject(traceContextStates),
            validTraceStartCount,
            startedCallCount,
            validTraceStartRate:
                startedCallCount > 0 ? Number((validTraceStartCount / startedCallCount).toFixed(4)) : null,
            caveat: 'Only the sanitized trace-context state is retained. Raw traceparent, tracestate and baggage are neither exposed here nor persisted in the derived index.',
        },
        sequenceEvidence: {
            authority: 'quiescent-burst-temporal-adjacency-not-workflow-causality',
            recurringTransitions,
            recurringTransitionCount: recurringTransitions.length,
            lineageAuthority: 'matching-sanitized-w3c-trace-key-when-provided-by-client',
            lineageBoundTransitions,
            lineageBoundTransitionCount: rankedLineageTransitions.reduce((sum, row) => sum + row.count, 0),
            lineageKnownPairCount,
            lineageUnknownPairCount: unknownLineageTransitionCount,
            lineageKnownRate:
                lineageKnownPairCount + unknownLineageTransitionCount > 0
                    ? Number(
                          (lineageKnownPairCount / (lineageKnownPairCount + unknownLineageTransitionCount)).toFixed(4),
                      )
                    : null,
            unknownLineageTransitionCount,
            crossTracePairRejectedCount,
            activeOverlapExcludedCount,
        },
        failures: {
            byCode: mapToObject(failureCodes),
            byClass: mapToObject(failureClasses),
            byRetryability: mapToObject(retryability),
            ...sameCallActionability,
            byRuntimeCohort: renderFailureCohorts(failureCohorts),
        },
        recovery: {
            authority: 'temporal-pressure-plus-lineage-bound-v4',
            temporalPressure: {
                traceCount: temporalRecoveryTraceCount,
                withInspectionCount: temporalRecoveryWithInspectionCount,
                withoutInspectionCount: Math.max(0, temporalRecoveryTraceCount - temporalRecoveryWithInspectionCount),
                roundTrips: temporalRecoveryRoundTrips,
                totalGapMs: temporalRecoveryGapMs,
                averageGapMs:
                    temporalRecoveryTraceCount > 0 ? Math.round(temporalRecoveryGapMs / temporalRecoveryTraceCount) : 0,
                caveat: 'Temporal pressure only; it may cross unrelated workflows when trace lineage is unavailable.',
            },
            lineageBound: {
                candidateWithLineageCount: recoveryCandidateWithLineageCount,
                candidateWithoutLineageCount: recoveryCandidateWithoutLineageCount,
                unknownRecoveryLineageCount: recoveryCandidateWithoutLineageCount,
                traceCount: lineageRecoveryTraceCount,
                withInspectionCount: lineageRecoveryWithInspectionCount,
                roundTrips: lineageRecoveryRoundTrips,
                totalGapMs: lineageRecoveryGapMs,
                averageGapMs:
                    lineageRecoveryTraceCount > 0 ? Math.round(lineageRecoveryGapMs / lineageRecoveryTraceCount) : 0,
                sameTargetTraceCount: sameTargetRecoveryTraceCount,
                sameTargetWithInspectionCount: sameTargetRecoveryWithInspectionCount,
                pendingCandidateCount: lineageRecoveryCandidates.length,
            },
        },
        workflowPressure: {
            authority: 'temporal-adjacency-unless-lineage-counterpart-is-explicitly-named',
            planThenApplyCount,
            lineagePlanThenApplyCount,
            planThenApplyByPair: mapToObject(planThenApplyByPair),
            validatorPollCount,
            patchThenValidatorTransitions,
            lineagePatchThenValidatorTransitions,
            compositePostValidationCount,
            gitGranularCalls,
            gitGranularByTool: mapToObject(gitGranularByTool),
            gitOneShotCalls,
            gitGranularToOneShotRatio:
                gitOneShotCalls > 0 ? Number((gitGranularCalls / gitOneShotCalls).toFixed(2)) : null,
        },
        executionAccounting: {
            completedCalls: executionCompletedCalls,
            accountedCalls: executionAccountedCalls,
            accountingCoverageRate:
                executionCompletedCalls > 0
                    ? Number((executionAccountedCalls / executionCompletedCalls).toFixed(4))
                    : null,
            logicalOperations: totalLogicalOperations,
            coalescedLogicalOperations: totalCoalescedLogicalOperations,
            batchCalls: totalBatchCalls,
            saturatedBatchCalls: totalSaturatedBatchCalls,
            truncatedOperations: totalTruncatedOperations,
            continuationCalls: totalContinuationCalls,
            repeatAfterBatch,
            byTool: renderExecutionByTool(executionByTool, repeatAfterBatchByTool, options.top),
        },
        payloadAccounting: {
            authority: 'bounded-result-byte-accounting-plus-lineage-aware-heavy-result-followup-pressure',
            heavyResultThresholdBytes: HEAVY_RESULT_THRESHOLD_BYTES,
            heavyResultFollowups: {
                temporalReadFollowupCount: temporalHeavyResultReadFollowupCount,
                lineageReadFollowupCount: lineageHeavyResultReadFollowupCount,
                sameTargetRereadCount: sameTargetHeavyResultRereadCount,
                caveat: 'A follow-up after a heavy result is observational pressure only. Same-target reread requires matching lineage, exact target identity and the same inspection tool; none of these counters proves avoidability.',
            },
            byTool: renderPayloadByTool(payloadByTool, options.top),
        },
        runtimeCohorts: {
            generationMixDetected: knownCohorts.length > 1,
            knownCohortCount: knownCohorts.length,
            unknownCallCount: runtimeCohorts.get('unknown') ?? 0,
            callsByCohort: mapToObject(runtimeCohorts),
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

    /** @param {CallEvidence} previous @param {CallEvidence} current */
    function classifyTemporalTransition(previous, current) {
        const gapMs = Math.max(0, current.tsMs - previous.tsMs);
        if (gapMs > MAX_INTERACTIVE_TRANSITION_GAP_MS) {
            discontinuityCount += 1;
            discontinuityTotalMs += gapMs;
            discontinuityMaxMs = Math.max(discontinuityMaxMs, gapMs);
            return;
        }
        recordTransition(temporalTransitions, previous.tool, current.tool, gapMs);
        const heavyReadFollowup =
            previous.resultBytes >= HEAVY_RESULT_THRESHOLD_BYTES && INSPECTION_TOOLS.includes(current.tool);
        if (heavyReadFollowup) temporalHeavyResultReadFollowupCount += 1;
        if (PLAN_APPLY_PAIRS[previous.tool] === current.tool) {
            planThenApplyCount += 1;
            increment(planThenApplyByPair, `${previous.tool}→${current.tool}`);
        }
        if (PATCH_TOOLS.includes(previous.tool) && current.tool === 'run_copilot_validator') {
            patchThenValidatorTransitions += 1;
        }
        if (!previous.traceKey || !current.traceKey) {
            unknownLineageTransitionCount += 1;
            return;
        }
        lineageKnownPairCount += 1;
        if (previous.traceKey !== current.traceKey) {
            crossTracePairRejectedCount += 1;
            return;
        }
        if (heavyReadFollowup) {
            lineageHeavyResultReadFollowupCount += 1;
            if (
                previous.tool === current.tool &&
                previous.targetPrecision === 'exact-single' &&
                current.targetPrecision === 'exact-single' &&
                hasTargetOverlap(previous.targetKeys, current.targetKeys)
            ) {
                sameTargetHeavyResultRereadCount += 1;
            }
        }
        recordTransition(lineageTransitions, previous.tool, current.tool, gapMs);
        if (PLAN_APPLY_PAIRS[previous.tool] === current.tool) lineagePlanThenApplyCount += 1;
        if (PATCH_TOOLS.includes(previous.tool) && current.tool === 'run_copilot_validator') {
            lineagePatchThenValidatorTransitions += 1;
        }
        if (previous.tool === current.tool && (previous.batchSize ?? 0) > 1) {
            const category = classifyRepeatAfterBatch(previous);
            repeatAfterBatch[category] += 1;
            const byTool = repeatAfterBatchByTool.get(previous.tool) ?? {
                unsaturatedComplete: 0,
                saturated: 0,
                truncated: 0,
                continuation: 0,
            };
            byTool[category] += 1;
            repeatAfterBatchByTool.set(previous.tool, byTool);
        }
    }

    /** @param {string} toolName @param {number} currentTs */
    function processTemporalRecoveryStart(toolName, currentTs) {
        if (!temporalPendingFailure) return;
        if (currentTs - temporalPendingFailure.tsMs > RECOVERY_WINDOW_MS) {
            temporalPendingFailure = null;
            return;
        }
        temporalPendingFailure.interveningCalls += 1;
        if (INSPECTION_TOOLS.includes(toolName)) temporalPendingFailure.inspected = true;
        if (!PATCH_TOOLS.includes(toolName)) return;
        temporalRecoveryTraceCount += 1;
        if (temporalPendingFailure.inspected) temporalRecoveryWithInspectionCount += 1;
        temporalRecoveryRoundTrips += temporalPendingFailure.interveningCalls;
        temporalRecoveryGapMs += Math.max(0, currentTs - temporalPendingFailure.tsMs);
        temporalPendingFailure = null;
    }

    /** @param {CallEvidence} start */
    function processLineageRecoveryStart(start) {
        expireRecoveryCandidates(lineageRecoveryCandidates, start.tsMs);
        if (!start.traceKey) return;
        for (const candidate of lineageRecoveryCandidates) {
            if (candidate.traceKey !== start.traceKey || start.tsMs <= candidate.tsMs) continue;
            candidate.interveningCalls += 1;
            if (INSPECTION_TOOLS.includes(start.tool)) {
                candidate.inspected = true;
                if (isSameExactTarget(candidate, start)) candidate.sameTargetInspected = true;
            }
        }
        if (!PATCH_TOOLS.includes(start.tool)) return;
        for (let index = lineageRecoveryCandidates.length - 1; index >= 0; index -= 1) {
            const candidate = lineageRecoveryCandidates[index];
            if (!candidate || candidate.traceKey !== start.traceKey || start.tsMs <= candidate.tsMs) continue;
            const targetOverlap = hasTargetOverlap(candidate.targetKeys, start.targetKeys);
            if (candidate.targetKeys.size > 0 && start.targetKeys.size > 0 && !targetOverlap) continue;
            lineageRecoveryTraceCount += 1;
            if (candidate.inspected) lineageRecoveryWithInspectionCount += 1;
            lineageRecoveryRoundTrips += candidate.interveningCalls;
            lineageRecoveryGapMs += Math.max(0, start.tsMs - candidate.tsMs);
            if (candidate.targetPrecision === 'exact-single' && targetOverlap) {
                sameTargetRecoveryTraceCount += 1;
                if (candidate.sameTargetInspected) sameTargetRecoveryWithInspectionCount += 1;
            }
            lineageRecoveryCandidates.splice(index, 1);
            break;
        }
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordExecutionCompletion(row, toolName) {
        executionCompletedCalls += 1;
        const logicalOperations = positiveIntegerOrNull(row['logical_operations'] ?? row['logicalOperations']);
        const failedOperations = nonNegativeIntegerOrNull(row['failed_operations'] ?? row['failedOperations']) ?? 0;
        const skippedOperations = nonNegativeIntegerOrNull(row['skipped_operations'] ?? row['skippedOperations']) ?? 0;
        const batchSize = positiveIntegerOrNull(row['batch_size'] ?? row['batchSize']);
        const batchCapacity = positiveIntegerOrNull(row['batch_capacity'] ?? row['batchCapacity']);
        const truncatedOperations =
            nonNegativeIntegerOrNull(row['truncated_operations'] ?? row['truncatedOperations']) ?? 0;
        const continuationRequired = Number(row['continuation_required'] ?? row['continuationRequired']) === 1;
        const effectiveLogicalOperations = logicalOperations ?? 1;
        if (logicalOperations !== null) executionAccountedCalls += 1;
        totalLogicalOperations += effectiveLogicalOperations;
        totalCoalescedLogicalOperations += Math.max(0, effectiveLogicalOperations - 1);
        if ((batchSize ?? 0) > 1) totalBatchCalls += 1;
        if (batchSize !== null && batchCapacity !== null && batchSize >= batchCapacity) totalSaturatedBatchCalls += 1;
        totalTruncatedOperations += truncatedOperations;
        if (continuationRequired) totalContinuationCalls += 1;

        const metric = executionByTool.get(toolName) ?? {
            calls: 0,
            accountedCalls: 0,
            logicalOperations: 0,
            coalescedLogicalOperations: 0,
            batchCalls: 0,
            saturatedBatchCalls: 0,
            truncatedOperations: 0,
            continuationCalls: 0,
            truncatedCalls: 0,
            batchSizes: [],
            logicalOperationSamples: [],
        };
        metric.calls += 1;
        if (logicalOperations !== null) metric.accountedCalls += 1;
        metric.logicalOperations += effectiveLogicalOperations;
        metric.logicalOperationSamples.push(effectiveLogicalOperations);
        metric.coalescedLogicalOperations += Math.max(0, effectiveLogicalOperations - 1);
        if ((batchSize ?? 0) > 1) metric.batchCalls += 1;
        if (batchSize !== null) metric.batchSizes.push(batchSize);
        if (batchSize !== null && batchCapacity !== null && batchSize >= batchCapacity) metric.saturatedBatchCalls += 1;
        metric.truncatedOperations += truncatedOperations;
        if (truncatedOperations > 0) metric.truncatedCalls += 1;
        if (continuationRequired) metric.continuationCalls += 1;
        metric.failedOperations = (metric.failedOperations ?? 0) + failedOperations;
        metric.skippedOperations = (metric.skippedOperations ?? 0) + skippedOperations;
        executionByTool.set(toolName, metric);

        const resultBytes = nonNegativeIntegerOrNull(row['result_bytes'] ?? row['resultBytes']);
        const textBytes = nonNegativeIntegerOrNull(row['text_result_bytes'] ?? row['textResultBytes']) ?? 0;
        const nonTextBytes = nonNegativeIntegerOrNull(row['non_text_result_bytes'] ?? row['nonTextResultBytes']) ?? 0;
        const duplicateTextBytes =
            nonNegativeIntegerOrNull(row['duplicate_text_bytes'] ?? row['duplicateTextBytes']) ?? 0;
        if (resultBytes !== null || textBytes > 0 || nonTextBytes > 0 || duplicateTextBytes > 0) {
            const payload = payloadByTool.get(toolName) ?? {
                calls: 0,
                resultBytes: 0,
                textBytes: 0,
                nonTextBytes: 0,
                duplicateTextBytes: 0,
            };
            payload.calls += 1;
            payload.resultBytes += resultBytes ?? 0;
            payload.textBytes += textBytes;
            payload.nonTextBytes += nonTextBytes;
            payload.duplicateTextBytes += duplicateTextBytes;
            payloadByTool.set(toolName, payload);
        }
    }
}

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
        completeness: {
            rowsEligible: 0,
            rowsAnalyzed: 0,
            maxRows: 0,
            truncated: false,
            selection: 'unavailable',
            coverageRatio: 0,
        },
        callPairing: {
            startedCallCount: 0,
            terminalCallCount: 0,
            pairedCallCount: 0,
            orphanStartCount: 0,
            orphanTerminalCount: 0,
            missingCallIdStartCount: 0,
            missingCallIdTerminalCount: 0,
            pairingCoverage: null,
            terminalEvents: [...MCP_TOOL_CALL_TERMINAL_EVENTS],
        },
        topTransitions: [],
        lineageContext: {
            authority: 'sanitized-request-meta-trace-context-state-on-tool-call-starts',
            traceContextStateCounts: {},
            validTraceStartCount: 0,
            startedCallCount: 0,
            validTraceStartRate: null,
            caveat: 'Only the sanitized trace-context state is retained. Raw traceparent, tracestate and baggage are neither exposed here nor persisted in the derived index.',
        },
        failures: emptyFailureAnalytics(),
        sequenceEvidence: emptySequenceEvidence(),
        recovery: emptyRecoveryAnalytics(),
        workflowPressure: emptyWorkflowPressure(),
        executionAccounting: emptyExecutionAccounting(),
        payloadAccounting: {
            authority: 'bounded-result-byte-accounting-plus-lineage-aware-heavy-result-followup-pressure',
            heavyResultThresholdBytes: HEAVY_RESULT_THRESHOLD_BYTES,
            heavyResultFollowups: {
                temporalReadFollowupCount: 0,
                lineageReadFollowupCount: 0,
                sameTargetRereadCount: 0,
                caveat: 'A follow-up after a heavy result is observational pressure only. Same-target reread requires matching lineage, exact target identity and the same inspection tool; none of these counters proves avoidability.',
            },
            byTool: [],
        },
        runtimeCohorts: {
            generationMixDetected: false,
            knownCohortCount: 0,
            unknownCallCount: 0,
            callsByCohort: {},
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
        byRuntimeCohort: {},
    };
}

function emptySequenceEvidence() {
    return {
        authority: 'quiescent-burst-temporal-adjacency-not-workflow-causality',
        recurringTransitions: [],
        recurringTransitionCount: 0,
        lineageAuthority: 'matching-sanitized-w3c-trace-key-when-provided-by-client',
        lineageBoundTransitions: [],
        lineageBoundTransitionCount: 0,
        lineageKnownPairCount: 0,
        lineageUnknownPairCount: 0,
        lineageKnownRate: null,
        unknownLineageTransitionCount: 0,
        crossTracePairRejectedCount: 0,
        activeOverlapExcludedCount: 0,
    };
}

function emptyRecoveryAnalytics() {
    const temporalPressure = {
        traceCount: 0,
        withInspectionCount: 0,
        withoutInspectionCount: 0,
        roundTrips: 0,
        totalGapMs: 0,
        averageGapMs: 0,
        caveat: 'Temporal pressure only; it may cross unrelated workflows when trace lineage is unavailable.',
    };
    return {
        authority: 'temporal-pressure-plus-lineage-bound-v4',
        temporalPressure,
        lineageBound: {
            candidateWithLineageCount: 0,
            candidateWithoutLineageCount: 0,
            unknownRecoveryLineageCount: 0,
            traceCount: 0,
            withInspectionCount: 0,
            roundTrips: 0,
            totalGapMs: 0,
            averageGapMs: 0,
            sameTargetTraceCount: 0,
            sameTargetWithInspectionCount: 0,
            pendingCandidateCount: 0,
        },
    };
}

function emptyWorkflowPressure() {
    return {
        authority: 'temporal-adjacency-unless-lineage-counterpart-is-explicitly-named',
        planThenApplyCount: 0,
        lineagePlanThenApplyCount: 0,
        planThenApplyByPair: {},
        validatorPollCount: 0,
        patchThenValidatorTransitions: 0,
        lineagePatchThenValidatorTransitions: 0,
        compositePostValidationCount: 0,
        gitGranularCalls: 0,
        gitGranularByTool: {},
        gitOneShotCalls: 0,
        gitGranularToOneShotRatio: null,
    };
}

function emptyExecutionAccounting() {
    return {
        completedCalls: 0,
        accountedCalls: 0,
        accountingCoverageRate: null,
        logicalOperations: 0,
        coalescedLogicalOperations: 0,
        batchCalls: 0,
        saturatedBatchCalls: 0,
        truncatedOperations: 0,
        continuationCalls: 0,
        repeatAfterBatch: { unsaturatedComplete: 0, saturated: 0, truncated: 0, continuation: 0 },
        byTool: [],
    };
}

function emptyOptimizationEvidence() {
    return {
        newCompositeRecommendation: 'none-from-analytics-alone',
        existingMechanisms: [],
        caveat: 'Temporal pressure only ranks investigation targets. Lineage and semantic review are required before classifying a round trip as avoidable.',
    };
}

/** @param {string} event */
function isPatchFailureEvent(event) {
    return (
        event === 'repo_apply_patch_failed' ||
        event === 'repo_apply_patch_batch_preflight_blocked' ||
        event === 'repo_apply_patch_batch_partial_failure'
    );
}

/** @param {Record<string, unknown>} row @param {string} tool @param {number} tsMs @returns {CallEvidence} */
function readCallEvidence(row, tool, tsMs) {
    return {
        callId: stringOrNull(row['call_id'] ?? row['callId']),
        tool,
        tsMs,
        traceKey: stringOrNull(row['trace_key'] ?? row['traceKey']),
        targetPrecision: stringOrNull(row['target_precision'] ?? row['targetPrecision']),
        targetKeys: parseStringSet(row['target_keys_json'] ?? row['targetKeysJson']),
        batchSize: positiveIntegerOrNull(row['batch_size'] ?? row['batchSize']),
        batchCapacity: positiveIntegerOrNull(row['batch_capacity'] ?? row['batchCapacity']),
        truncatedOperations: nonNegativeIntegerOrNull(row['truncated_operations'] ?? row['truncatedOperations']) ?? 0,
        continuationRequired: Number(row['continuation_required'] ?? row['continuationRequired']) === 1,
        resultBytes: nonNegativeIntegerOrNull(row['result_bytes'] ?? row['resultBytes']) ?? 0,
    };
}

/** @param {CallEvidence} start @param {CallEvidence} terminal @returns {CallEvidence} */
function mergeCallEvidence(start, terminal) {
    return {
        callId: terminal.callId ?? start.callId,
        tool: terminal.tool || start.tool,
        tsMs: terminal.tsMs,
        traceKey: terminal.traceKey ?? start.traceKey,
        targetPrecision: terminal.targetPrecision ?? start.targetPrecision,
        targetKeys: terminal.targetKeys.size > 0 ? terminal.targetKeys : start.targetKeys,
        batchSize: terminal.batchSize ?? start.batchSize,
        batchCapacity: terminal.batchCapacity ?? start.batchCapacity,
        truncatedOperations: terminal.truncatedOperations,
        continuationRequired: terminal.continuationRequired,
        resultBytes: terminal.resultBytes || start.resultBytes,
    };
}

/** @param {CallEvidence} previous */
function classifyRepeatAfterBatch(previous) {
    if (previous.continuationRequired) return /** @type {const} */ ('continuation');
    if (previous.truncatedOperations > 0) return /** @type {const} */ ('truncated');
    if (
        previous.batchSize !== null &&
        previous.batchCapacity !== null &&
        previous.batchSize >= previous.batchCapacity
    ) {
        return /** @type {const} */ ('saturated');
    }
    return /** @type {const} */ ('unsaturatedComplete');
}

/** @param {RecoveryCandidate[]} candidates @param {number} nowMs */
function expireRecoveryCandidates(candidates, nowMs) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        if (nowMs - (candidates[index]?.tsMs ?? nowMs) > RECOVERY_WINDOW_MS) candidates.splice(index, 1);
    }
}

/** @param {RecoveryCandidate} candidate @param {CallEvidence} call */
function isSameExactTarget(candidate, call) {
    return candidate.targetPrecision === 'exact-single' && hasTargetOverlap(candidate.targetKeys, call.targetKeys);
}

/** @param {Set<string>} left @param {Set<string>} right */
function hasTargetOverlap(left, right) {
    if (left.size === 0 || right.size === 0) return false;
    for (const key of left) if (right.has(key)) return true;
    return false;
}

/**
 * @param {Map<string, {from:string;to:string;count:number;totalGapMs:number;gaps:number[]}>} transitions
 * @param {string} from
 * @param {string} to
 * @param {number} gapMs
 */
function recordTransition(transitions, from, to, gapMs) {
    const key = `${from}→${to}`;
    const aggregate = transitions.get(key) ?? { from, to, count: 0, totalGapMs: 0, gaps: [] };
    aggregate.count += 1;
    aggregate.totalGapMs += gapMs;
    aggregate.gaps.push(gapMs);
    transitions.set(key, aggregate);
}

/** @param {Map<string, {from:string;to:string;count:number;totalGapMs:number;gaps:number[]}>} transitions */
function rankTransitions(transitions) {
    return [...transitions.values()]
        .map((row) => ({
            from: row.from,
            to: row.to,
            count: row.count,
            totalGapMs: row.totalGapMs,
            p50GapMs: percentile(row.gaps, 0.5),
            p95GapMs: percentile(row.gaps, 0.95),
        }))
        .sort((left, right) => right.totalGapMs - left.totalGapMs);
}

/** @param {Map<string, any>} byTool @param {Map<string, any>} repeats @param {number} top */
function renderExecutionByTool(byTool, repeats, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => {
            const batchSizes = /** @type {number[]} */ (metric.batchSizes ?? []);
            const logicalOperationSamples = /** @type {number[]} */ (metric.logicalOperationSamples ?? []);
            const repeat = repeats.get(tool) ?? {
                unsaturatedComplete: 0,
                saturated: 0,
                truncated: 0,
                continuation: 0,
            };
            return {
                tool,
                calls: metric.calls,
                accountedCalls: metric.accountedCalls,
                accountingCoverageRate:
                    metric.calls > 0 ? Number((metric.accountedCalls / metric.calls).toFixed(4)) : null,
                logicalOperations: metric.logicalOperations,
                logicalOperationsPerCall:
                    metric.calls > 0 ? Number((metric.logicalOperations / metric.calls).toFixed(3)) : 0,
                coalescedLogicalOperations: metric.coalescedLogicalOperations,
                logicalOperationsPerCallP50: percentile(logicalOperationSamples, 0.5),
                logicalOperationsPerCallP95: percentile(logicalOperationSamples, 0.95),
                singleCalls: Math.max(0, metric.calls - metric.batchCalls),
                batchCalls: metric.batchCalls,
                batchCallRate: metric.calls > 0 ? Number((metric.batchCalls / metric.calls).toFixed(4)) : 0,
                batchSizeHistogram: integerHistogram(batchSizes),
                batchSizeP50: percentile(batchSizes, 0.5),
                batchSizeP95: percentile(batchSizes, 0.95),
                saturatedBatchCalls: metric.saturatedBatchCalls,
                saturationRate:
                    metric.batchCalls > 0 ? Number((metric.saturatedBatchCalls / metric.batchCalls).toFixed(4)) : 0,
                truncatedOperations: metric.truncatedOperations,
                truncatedCalls: metric.truncatedCalls ?? 0,
                truncationRate:
                    metric.batchCalls > 0 ? Number(((metric.truncatedCalls ?? 0) / metric.batchCalls).toFixed(4)) : 0,
                continuationCalls: metric.continuationCalls,
                continuationRate:
                    metric.batchCalls > 0 ? Number((metric.continuationCalls / metric.batchCalls).toFixed(4)) : 0,
                failedOperations: metric.failedOperations ?? 0,
                skippedOperations: metric.skippedOperations ?? 0,
                repeatAfterBatch: repeat,
            };
        })
        .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderPayloadByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({
            tool,
            calls: metric.calls,
            resultBytes: metric.resultBytes,
            textBytes: metric.textBytes,
            nonTextBytes: metric.nonTextBytes,
            duplicateTextBytes: metric.duplicateTextBytes,
            duplicateToResultRatio:
                metric.resultBytes > 0 ? Number((metric.duplicateTextBytes / metric.resultBytes).toFixed(4)) : 0,
        }))
        .sort((left, right) => right.resultBytes - left.resultBytes || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} cohorts @param {string} key @param {{causal:number;recoveryRequired:number;inlineNext:number;inlineAnchor:number}} value */
function mergeFailureCohort(cohorts, key, value) {
    const current = cohorts.get(key) ?? { causal: 0, recoveryRequired: 0, inlineNext: 0, inlineAnchor: 0 };
    current.causal += value.causal;
    current.recoveryRequired += value.recoveryRequired;
    current.inlineNext += value.inlineNext;
    current.inlineAnchor += value.inlineAnchor;
    cohorts.set(key, current);
}

/** @param {Map<string, any>} cohorts */
function renderFailureCohorts(cohorts) {
    return Object.fromEntries(
        [...cohorts.entries()]
            .sort((left, right) => Number(right[1]?.causal ?? 0) - Number(left[1]?.causal ?? 0))
            .map(([key, value]) => [
                key,
                {
                    ...value,
                    inlineNextActionCoverage:
                        value.causal > 0 ? Number((value.inlineNext / value.causal).toFixed(4)) : null,
                    inlineRecoveryAnchorCoverage:
                        value.causal > 0 ? Number((value.inlineAnchor / value.causal).toFixed(4)) : null,
                },
            ]),
    );
}

/** @param {Map<string, number>} cohorts @param {string} key */
function mergeRuntimeCohort(cohorts, key) {
    cohorts.set(key, (cohorts.get(key) ?? 0) + 1);
}

/** @param {Record<string, unknown>} row */
function cohortKey(row) {
    const fingerprint = stringOrNull(row['runtime_source_fingerprint'] ?? row['runtimeSourceFingerprint']);
    if (fingerprint) return `source:${fingerprint}`;
    const epoch = stringOrNull(row['runtime_epoch_id'] ?? row['runtimeEpochId']);
    return epoch ? `epoch:${epoch}` : 'unknown';
}

/** @param {unknown} value */
function parseStringSet(value) {
    if (typeof value !== 'string' || value.length === 0) return new Set();
    try {
        const parsed = JSON.parse(value);
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 64) : []);
    } catch {
        return new Set();
    }
}

/**
 * @param {{
 *   planThenApplyCount:number; validatorPollCount:number; patchThenValidatorTransitions:number;
 *   compositePostValidationCount:number; gitGranularCalls:number; gitOneShotCalls:number;
 *   temporalRecoveryWithInspectionCount:number; inlineNextActionTargetCount:number;
 * }} evidence
 */
function buildRoundTripOptimizationEvidence(evidence) {
    /** @type {{mechanism:string;observedCount:number;evidence:string;caveat:string}[]} */
    const existingMechanisms = [];
    if (evidence.planThenApplyCount > 0)
        existingMechanisms.push({
            mechanism: 'direct-governed-apply',
            observedCount: evidence.planThenApplyCount,
            evidence: 'temporal plan→apply pressure observed',
            caveat: 'Keep plan calls when preview, destructive-risk review or a separate approval boundary is intentional.',
        });
    if (evidence.patchThenValidatorTransitions > 0)
        existingMechanisms.push({
            mechanism: 'repo_apply_patch_batch.postValidation',
            observedCount: evidence.patchThenValidatorTransitions,
            evidence: 'temporal patch→validator pressure observed',
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
    if (evidence.temporalRecoveryWithInspectionCount > 0)
        existingMechanisms.push({
            mechanism: 'inline-causal-next-action/recovery-evidence',
            observedCount: evidence.temporalRecoveryWithInspectionCount,
            evidence: `temporal failure→inspection→retry pressure observed; inline next-actions indexed=${String(evidence.inlineNextActionTargetCount)}`,
            caveat: 'Only lineageBound recovery may be treated as causal; bounded rereads remain correct when evidence is insufficient.',
        });
    return {
        newCompositeRecommendation: 'none-from-analytics-alone',
        existingMechanisms,
        caveat: 'Temporal pressure only ranks investigation targets. Lineage and semantic review are required before classifying a round trip as avoidable.',
    };
}

/**
 * @param {unknown} value
 * @returns {Map<string, number>}
 */
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

/** @param {number[]} values */
function integerHistogram(values) {
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return Object.fromEntries(
        [...counts.entries()].sort(([left], [right]) => left - right).map(([value, count]) => [String(value), count]),
    );
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value */
function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** @param {unknown} value */
function nonNegativeIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
