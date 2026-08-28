// @ts-check
/** Lineage-aware temporal/recovery/workflow summary over normalized MCP round-trip event rows. */

import { MCP_ROUND_TRIP_NORMALIZER_VERSION, MCP_TOOL_CALL_TERMINAL_EVENTS } from './normalizer.js';

const RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_INTERACTIVE_TRANSITION_GAP_MS = 5 * 60 * 1000;
const HEAVY_RESULT_THRESHOLD_BYTES = 64 * 1024;
// Includes retired repo_file_stats only to interpret historical audit cohorts; current stat inspection is
// repo_bulk_inspect(single={op:'stat',...}).
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
 *   continuationAvailable: boolean;
 *   continuationTransportRequired: boolean;
 *   continuationRecommended: boolean;
 *   legacyContinuationRequired: boolean;
 *   resultBytes: number;
 *   resultState: string | null;
 *   resultClass: string | null;
 *   resultCode: string | null;
 *   terminalEvent: string | null;
 *   failureClass: string | null;
 *   retryability: string | null;
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
 *
 * @typedef {{ failureClass: string | null; retryability: string | null; resultCode: string | null }} FailureSignal
 * @typedef {{
 *   callId: string;
 *   tool: string;
 *   tsMs: number;
 *   traceKey: string;
 *   targetPrecision: string | null;
 *   targetKeys: Set<string>;
 *   resultClass: string | null;
 *   resultCode: string | null;
 *   terminalEvent: string | null;
 *   failureClass: string | null;
 *   retryability: string | null;
 *   interveningCalls: number;
 * }} RetryCandidate
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

    /** Failure→repeat evidence is stricter than generic temporal/recovery pressure. */
    /** @type {Map<string, FailureSignal>} */
    const failureSignalsByCallId = new Map();
    /** @type {RetryCandidate[]} */
    const retryCandidates = [];
    let retryCandidateWithLineageCount = 0;
    let retryCandidateWithoutLineageCount = 0;
    let temporalFailureSameToolRepeatCount = 0;
    let temporalFailureSameExactTargetRepeatCount = 0;
    let temporalFailureRepeatGapMs = 0;
    let lineageFailureSameToolRepeatCount = 0;
    let lineageFailureSameToolRepeatGapMs = 0;
    let lineageFailureTargetOverlapRepeatCount = 0;
    let retryTaxCalls = 0;
    let retryTaxGapMs = 0;
    let retryTaxInterveningCalls = 0;
    const retryTaxByTool = new Map();
    const retryTaxByFailureSignalClass = new Map();
    const retryTaxByResultCode = new Map();
    const lineageRepeatByFailureSignalClass = new Map();

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
    const executionPolicyClasses = new Map();
    const executionFailurePolicyClasses = new Map();
    const executionConcurrencyClasses = new Map();
    const executionPoliciesByTool = new Map();
    const executionPolicyCohorts = new Map();
    let executionPolicyEligibleCalls = 0;
    let executionPolicyObservedCalls = 0;
    const payloadByTool = new Map();
    const resultStates = new Map();
    const resultClasses = new Map();
    const resultCodes = new Map();
    const resultOutcomesByTool = new Map();
    const resultOutcomeCohorts = new Map();
    const recoveryRecipesByTool = new Map();
    let recoveryRecipeCalls = 0;
    let recoveryRecipeCount = 0;
    let retrySafeRecoveryRecipeCount = 0;
    let suggestedRecoveryRecipeCount = 0;
    let manualRecoveryRecipeCount = 0;
    let noRetryRecoveryRecipeCount = 0;
    const exactSelfRepairByTool = new Map();
    let exactSelfRepairCalls = 0;
    let exactSelfRepairAttemptedCount = 0;
    let exactSelfRepairSucceededCount = 0;
    let exactSelfRepairFailedClosedCount = 0;
    const optionPoliciesByTool = new Map();
    const optionPolicyCohorts = new Map();
    const optionPolicyVersions = new Map();
    const optionPolicyModes = new Map();
    let optionPolicyObservedCalls = 0;
    let optionPolicyRequestedOptions = 0;
    let optionPolicyEffectiveRequestedOptions = 0;
    let optionPolicyDefaultedOptions = 0;
    let optionPolicyNormalizedEvents = 0;
    let optionPolicyIgnoredOptions = 0;
    let optionPolicyCoercedOptions = 0;
    let optionPolicyRejectedOptions = 0;
    let optionPolicyConflictEvents = 0;
    let optionPolicyNormalizedCalls = 0;
    let optionPolicyIgnoredCalls = 0;
    let optionPolicyCoercedCalls = 0;
    let optionPolicyRejectedCalls = 0;
    let optionPolicyConflictCalls = 0;
    let resultCompletedCalls = 0;
    let observedResultOutcomeCalls = 0;
    let resultCodedCalls = 0;
    let resultFailureCalls = 0;
    let optionConfigFailures = 0;
    let preconditionFailures = 0;
    let domainOrUnknownFailures = 0;
    let uncodedFailures = 0;
    let executionCompletedCalls = 0;
    let executionAccountedCalls = 0;
    let totalLogicalOperations = 0;
    let totalCoalescedLogicalOperations = 0;
    let totalBatchCalls = 0;
    let totalSaturatedBatchCalls = 0;
    let totalTruncatedOperations = 0;
    let totalContinuationAvailableCalls = 0;
    let totalContinuationAvailableOperations = 0;
    let totalContinuationTransportRequiredCalls = 0;
    let totalContinuationTransportRequiredOperations = 0;
    let totalContinuationRecommendedCalls = 0;
    let totalContinuationRecommendedOperations = 0;
    let totalLegacyContinuationRequiredCalls = 0;
    const repeatAfterBatch = {
        unsaturatedComplete: 0,
        saturated: 0,
        truncated: 0,
        transportRequired: 0,
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
            const failureCallId = stringOrNull(row['call_id'] ?? row['callId']);
            if (failureCallId) {
                failureSignalsByCallId.set(failureCallId, {
                    failureClass:
                        stringOrNull(row['failure_class'] ?? row['failureClass']) ?? singleCountMapKey(failureClassMap),
                    retryability: stringOrNull(row['retryability']) ?? singleCountMapKey(retryabilityMap),
                    resultCode: stringOrNull(row['code']) ?? singleCountMapKey(causalCodeCounts),
                });
            }

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
            recordOptionPolicy(row, tool);
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
            processRetryCandidateStart(start);
            continue;
        }

        if (MCP_TOOL_CALL_TERMINAL_EVENTS.includes(event) && tool) {
            terminalCallCount += 1;
            const terminal = readCallEvidence(row, tool, tsMs, event);
            if (event === 'tool_call_completed') {
                recordResultOutcome(row, tool);
                recordRecoveryRecipes(row, tool);
                recordExactSelfRepair(row, tool);
                recordExecutionCompletion(row, tool);
            }
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
            const failureSignal = failureSignalsByCallId.get(terminal.callId) ?? null;
            const completion = mergeCallEvidence(start, terminal, failureSignal);
            failureSignalsByCallId.delete(terminal.callId);
            if (isFailedCallEvidence(completion)) registerRetryCandidate(completion);
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
        resultOutcomes: {
            authority: 'sanitized-tool-completion-result-metadata-v5',
            completedCalls: resultCompletedCalls,
            observedOutcomeCalls: observedResultOutcomeCalls,
            outcomeCoverageRate:
                resultCompletedCalls > 0
                    ? Number((observedResultOutcomeCalls / resultCompletedCalls).toFixed(4))
                    : null,
            codedCalls: resultCodedCalls,
            failureCalls: resultFailureCalls,
            optionConfigFailures,
            preconditionFailures,
            domainOrUnknownFailures,
            uncodedFailures,
            optionErrorRate:
                observedResultOutcomeCalls > 0
                    ? Number((optionConfigFailures / observedResultOutcomeCalls).toFixed(4))
                    : null,
            optionErrorShareOfFailures:
                resultFailureCalls > 0 ? Number((optionConfigFailures / resultFailureCalls).toFixed(4)) : null,
            byState: mapToObject(resultStates),
            byClass: mapToObject(resultClasses),
            byCode: mapToObject(resultCodes),
            byTool: renderResultOutcomeByTool(resultOutcomesByTool, options.top),
            byRuntimeCohort: renderResultOutcomeCohorts(resultOutcomeCohorts),
            caveat: 'Outcome fields are authoritative only for completions emitted after the v5 registry rollout. Replayed historical completions that never persisted result outcome metadata remain explicitly unobserved and are excluded from optionErrorRate.',
        },
        recoveryRecipes: {
            authority: 'bounded-recovery-recipe-disposition-counts-from-tool-completion-metadata-v8',
            callsWithRecipe: recoveryRecipeCalls,
            recipeCount: recoveryRecipeCount,
            retrySafeCount: retrySafeRecoveryRecipeCount,
            suggestedCount: suggestedRecoveryRecipeCount,
            manualCount: manualRecoveryRecipeCount,
            noRetryCount: noRetryRecoveryRecipeCount,
            byTool: renderRecoveryRecipesByTool(recoveryRecipesByTool, options.top),
            caveat: 'Only recipe counts/dispositions are persisted. Invocation tool names, arguments, paths, source text and Git state are excluded from the audit/index.',
        },
        exactSelfRepair: {
            authority: 'bounded-exact-patch-self-repair-counts-from-tool-completion-metadata-v9',
            callsWithAttempt: exactSelfRepairCalls,
            attemptedCount: exactSelfRepairAttemptedCount,
            succeededCount: exactSelfRepairSucceededCount,
            failedClosedCount: exactSelfRepairFailedClosedCount,
            successRate: ratio(exactSelfRepairSucceededCount, exactSelfRepairAttemptedCount),
            failedClosedRate: ratio(exactSelfRepairFailedClosedCount, exactSelfRepairAttemptedCount),
            byTool: renderExactSelfRepairByTool(exactSelfRepairByTool, options.top),
            caveat: 'Only bounded attempt/success/fail-closed counts emitted after the v9 rollout are persisted. Recovery anchors, hashes, paths, source text, reason strings and invocation arguments are excluded from the audit/index.',
        },
        optionPolicies: {
            authority: 'sanitized-request-option-contract-metadata-v6',
            observedCalls: optionPolicyObservedCalls,
            requestedOptions: optionPolicyRequestedOptions,
            effectiveRequestedOptions: optionPolicyEffectiveRequestedOptions,
            defaultedOptions: optionPolicyDefaultedOptions,
            normalizedEvents: optionPolicyNormalizedEvents,
            ignoredOptions: optionPolicyIgnoredOptions,
            coercedOptions: optionPolicyCoercedOptions,
            rejectedOptions: optionPolicyRejectedOptions,
            conflictEvents: optionPolicyConflictEvents,
            normalizedCalls: optionPolicyNormalizedCalls,
            ignoredCalls: optionPolicyIgnoredCalls,
            coercedCalls: optionPolicyCoercedCalls,
            rejectedCalls: optionPolicyRejectedCalls,
            conflictCalls: optionPolicyConflictCalls,
            normalizedCallRate: ratio(optionPolicyNormalizedCalls, optionPolicyObservedCalls),
            ignoredCallRate: ratio(optionPolicyIgnoredCalls, optionPolicyObservedCalls),
            coercionCallRate: ratio(optionPolicyCoercedCalls, optionPolicyObservedCalls),
            rejectionCallRate: ratio(optionPolicyRejectedCalls, optionPolicyObservedCalls),
            conflictCallRate: ratio(optionPolicyConflictCalls, optionPolicyObservedCalls),
            ignoredRequestedOptionRate: ratio(optionPolicyIgnoredOptions, optionPolicyRequestedOptions),
            byContractVersion: mapToObject(optionPolicyVersions),
            byMode: mapToObject(optionPolicyModes),
            byTool: renderOptionPolicyByTool(optionPoliciesByTool, options.top),
            byRuntimeCohort: renderOptionPolicyCohorts(optionPolicyCohorts),
            caveat: 'Only v6 tool_call_started rows emitted by tools enrolled in the Option Contract SSOT carry option-policy metadata. Rates use observed policy calls as the call denominator; unenrolled and pre-v6 starts are not treated as implicit zero-error calls.',
        },
        retryTax: {
            authority: 'failure-completion-to-first-same-tool-repeat-with-sanitized-lineage-v6',
            windowMs: RECOVERY_WINDOW_MS,
            retryTaxCalls,
            retryTaxGapMs,
            retryTaxAverageGapMs: retryTaxCalls > 0 ? Math.round(retryTaxGapMs / retryTaxCalls) : 0,
            retryTaxInterveningCalls,
            byTool: mapToObject(retryTaxByTool),
            byFailureSignalClass: mapToObject(retryTaxByFailureSignalClass),
            byResultCode: mapToObject(retryTaxByResultCode),
            temporalPressure: {
                sameToolAdjacentAfterFailureCount: temporalFailureSameToolRepeatCount,
                sameExactTargetAdjacentAfterFailureCount: temporalFailureSameExactTargetRepeatCount,
                totalGapMs: temporalFailureRepeatGapMs,
                caveat: 'Quiescent temporal adjacency only; without matching lineage it is repeat pressure, not retry tax.',
            },
            lineageBound: {
                candidateWithLineageCount: retryCandidateWithLineageCount,
                candidateWithoutLineageCount: retryCandidateWithoutLineageCount,
                sameToolRepeatCount: lineageFailureSameToolRepeatCount,
                sameToolRepeatGapMs: lineageFailureSameToolRepeatGapMs,
                targetOverlapRepeatCount: lineageFailureTargetOverlapRepeatCount,
                byFailureSignalClass: mapToObject(lineageRepeatByFailureSignalClass),
                pendingCandidateCount: retryCandidates.length,
            },
            caveat: 'retryTaxCalls requires same sanitized trace, same tool, exact-single target identity on both calls and target overlap. Same-tool lineage repeats without exact target identity remain pressure only.',
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
            continuationAvailableCalls: totalContinuationAvailableCalls,
            continuationAvailableOperations: totalContinuationAvailableOperations,
            continuationTransportRequiredCalls: totalContinuationTransportRequiredCalls,
            continuationTransportRequiredOperations: totalContinuationTransportRequiredOperations,
            continuationRecommendedCalls: totalContinuationRecommendedCalls,
            continuationRecommendedOperations: totalContinuationRecommendedOperations,
            legacyContinuationRequiredCalls: totalLegacyContinuationRequiredCalls,
            repeatAfterBatch,
            caveat: 'Only continuationTransportRequired represents result data omitted by the batch transport budget. Availability/recommendation do not imply another model→tool round trip is required; legacyContinuationRequired is historical v6 metadata and is excluded from induced-continuation metrics.',
            byTool: renderExecutionByTool(executionByTool, repeatAfterBatchByTool, options.top),
        },
        executionPolicies: {
            authority: 'sanitized-effective-execution-policy-metadata-v11',
            eligibleCalls: executionPolicyEligibleCalls,
            observedCalls: executionPolicyObservedCalls,
            coverageRate: ratio(executionPolicyObservedCalls, executionPolicyEligibleCalls),
            byPolicyClass: mapToObject(executionPolicyClasses),
            byFailurePolicyClass: mapToObject(executionFailurePolicyClasses),
            byConcurrencyClass: mapToObject(executionConcurrencyClasses),
            byTool: renderExecutionPolicyByTool(executionPoliciesByTool, options.top),
            byRuntimeCohort: renderExecutionPolicyCohorts(executionPolicyCohorts),
            caveat: 'Only repo_apply_patch_batch completions emitted with v11 effective-policy metadata are observed. Pre-v11 completions are retained as eligible-but-unobserved and are never inferred from request args, defaults or executionMode strings. Exact concurrency, targets, paths, patches and free-form args are not persisted.',
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
        if (isFailedCallEvidence(previous) && previous.tool === current.tool) {
            temporalFailureSameToolRepeatCount += 1;
            temporalFailureRepeatGapMs += gapMs;
            if (
                previous.targetPrecision === 'exact-single' &&
                current.targetPrecision === 'exact-single' &&
                hasTargetOverlap(previous.targetKeys, current.targetKeys)
            ) {
                temporalFailureSameExactTargetRepeatCount += 1;
            }
        }
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
                transportRequired: 0,
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

    /** @param {CallEvidence} completion */
    function registerRetryCandidate(completion) {
        if (!completion.callId) return;
        if (!completion.traceKey) {
            retryCandidateWithoutLineageCount += 1;
            return;
        }
        retryCandidateWithLineageCount += 1;
        retryCandidates.push({
            callId: completion.callId,
            tool: completion.tool,
            tsMs: completion.tsMs,
            traceKey: completion.traceKey,
            targetPrecision: completion.targetPrecision,
            targetKeys: completion.targetKeys,
            resultClass: completion.resultClass,
            resultCode: completion.resultCode,
            terminalEvent: completion.terminalEvent,
            failureClass: completion.failureClass,
            retryability: completion.retryability,
            interveningCalls: 0,
        });
    }

    /** @param {CallEvidence} start */
    function processRetryCandidateStart(start) {
        expireRetryCandidates(retryCandidates, start.tsMs);
        if (!start.traceKey) return;
        for (const candidate of retryCandidates) {
            if (candidate.traceKey !== start.traceKey || start.tsMs <= candidate.tsMs) continue;
            if (candidate.tool !== start.tool) candidate.interveningCalls += 1;
        }
        for (let index = retryCandidates.length - 1; index >= 0; index -= 1) {
            const candidate = retryCandidates[index];
            if (
                !candidate ||
                candidate.traceKey !== start.traceKey ||
                candidate.tool !== start.tool ||
                start.tsMs <= candidate.tsMs
            ) {
                continue;
            }
            const gapMs = Math.max(0, start.tsMs - candidate.tsMs);
            lineageFailureSameToolRepeatCount += 1;
            lineageFailureSameToolRepeatGapMs += gapMs;
            const signalClass = classifyRetryFailureSignal(candidate);
            increment(lineageRepeatByFailureSignalClass, signalClass);
            const targetOverlap = hasTargetOverlap(candidate.targetKeys, start.targetKeys);
            if (targetOverlap) lineageFailureTargetOverlapRepeatCount += 1;
            const exactSameTarget =
                candidate.targetPrecision === 'exact-single' &&
                start.targetPrecision === 'exact-single' &&
                targetOverlap;
            if (exactSameTarget) {
                retryTaxCalls += 1;
                retryTaxGapMs += gapMs;
                retryTaxInterveningCalls += candidate.interveningCalls;
                increment(retryTaxByTool, candidate.tool);
                increment(retryTaxByFailureSignalClass, signalClass);
                if (candidate.resultCode) increment(retryTaxByResultCode, candidate.resultCode);
            }
            retryCandidates.splice(index, 1);
            break;
        }
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordOptionPolicy(row, toolName) {
        const coverage = stringOrNull(row['option_policy_coverage'] ?? row['optionPolicyCoverage']);
        if (coverage !== 'complete') return;
        const version = stringOrNull(row['option_contract_version'] ?? row['optionContractVersion']) ?? 'unknown';
        const mode = stringOrNull(row['option_mode'] ?? row['optionMode']) ?? 'unknown';
        const requested = nonNegativeIntegerOrNull(row['option_requested_count'] ?? row['optionRequestedCount']) ?? 0;
        const effectiveRequested =
            nonNegativeIntegerOrNull(row['option_effective_requested_count'] ?? row['optionEffectiveRequestedCount']) ??
            0;
        const defaulted = nonNegativeIntegerOrNull(row['option_defaulted_count'] ?? row['optionDefaultedCount']) ?? 0;
        const normalized =
            nonNegativeIntegerOrNull(row['option_normalized_count'] ?? row['optionNormalizedCount']) ?? 0;
        const ignored = nonNegativeIntegerOrNull(row['option_ignored_count'] ?? row['optionIgnoredCount']) ?? 0;
        const coerced = nonNegativeIntegerOrNull(row['option_coerced_count'] ?? row['optionCoercedCount']) ?? 0;
        const rejected = nonNegativeIntegerOrNull(row['option_rejected_count'] ?? row['optionRejectedCount']) ?? 0;
        const conflicts = nonNegativeIntegerOrNull(row['option_conflict_count'] ?? row['optionConflictCount']) ?? 0;
        const toolMetric = requireOptionPolicyMetric(optionPoliciesByTool, toolName);
        const cohortMetric = requireOptionPolicyMetric(optionPolicyCohorts, cohortKey(row));
        optionPolicyObservedCalls += 1;
        optionPolicyRequestedOptions += requested;
        optionPolicyEffectiveRequestedOptions += effectiveRequested;
        optionPolicyDefaultedOptions += defaulted;
        optionPolicyNormalizedEvents += normalized;
        optionPolicyIgnoredOptions += ignored;
        optionPolicyCoercedOptions += coerced;
        optionPolicyRejectedOptions += rejected;
        optionPolicyConflictEvents += conflicts;
        if (normalized > 0) optionPolicyNormalizedCalls += 1;
        if (ignored > 0) optionPolicyIgnoredCalls += 1;
        if (coerced > 0) optionPolicyCoercedCalls += 1;
        if (rejected > 0) optionPolicyRejectedCalls += 1;
        if (conflicts > 0) optionPolicyConflictCalls += 1;
        increment(optionPolicyVersions, version);
        increment(optionPolicyModes, mode);
        mergeOptionPolicyMetric(toolMetric, {
            mode,
            requested,
            effectiveRequested,
            defaulted,
            normalized,
            ignored,
            coerced,
            rejected,
            conflicts,
        });
        mergeOptionPolicyMetric(cohortMetric, {
            mode,
            requested,
            effectiveRequested,
            defaulted,
            normalized,
            ignored,
            coerced,
            rejected,
            conflicts,
        });
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordResultOutcome(row, toolName) {
        resultCompletedCalls += 1;
        const state = stringOrNull(row['result_state'] ?? row['resultState']);
        const resultClassRaw = stringOrNull(row['result_class'] ?? row['resultClass']);
        const code = stringOrNull(row['result_code'] ?? row['resultCode']);
        const cohort = cohortKey(row);
        const toolMetric = requireResultOutcomeMetric(resultOutcomesByTool, toolName);
        const cohortMetric = requireResultOutcomeMetric(resultOutcomeCohorts, cohort);
        toolMetric.calls += 1;
        cohortMetric.calls += 1;

        if (!state) {
            increment(resultStates, 'unobserved');
            increment(toolMetric.states, 'unobserved');
            increment(cohortMetric.states, 'unobserved');
            toolMetric.unobservedCalls += 1;
            cohortMetric.unobservedCalls += 1;
            return;
        }

        observedResultOutcomeCalls += 1;
        toolMetric.observedCalls += 1;
        cohortMetric.observedCalls += 1;
        increment(resultStates, state);
        increment(toolMetric.states, state);
        increment(cohortMetric.states, state);
        if (code) {
            resultCodedCalls += 1;
            toolMetric.codedCalls += 1;
            cohortMetric.codedCalls += 1;
            increment(resultCodes, code);
            increment(toolMetric.codes, code);
            increment(cohortMetric.codes, code);
        }

        const resultClass = resultClassRaw ?? (state === 'success' ? 'success' : 'domain-or-unknown');
        increment(resultClasses, resultClass);
        increment(toolMetric.classes, resultClass);
        increment(cohortMetric.classes, resultClass);
        if (state === 'success') return;

        resultFailureCalls += 1;
        toolMetric.failureCalls += 1;
        cohortMetric.failureCalls += 1;
        if (resultClass === 'option-config') {
            optionConfigFailures += 1;
            toolMetric.optionConfigFailures += 1;
            cohortMetric.optionConfigFailures += 1;
        } else if (resultClass === 'precondition') {
            preconditionFailures += 1;
            toolMetric.preconditionFailures += 1;
            cohortMetric.preconditionFailures += 1;
        } else if (resultClass === 'uncoded-failure') {
            uncodedFailures += 1;
            toolMetric.uncodedFailures += 1;
            cohortMetric.uncodedFailures += 1;
        } else {
            domainOrUnknownFailures += 1;
            toolMetric.domainOrUnknownFailures += 1;
            cohortMetric.domainOrUnknownFailures += 1;
        }
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordRecoveryRecipes(row, toolName) {
        const total = nonNegativeIntegerOrNull(row['recovery_recipe_count'] ?? row['recoveryRecipeCount']) ?? 0;
        if (total <= 0) return;
        const retrySafe =
            nonNegativeIntegerOrNull(row['retry_safe_recovery_recipe_count'] ?? row['retrySafeRecoveryRecipeCount']) ??
            0;
        const suggested =
            nonNegativeIntegerOrNull(row['suggested_recovery_recipe_count'] ?? row['suggestedRecoveryRecipeCount']) ??
            0;
        const manual =
            nonNegativeIntegerOrNull(row['manual_recovery_recipe_count'] ?? row['manualRecoveryRecipeCount']) ?? 0;
        const noRetry =
            nonNegativeIntegerOrNull(row['no_retry_recovery_recipe_count'] ?? row['noRetryRecoveryRecipeCount']) ?? 0;
        recoveryRecipeCalls += 1;
        recoveryRecipeCount += total;
        retrySafeRecoveryRecipeCount += retrySafe;
        suggestedRecoveryRecipeCount += suggested;
        manualRecoveryRecipeCount += manual;
        noRetryRecoveryRecipeCount += noRetry;
        const metric = recoveryRecipesByTool.get(toolName) ?? {
            callsWithRecipe: 0,
            recipeCount: 0,
            retrySafeCount: 0,
            suggestedCount: 0,
            manualCount: 0,
            noRetryCount: 0,
        };
        metric.callsWithRecipe += 1;
        metric.recipeCount += total;
        metric.retrySafeCount += retrySafe;
        metric.suggestedCount += suggested;
        metric.manualCount += manual;
        metric.noRetryCount += noRetry;
        recoveryRecipesByTool.set(toolName, metric);
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordExactSelfRepair(row, toolName) {
        const attempted =
            nonNegativeIntegerOrNull(
                row['exact_self_repair_attempted_count'] ?? row['exactSelfRepairAttemptedCount'],
            ) ?? 0;
        if (attempted <= 0) return;
        const succeeded =
            nonNegativeIntegerOrNull(
                row['exact_self_repair_succeeded_count'] ?? row['exactSelfRepairSucceededCount'],
            ) ?? 0;
        const failedClosed =
            nonNegativeIntegerOrNull(
                row['exact_self_repair_failed_closed_count'] ?? row['exactSelfRepairFailedClosedCount'],
            ) ?? 0;
        exactSelfRepairCalls += 1;
        exactSelfRepairAttemptedCount += attempted;
        exactSelfRepairSucceededCount += Math.min(attempted, succeeded);
        exactSelfRepairFailedClosedCount += Math.min(attempted, failedClosed);
        const metric = exactSelfRepairByTool.get(toolName) ?? {
            callsWithAttempt: 0,
            attemptedCount: 0,
            succeededCount: 0,
            failedClosedCount: 0,
        };
        metric.callsWithAttempt += 1;
        metric.attemptedCount += attempted;
        metric.succeededCount += Math.min(attempted, succeeded);
        metric.failedClosedCount += Math.min(attempted, failedClosed);
        exactSelfRepairByTool.set(toolName, metric);
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordExecutionPolicy(row, toolName) {
        if (toolName !== 'repo_apply_patch_batch') return;
        executionPolicyEligibleCalls += 1;
        const policyClass = stringOrNull(row['execution_policy_class'] ?? row['executionPolicyClass']);
        const failurePolicyClass = stringOrNull(
            row['execution_failure_policy_class'] ?? row['executionFailurePolicyClass'],
        );
        const concurrencyClass = stringOrNull(row['execution_concurrency_class'] ?? row['executionConcurrencyClass']);
        if (!policyClass || !failurePolicyClass || !concurrencyClass) return;
        executionPolicyObservedCalls += 1;
        increment(executionPolicyClasses, policyClass);
        increment(executionFailurePolicyClasses, failurePolicyClass);
        increment(executionConcurrencyClasses, concurrencyClass);
        mergeExecutionPolicyMetric(
            requireExecutionPolicyMetric(executionPoliciesByTool, toolName),
            policyClass,
            failurePolicyClass,
            concurrencyClass,
        );
        mergeExecutionPolicyMetric(
            requireExecutionPolicyMetric(executionPolicyCohorts, cohortKey(row)),
            policyClass,
            failurePolicyClass,
            concurrencyClass,
        );
    }

    /** @param {Record<string, unknown>} row @param {string} toolName */
    function recordExecutionCompletion(row, toolName) {
        executionCompletedCalls += 1;
        recordExecutionPolicy(row, toolName);
        const logicalOperations = positiveIntegerOrNull(row['logical_operations'] ?? row['logicalOperations']);
        const failedOperations = nonNegativeIntegerOrNull(row['failed_operations'] ?? row['failedOperations']) ?? 0;
        const skippedOperations = nonNegativeIntegerOrNull(row['skipped_operations'] ?? row['skippedOperations']) ?? 0;
        const batchSize = positiveIntegerOrNull(row['batch_size'] ?? row['batchSize']);
        const batchCapacity = positiveIntegerOrNull(row['batch_capacity'] ?? row['batchCapacity']);
        const truncatedOperations =
            nonNegativeIntegerOrNull(row['truncated_operations'] ?? row['truncatedOperations']) ?? 0;
        const continuationAvailable = Number(row['continuation_available'] ?? row['continuationAvailable']) === 1;
        const continuationAvailableOperations =
            nonNegativeIntegerOrNull(
                row['continuation_available_operations'] ?? row['continuationAvailableOperations'],
            ) ?? 0;
        const continuationTransportRequired =
            Number(row['continuation_transport_required'] ?? row['continuationTransportRequired']) === 1;
        const continuationTransportRequiredOperations =
            nonNegativeIntegerOrNull(
                row['continuation_transport_required_operations'] ?? row['continuationTransportRequiredOperations'],
            ) ?? 0;
        const continuationRecommended = Number(row['continuation_recommended'] ?? row['continuationRecommended']) === 1;
        const continuationRecommendedOperations =
            nonNegativeIntegerOrNull(
                row['continuation_recommended_operations'] ?? row['continuationRecommendedOperations'],
            ) ?? 0;
        const legacyContinuationRequired =
            Number(row['continuation_required'] ?? row['legacyContinuationRequired']) === 1;
        const effectiveLogicalOperations = logicalOperations ?? 1;
        if (logicalOperations !== null) executionAccountedCalls += 1;
        totalLogicalOperations += effectiveLogicalOperations;
        totalCoalescedLogicalOperations += Math.max(0, effectiveLogicalOperations - 1);
        if ((batchSize ?? 0) > 1) totalBatchCalls += 1;
        if (batchSize !== null && batchCapacity !== null && batchSize >= batchCapacity) totalSaturatedBatchCalls += 1;
        totalTruncatedOperations += truncatedOperations;
        if (continuationAvailable) totalContinuationAvailableCalls += 1;
        totalContinuationAvailableOperations += continuationAvailableOperations;
        if (continuationTransportRequired) totalContinuationTransportRequiredCalls += 1;
        totalContinuationTransportRequiredOperations += continuationTransportRequiredOperations;
        if (continuationRecommended) totalContinuationRecommendedCalls += 1;
        totalContinuationRecommendedOperations += continuationRecommendedOperations;
        if (legacyContinuationRequired) totalLegacyContinuationRequiredCalls += 1;

        const metric = executionByTool.get(toolName) ?? {
            calls: 0,
            accountedCalls: 0,
            logicalOperations: 0,
            coalescedLogicalOperations: 0,
            batchCalls: 0,
            saturatedBatchCalls: 0,
            truncatedOperations: 0,
            continuationAvailableCalls: 0,
            continuationAvailableOperations: 0,
            continuationTransportRequiredCalls: 0,
            continuationTransportRequiredOperations: 0,
            continuationRecommendedCalls: 0,
            continuationRecommendedOperations: 0,
            legacyContinuationRequiredCalls: 0,
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
        if (continuationAvailable) metric.continuationAvailableCalls += 1;
        metric.continuationAvailableOperations += continuationAvailableOperations;
        if (continuationTransportRequired) metric.continuationTransportRequiredCalls += 1;
        metric.continuationTransportRequiredOperations += continuationTransportRequiredOperations;
        if (continuationRecommended) metric.continuationRecommendedCalls += 1;
        metric.continuationRecommendedOperations += continuationRecommendedOperations;
        if (legacyContinuationRequired) metric.legacyContinuationRequiredCalls += 1;
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
    const completeness = {
        rowsEligible: 0,
        rowsAnalyzed: 0,
        maxRows: 0,
        truncated: false,
        selection: 'unavailable',
        coverageRatio: 0,
    };
    const empty = summarizeMcpRoundTripRows([], {
        windowMs,
        top: 1,
        includeSynthetic,
        completeness,
    });
    return {
        available: false,
        ...empty,
        authority,
        completeness,
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

/**
 * @param {Record<string, unknown>} row
 * @param {string} tool
 * @param {number} tsMs
 * @param {string | null} [terminalEvent]
 * @returns {CallEvidence}
 */
function readCallEvidence(row, tool, tsMs, terminalEvent = null) {
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
        continuationAvailable: Number(row['continuation_available'] ?? row['continuationAvailable']) === 1,
        continuationTransportRequired:
            Number(row['continuation_transport_required'] ?? row['continuationTransportRequired']) === 1,
        continuationRecommended: Number(row['continuation_recommended'] ?? row['continuationRecommended']) === 1,
        legacyContinuationRequired: Number(row['continuation_required'] ?? row['legacyContinuationRequired']) === 1,
        resultBytes: nonNegativeIntegerOrNull(row['result_bytes'] ?? row['resultBytes']) ?? 0,
        resultState: stringOrNull(row['result_state'] ?? row['resultState']),
        resultClass: stringOrNull(row['result_class'] ?? row['resultClass']),
        resultCode: stringOrNull(row['result_code'] ?? row['resultCode']),
        terminalEvent,
        failureClass: stringOrNull(row['failure_class'] ?? row['failureClass']),
        retryability: stringOrNull(row['retryability']),
    };
}

/**
 * @param {CallEvidence} start
 * @param {CallEvidence} terminal
 * @param {FailureSignal | null} [failureSignal]
 * @returns {CallEvidence}
 */
function mergeCallEvidence(start, terminal, failureSignal = null) {
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
        continuationAvailable: terminal.continuationAvailable || start.continuationAvailable,
        continuationTransportRequired: terminal.continuationTransportRequired || start.continuationTransportRequired,
        continuationRecommended: terminal.continuationRecommended || start.continuationRecommended,
        legacyContinuationRequired: terminal.legacyContinuationRequired || start.legacyContinuationRequired,
        resultBytes: terminal.resultBytes || start.resultBytes,
        resultState: terminal.resultState ?? start.resultState,
        resultClass: terminal.resultClass ?? start.resultClass,
        resultCode: terminal.resultCode ?? failureSignal?.resultCode ?? start.resultCode,
        terminalEvent: terminal.terminalEvent ?? start.terminalEvent,
        failureClass: failureSignal?.failureClass ?? terminal.failureClass ?? start.failureClass,
        retryability: failureSignal?.retryability ?? terminal.retryability ?? start.retryability,
    };
}

/** @param {CallEvidence} previous */
/** @param {CallEvidence} call */
function isFailedCallEvidence(call) {
    if (call.failureClass || call.retryability) return true;
    if (call.terminalEvent && call.terminalEvent !== 'tool_call_completed') return true;
    return call.resultState !== null && call.resultState !== 'success';
}

/**
 * @param {{failureClass:string|null;resultClass:string|null;terminalEvent:string|null}} candidate
 */
function classifyRetryFailureSignal(candidate) {
    if (candidate.failureClass && !['unknown', 'unknown-or-legacy'].includes(candidate.failureClass)) {
        return candidate.failureClass;
    }
    if (candidate.resultClass === 'option-config') return 'shape/config';
    if (candidate.resultClass === 'precondition') return 'precondition';
    if (candidate.resultClass === 'uncoded-failure') return 'uncoded-failure';
    if (candidate.terminalEvent === 'tool_call_rate_limited') return 'transient-rate-limit';
    if (candidate.terminalEvent === 'tool_call_auth_denied') return 'manual-decision-auth';
    if (candidate.terminalEvent === 'tool_call_result_rejected') return 'result-contract';
    if (candidate.terminalEvent === 'tool_call_failed') return 'runtime-failure';
    return candidate.resultClass ?? 'domain-or-unknown';
}

/** @param {CallEvidence} previous */
function classifyRepeatAfterBatch(previous) {
    if (previous.continuationTransportRequired) return /** @type {const} */ ('transportRequired');
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

/** @param {RetryCandidate[]} candidates @param {number} nowMs */
function expireRetryCandidates(candidates, nowMs) {
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

/** @param {Map<string, any>} metrics @param {string} key */
function requireOptionPolicyMetric(metrics, key) {
    const existing = metrics.get(key);
    if (existing) return existing;
    const metric = {
        observedCalls: 0,
        requestedOptions: 0,
        effectiveRequestedOptions: 0,
        defaultedOptions: 0,
        normalizedEvents: 0,
        ignoredOptions: 0,
        coercedOptions: 0,
        rejectedOptions: 0,
        conflictEvents: 0,
        normalizedCalls: 0,
        ignoredCalls: 0,
        coercedCalls: 0,
        rejectedCalls: 0,
        conflictCalls: 0,
        modes: new Map(),
    };
    metrics.set(key, metric);
    return metric;
}

/** @param {any} metric @param {{mode:string;requested:number;effectiveRequested:number;defaulted:number;normalized:number;ignored:number;coerced:number;rejected:number;conflicts:number}} sample */
function mergeOptionPolicyMetric(metric, sample) {
    metric.observedCalls += 1;
    metric.requestedOptions += sample.requested;
    metric.effectiveRequestedOptions += sample.effectiveRequested;
    metric.defaultedOptions += sample.defaulted;
    metric.normalizedEvents += sample.normalized;
    metric.ignoredOptions += sample.ignored;
    metric.coercedOptions += sample.coerced;
    metric.rejectedOptions += sample.rejected;
    metric.conflictEvents += sample.conflicts;
    if (sample.normalized > 0) metric.normalizedCalls += 1;
    if (sample.ignored > 0) metric.ignoredCalls += 1;
    if (sample.coerced > 0) metric.coercedCalls += 1;
    if (sample.rejected > 0) metric.rejectedCalls += 1;
    if (sample.conflicts > 0) metric.conflictCalls += 1;
    increment(metric.modes, sample.mode);
}

/** @param {any} metric */
function projectOptionPolicyMetric(metric) {
    return {
        observedCalls: metric.observedCalls,
        requestedOptions: metric.requestedOptions,
        effectiveRequestedOptions: metric.effectiveRequestedOptions,
        defaultedOptions: metric.defaultedOptions,
        normalizedEvents: metric.normalizedEvents,
        ignoredOptions: metric.ignoredOptions,
        coercedOptions: metric.coercedOptions,
        rejectedOptions: metric.rejectedOptions,
        conflictEvents: metric.conflictEvents,
        normalizedCalls: metric.normalizedCalls,
        ignoredCalls: metric.ignoredCalls,
        coercedCalls: metric.coercedCalls,
        rejectedCalls: metric.rejectedCalls,
        conflictCalls: metric.conflictCalls,
        normalizedCallRate: ratio(metric.normalizedCalls, metric.observedCalls),
        ignoredCallRate: ratio(metric.ignoredCalls, metric.observedCalls),
        coercionCallRate: ratio(metric.coercedCalls, metric.observedCalls),
        rejectionCallRate: ratio(metric.rejectedCalls, metric.observedCalls),
        conflictCallRate: ratio(metric.conflictCalls, metric.observedCalls),
        ignoredRequestedOptionRate: ratio(metric.ignoredOptions, metric.requestedOptions),
        byMode: mapToObject(metric.modes),
    };
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderOptionPolicyByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({ tool, ...projectOptionPolicyMetric(metric) }))
        .sort((left, right) => right.observedCalls - left.observedCalls || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} cohorts */
function renderOptionPolicyCohorts(cohorts) {
    return Object.fromEntries(
        [...cohorts.entries()]
            .sort((left, right) => Number(right[1]?.observedCalls ?? 0) - Number(left[1]?.observedCalls ?? 0))
            .map(([key, metric]) => [key, projectOptionPolicyMetric(metric)]),
    );
}

/** @param {number} numerator @param {number} denominator */
function ratio(numerator, denominator) {
    return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

/** @param {Map<string, any>} metrics @param {string} key */
function requireResultOutcomeMetric(metrics, key) {
    const existing = metrics.get(key);
    if (existing) return existing;
    const metric = {
        calls: 0,
        observedCalls: 0,
        unobservedCalls: 0,
        codedCalls: 0,
        failureCalls: 0,
        optionConfigFailures: 0,
        preconditionFailures: 0,
        domainOrUnknownFailures: 0,
        uncodedFailures: 0,
        states: new Map(),
        classes: new Map(),
        codes: new Map(),
    };
    metrics.set(key, metric);
    return metric;
}

/** @param {any} metric */
function projectResultOutcomeMetric(metric) {
    return {
        calls: metric.calls,
        observedCalls: metric.observedCalls,
        unobservedCalls: metric.unobservedCalls,
        outcomeCoverageRate: metric.calls > 0 ? Number((metric.observedCalls / metric.calls).toFixed(4)) : null,
        codedCalls: metric.codedCalls,
        failureCalls: metric.failureCalls,
        optionConfigFailures: metric.optionConfigFailures,
        preconditionFailures: metric.preconditionFailures,
        domainOrUnknownFailures: metric.domainOrUnknownFailures,
        uncodedFailures: metric.uncodedFailures,
        optionErrorRate:
            metric.observedCalls > 0 ? Number((metric.optionConfigFailures / metric.observedCalls).toFixed(4)) : null,
        optionErrorShareOfFailures:
            metric.failureCalls > 0 ? Number((metric.optionConfigFailures / metric.failureCalls).toFixed(4)) : null,
        byState: mapToObject(metric.states),
        byClass: mapToObject(metric.classes),
        byCode: mapToObject(metric.codes),
    };
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderResultOutcomeByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({ tool, ...projectResultOutcomeMetric(metric) }))
        .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderRecoveryRecipesByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({ tool, ...metric }))
        .sort((left, right) => right.recipeCount - left.recipeCount || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderExactSelfRepairByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({
            tool,
            ...metric,
            successRate: ratio(metric.succeededCount, metric.attemptedCount),
            failedClosedRate: ratio(metric.failedClosedCount, metric.attemptedCount),
        }))
        .sort((left, right) => right.attemptedCount - left.attemptedCount || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} cohorts */
function renderResultOutcomeCohorts(cohorts) {
    return Object.fromEntries(
        [...cohorts.entries()]
            .sort((left, right) => Number(right[1]?.calls ?? 0) - Number(left[1]?.calls ?? 0))
            .map(([key, metric]) => [key, projectResultOutcomeMetric(metric)]),
    );
}

/** @param {Map<string, any>} metrics @param {string} key */
function requireExecutionPolicyMetric(metrics, key) {
    const existing = metrics.get(key);
    if (existing) return existing;
    const metric = {
        observedCalls: 0,
        policyClasses: new Map(),
        failurePolicyClasses: new Map(),
        concurrencyClasses: new Map(),
    };
    metrics.set(key, metric);
    return metric;
}

/** @param {any} metric @param {string} policyClass @param {string} failurePolicyClass @param {string} concurrencyClass */
function mergeExecutionPolicyMetric(metric, policyClass, failurePolicyClass, concurrencyClass) {
    metric.observedCalls += 1;
    increment(metric.policyClasses, policyClass);
    increment(metric.failurePolicyClasses, failurePolicyClass);
    increment(metric.concurrencyClasses, concurrencyClass);
}

/** @param {any} metric */
function projectExecutionPolicyMetric(metric) {
    return {
        observedCalls: metric.observedCalls,
        byPolicyClass: mapToObject(metric.policyClasses),
        byFailurePolicyClass: mapToObject(metric.failurePolicyClasses),
        byConcurrencyClass: mapToObject(metric.concurrencyClasses),
    };
}

/** @param {Map<string, any>} byTool @param {number} top */
function renderExecutionPolicyByTool(byTool, top) {
    return [...byTool.entries()]
        .map(([tool, metric]) => ({ tool, ...projectExecutionPolicyMetric(metric) }))
        .sort((left, right) => right.observedCalls - left.observedCalls || left.tool.localeCompare(right.tool))
        .slice(0, top);
}

/** @param {Map<string, any>} cohorts */
function renderExecutionPolicyCohorts(cohorts) {
    return Object.fromEntries(
        [...cohorts.entries()]
            .sort((left, right) => Number(right[1]?.observedCalls ?? 0) - Number(left[1]?.observedCalls ?? 0))
            .map(([key, metric]) => [key, projectExecutionPolicyMetric(metric)]),
    );
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
                continuationAvailableCalls: metric.continuationAvailableCalls,
                continuationAvailableOperations: metric.continuationAvailableOperations,
                continuationAvailableRate:
                    metric.batchCalls > 0
                        ? Number((metric.continuationAvailableCalls / metric.batchCalls).toFixed(4))
                        : 0,
                continuationTransportRequiredCalls: metric.continuationTransportRequiredCalls,
                continuationTransportRequiredOperations: metric.continuationTransportRequiredOperations,
                continuationTransportRequiredRate:
                    metric.batchCalls > 0
                        ? Number((metric.continuationTransportRequiredCalls / metric.batchCalls).toFixed(4))
                        : 0,
                continuationRecommendedCalls: metric.continuationRecommendedCalls,
                continuationRecommendedOperations: metric.continuationRecommendedOperations,
                continuationRecommendedRate:
                    metric.batchCalls > 0
                        ? Number((metric.continuationRecommendedCalls / metric.batchCalls).toFixed(4))
                        : 0,
                legacyContinuationRequiredCalls: metric.legacyContinuationRequiredCalls,
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

/** @param {Map<string, number>} map */
function singleCountMapKey(map) {
    if (map.size !== 1) return null;
    return map.keys().next().value ?? null;
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
