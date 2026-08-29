// @ts-check
/**
 * Incremental, rebuildable analytics over the append-only MCP audit JSONL.
 *
 * The JSONL remains the source of record. This module stores only sanitized derived event fields plus a byte cursor in
 * the shared SQLite database so repeated diagnostics process only new audit bytes instead of rescanning a growing
 * file.
 *
 * @module copilot/mcp/diagnostics/latency/round-trip/analytics
 */

import { runSqliteTransaction } from '#copilot/infra/public/database/sqlite';
import { MCP_ROUND_TRIP_NORMALIZER_VERSION, normalizeMcpRoundTripAuditEvent } from './normalizer.js';
import { buildUnavailableRoundTripSnapshot, summarizeMcpRoundTripRows } from './summary.js';

const META_TABLE = 'copilot_mcp_round_trip_meta';
const CURSOR_TABLE = 'copilot_mcp_round_trip_cursor';
const EVENT_TABLE = 'copilot_mcp_round_trip_events';
const INDEX_META_ID = 'current';
const MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION = 11;
const MCP_AUDIT_CONTINUITY_VERSION = 1;
const MCP_AUDIT_SEQUENCE_VERSION = 1;
const MAX_CONTINUITY_WINDOW_BYTES = 4 * 1024;
const AUDIT_PROOF_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

const CURSOR_ID = `mcp-audit:v${MCP_ROUND_TRIP_NORMALIZER_VERSION}`;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_ROWS = 100_000;
const MAX_INTERNAL_SUMMARY_TOP = 500;

/**
 * @typedef {{
 *   cursorId: string;
 *   sourceGeneration: string;
 *   generationSequence: number;
 *   physicalFileIdentity: string | null;
 *   byteOffset: number;
 *   fileBytes: number;
 *   continuityVersion: number | null;
 *   continuityWindowBytes: number | null;
 *   continuityToken: string | null;
 *   sequenceVersion: number | null;
 *   sequenceToken: string | null;
 *   rebindCount: number;
 *   newGenerationCount: number;
 *   physicalChangeGenerationCount: number;
 *   rewriteGenerationCount: number;
 *   truncationGenerationCount: number;
 *   lastTransition: string;
 *   updatedAtMs: number;
 * }} RoundTripCursorState
 *
 * @typedef {{ version:number; algorithm:'sha256'; offset:number; windowStart:number; windowBytes:number; token:string }} AuditContinuityAnchor
 * @typedef {{ version:number; algorithm:'sha256-chain'; token:string }} AuditSequenceProof
 */

/**
 * @param {{
 *     db: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     readSlice: ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>['readSlice'];
 *     readPrefixProof?: ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>['readPrefixProof'];
 *     chunkBytes?: number;
 *     maxChunks?: number;
 *     retentionMs?: number;
 *     maxSummaryRows?: number;
 *     now?: () => number;
 * }} options
 */
export function createMcpRoundTripAnalytics(options) {
    const db = options.db;
    if (!db) throw new Error('createMcpRoundTripAnalytics requires an injected database capability.');
    const readSlice = options.readSlice;
    const readPrefixProof = options.readPrefixProof;
    if (typeof readSlice !== 'function')
        throw new TypeError('MCP round-trip analytics requires an audit slice reader.');
    if (readPrefixProof !== undefined && typeof readPrefixProof !== 'function')
        throw new TypeError('MCP round-trip analytics prefix proof must be a function when provided.');
    const chunkBytes = boundedInteger(options.chunkBytes, DEFAULT_CHUNK_BYTES, 64 * 1024, 16 * 1024 * 1024);
    const maxChunks = boundedInteger(options.maxChunks, DEFAULT_MAX_CHUNKS, 1, 32);
    const retentionMs = boundedInteger(
        options.retentionMs,
        DEFAULT_RETENTION_MS,
        60 * 60 * 1000,
        90 * 24 * 60 * 60 * 1000,
    );
    const now = options.now ?? Date.now;
    const maxSummaryRows = boundedInteger(options.maxSummaryRows, MAX_SUMMARY_ROWS, 1, MAX_SUMMARY_ROWS);
    ensureSchema(db, now());

    const insertEvent = db.prepare(`
        INSERT INTO ${EVENT_TABLE} (
            source_generation, physical_file_identity, source_offset, ts_ms, event, tool,
            call_id, trace_key, trace_context_state, target_precision, target_keys_json,
            runtime_epoch_id, runtime_source_binding, runtime_source_fingerprint,
            duration_ms, is_error, code, result_code, result_state, result_class,
            recovery_recipe_count, retry_safe_recovery_recipe_count, suggested_recovery_recipe_count,
            manual_recovery_recipe_count, no_retry_recovery_recipe_count,
            exact_self_repair_attempted_count, exact_self_repair_succeeded_count,
            exact_self_repair_failed_closed_count,
            option_contract_version, option_policy_coverage, option_mode,
            option_declared_count, option_requested_count, option_effective_requested_count,
            option_defaulted_count, option_normalized_count, option_ignored_count,
            option_coerced_count, option_rejected_count, option_conflict_count,
            logical_operations, failed_operations, skipped_operations, execution_mode,
            execution_policy_class, execution_failure_policy_class, execution_concurrency_class,
            batch_size, batch_capacity, result_budget_bytes, truncated_operations, continuation_required,
            continuation_available, continuation_available_operations,
            continuation_transport_required, continuation_transport_required_operations,
            continuation_recommended, continuation_recommended_operations,
            result_bytes, result_size_strategy, text_result_bytes, non_text_result_bytes, duplicate_text_bytes,
            failure_class, retryability, causal_by_code_json, failure_class_counts_json, retryability_counts_json,
            recovery_required, inline_next_action_provided, inline_next_action_target_count,
            inline_recovery_anchor_provided, inline_recovery_anchor_target_count,
            workflow_success, partial, apply_mode, operation_count, target_count, applied_count, failed_count,
            causal_failure_count, aborted_operation_count, recovery_required_target_count,
            convergence_candidate_count, synthetic
        ) VALUES (
            @sourceGeneration, @physicalFileIdentity, @sourceOffset, @tsMs, @event, @tool,
            @callId, @traceKey, @traceContextState, @targetPrecision, @targetKeysJson,
            @runtimeEpochId, @runtimeSourceBinding, @runtimeSourceFingerprint,
            @durationMs, @isError, @code, @resultCode, @resultState, @resultClass,
            @recoveryRecipeCount, @retrySafeRecoveryRecipeCount, @suggestedRecoveryRecipeCount,
            @manualRecoveryRecipeCount, @noRetryRecoveryRecipeCount,
            @exactSelfRepairAttemptedCount, @exactSelfRepairSucceededCount, @exactSelfRepairFailedClosedCount,
            @optionContractVersion, @optionPolicyCoverage, @optionMode,
            @optionDeclaredCount, @optionRequestedCount, @optionEffectiveRequestedCount,
            @optionDefaultedCount, @optionNormalizedCount, @optionIgnoredCount,
            @optionCoercedCount, @optionRejectedCount, @optionConflictCount,
            @logicalOperations, @failedOperations, @skippedOperations, @executionMode,
            @executionPolicyClass, @executionFailurePolicyClass, @executionConcurrencyClass,
            @batchSize, @batchCapacity, @resultBudgetBytes, @truncatedOperations, @legacyContinuationRequired,
            @continuationAvailable, @continuationAvailableOperations,
            @continuationTransportRequired, @continuationTransportRequiredOperations,
            @continuationRecommended, @continuationRecommendedOperations,
            @resultBytes, @resultSizeStrategy, @textResultBytes, @nonTextResultBytes, @duplicateTextBytes,
            @failureClass, @retryability, @causalByCodeJson, @failureClassCountsJson, @retryabilityCountsJson,
            @recoveryRequired, @inlineNextActionProvided, @inlineNextActionTargetCount,
            @inlineRecoveryAnchorProvided, @inlineRecoveryAnchorTargetCount,
            @workflowSuccess, @partial, @applyMode, @operationCount, @targetCount, @appliedCount, @failedCount,
            @causalFailureCount, @abortedOperationCount, @recoveryRequiredTargetCount,
            @convergenceCandidateCount, @synthetic
        )
        ON CONFLICT(source_generation, source_offset) DO UPDATE SET
            physical_file_identity = excluded.physical_file_identity,
            ts_ms = excluded.ts_ms,
            event = excluded.event,
            tool = excluded.tool,
            call_id = excluded.call_id,
            trace_key = excluded.trace_key,
            trace_context_state = excluded.trace_context_state,
            target_precision = excluded.target_precision,
            target_keys_json = excluded.target_keys_json,
            runtime_epoch_id = excluded.runtime_epoch_id,
            runtime_source_binding = excluded.runtime_source_binding,
            runtime_source_fingerprint = excluded.runtime_source_fingerprint,
            duration_ms = excluded.duration_ms,
            is_error = excluded.is_error,
            code = excluded.code,
            result_code = excluded.result_code,
            result_state = excluded.result_state,
            result_class = excluded.result_class,
            recovery_recipe_count = excluded.recovery_recipe_count,
            retry_safe_recovery_recipe_count = excluded.retry_safe_recovery_recipe_count,
            suggested_recovery_recipe_count = excluded.suggested_recovery_recipe_count,
            manual_recovery_recipe_count = excluded.manual_recovery_recipe_count,
            no_retry_recovery_recipe_count = excluded.no_retry_recovery_recipe_count,
            exact_self_repair_attempted_count = excluded.exact_self_repair_attempted_count,
            exact_self_repair_succeeded_count = excluded.exact_self_repair_succeeded_count,
            exact_self_repair_failed_closed_count = excluded.exact_self_repair_failed_closed_count,
            option_contract_version = excluded.option_contract_version,
            option_policy_coverage = excluded.option_policy_coverage,
            option_mode = excluded.option_mode,
            option_declared_count = excluded.option_declared_count,
            option_requested_count = excluded.option_requested_count,
            option_effective_requested_count = excluded.option_effective_requested_count,
            option_defaulted_count = excluded.option_defaulted_count,
            option_normalized_count = excluded.option_normalized_count,
            option_ignored_count = excluded.option_ignored_count,
            option_coerced_count = excluded.option_coerced_count,
            option_rejected_count = excluded.option_rejected_count,
            option_conflict_count = excluded.option_conflict_count,
            logical_operations = excluded.logical_operations,
            failed_operations = excluded.failed_operations,
            skipped_operations = excluded.skipped_operations,
            execution_mode = excluded.execution_mode,
            execution_policy_class = excluded.execution_policy_class,
            execution_failure_policy_class = excluded.execution_failure_policy_class,
            execution_concurrency_class = excluded.execution_concurrency_class,
            batch_size = excluded.batch_size,
            batch_capacity = excluded.batch_capacity,
            result_budget_bytes = excluded.result_budget_bytes,
            truncated_operations = excluded.truncated_operations,
            continuation_required = excluded.continuation_required,
            continuation_available = excluded.continuation_available,
            continuation_available_operations = excluded.continuation_available_operations,
            continuation_transport_required = excluded.continuation_transport_required,
            continuation_transport_required_operations = excluded.continuation_transport_required_operations,
            continuation_recommended = excluded.continuation_recommended,
            continuation_recommended_operations = excluded.continuation_recommended_operations,
            result_bytes = excluded.result_bytes,
            result_size_strategy = excluded.result_size_strategy,
            text_result_bytes = excluded.text_result_bytes,
            non_text_result_bytes = excluded.non_text_result_bytes,
            duplicate_text_bytes = excluded.duplicate_text_bytes,
            failure_class = excluded.failure_class,
            retryability = excluded.retryability,
            causal_by_code_json = excluded.causal_by_code_json,
            failure_class_counts_json = excluded.failure_class_counts_json,
            retryability_counts_json = excluded.retryability_counts_json,
            recovery_required = excluded.recovery_required,
            inline_next_action_provided = excluded.inline_next_action_provided,
            inline_next_action_target_count = excluded.inline_next_action_target_count,
            inline_recovery_anchor_provided = excluded.inline_recovery_anchor_provided,
            inline_recovery_anchor_target_count = excluded.inline_recovery_anchor_target_count,
            workflow_success = excluded.workflow_success,
            partial = excluded.partial,
            apply_mode = excluded.apply_mode,
            operation_count = excluded.operation_count,
            target_count = excluded.target_count,
            applied_count = excluded.applied_count,
            failed_count = excluded.failed_count,
            causal_failure_count = excluded.causal_failure_count,
            aborted_operation_count = excluded.aborted_operation_count,
            recovery_required_target_count = excluded.recovery_required_target_count,
            convergence_candidate_count = excluded.convergence_candidate_count,
            synthetic = excluded.synthetic
    `);
    const upsertCursor = db.prepare(`
        INSERT INTO ${CURSOR_TABLE} (
            cursor_id, source_generation, generation_sequence, physical_file_identity,
            byte_offset, file_bytes, continuity_version, continuity_window_bytes, continuity_token,
            sequence_version, sequence_token, rebind_count, new_generation_count, physical_change_generation_count,
            rewrite_generation_count, truncation_generation_count, last_transition, updated_at_ms
        ) VALUES (
            @cursorId, @sourceGeneration, @generationSequence, @physicalFileIdentity,
            @byteOffset, @fileBytes, @continuityVersion, @continuityWindowBytes, @continuityToken,
            @sequenceVersion, @sequenceToken, @rebindCount, @newGenerationCount, @physicalChangeGenerationCount,
            @rewriteGenerationCount, @truncationGenerationCount, @lastTransition, @updatedAtMs
        )
        ON CONFLICT(cursor_id) DO UPDATE SET
            source_generation = excluded.source_generation,
            generation_sequence = excluded.generation_sequence,
            physical_file_identity = excluded.physical_file_identity,
            byte_offset = excluded.byte_offset,
            file_bytes = excluded.file_bytes,
            continuity_version = excluded.continuity_version,
            continuity_window_bytes = excluded.continuity_window_bytes,
            continuity_token = excluded.continuity_token,
            sequence_version = excluded.sequence_version,
            sequence_token = excluded.sequence_token,
            rebind_count = excluded.rebind_count,
            new_generation_count = excluded.new_generation_count,
            physical_change_generation_count = excluded.physical_change_generation_count,
            rewrite_generation_count = excluded.rewrite_generation_count,
            truncation_generation_count = excluded.truncation_generation_count,
            last_transition = excluded.last_transition,
            updated_at_ms = excluded.updated_at_ms
    `);
    /**
     * @param {Record<string, unknown>[]} rows
     * @param {RoundTripCursorState} cursor
     */
    const ingestTransaction = (rows, cursor) =>
        runSqliteTransaction(db, () => {
            for (const row of rows) insertEvent.run(row);
            upsertCursor.run(cursor);
        });

    /** @param {{ maxChunks?: number }} [syncOptions] */
    async function sync(syncOptions = {}) {
        const syncMaxChunks = boundedInteger(syncOptions.maxChunks, maxChunks, 1, maxChunks);
        let cursor = readCursor(db);
        /** @type {RoundTripCursorState | null} */
        let activeCursor = cursor;
        let offset = activeCursor?.byteOffset ?? 0;
        let processedBytes = 0;
        let parsedEvents = 0;
        let indexedEvents = 0;
        let invalidLines = 0;
        let chunks = 0;
        let reset = false;
        let rebound = false;
        let complete = false;
        let sourcePresent = activeCursor ? null : false;
        let fileBytes = activeCursor?.fileBytes ?? 0;
        let physicalFileIdentity = activeCursor?.physicalFileIdentity ?? null;
        let rebindsThisSync = 0;
        let newGenerationsThisSync = 0;
        let prefixProofsThisSync = 0;
        let prefixProofBytesThisSync = 0;

        while (chunks < syncMaxChunks) {
            const slice = await readSlice({
                offset,
                maxBytes: chunkBytes,
                maxEvents: 200_000,
                sequenceToken: activeCursor?.sequenceToken ?? null,
            });
            chunks += 1;
            if (!slice.ok) {
                return buildSyncFailure({
                    error: slice.error,
                    chunks,
                    processedBytes,
                    parsedEvents,
                    indexedEvents,
                    invalidLines,
                    chunkBudget: syncMaxChunks,
                    cursor: activeCursor,
                });
            }
            sourcePresent = slice.sourcePresent === true;
            if (!sourcePresent) {
                // A missing path can be normal before the first audit event or transient during replacement. Never
                // destroy a previously certified generation merely because the source is momentarily absent.
                complete = activeCursor === null;
                break;
            }

            fileBytes = nonNegativeInteger(slice.fileBytes);
            physicalFileIdentity = stringOrNull(slice.physicalFileIdentity);
            if (!physicalFileIdentity) {
                return buildSyncFailure({
                    error: 'Audit slice is present but has no physical file identity.',
                    chunks,
                    processedBytes,
                    parsedEvents,
                    indexedEvents,
                    invalidLines,
                    chunkBudget: syncMaxChunks,
                    cursor: activeCursor,
                });
            }

            if (!activeCursor) {
                activeCursor = createInitialCursorState(physicalFileIdentity, fileBytes, now());
                offset = 0;
            }

            const physicalChanged =
                activeCursor.physicalFileIdentity !== null &&
                activeCursor.physicalFileIdentity !== physicalFileIdentity;

            if (slice.offsetPastEnd === true || fileBytes < offset) {
                activeCursor = advanceSourceGeneration(activeCursor, {
                    physicalFileIdentity,
                    fileBytes,
                    nowMs: now(),
                    transition: 'new-generation:truncated',
                    physicalChanged,
                    truncation: true,
                });
                offset = 0;
                reset = true;
                newGenerationsThisSync += 1;
                continue;
            }

            if (offset > 0) {
                const startAnchor = normalizeContinuityAnchor(slice.continuityAtStart, offset);
                const startSequence = normalizeSequenceProof(slice.sequenceAtStart);
                if (
                    !startAnchor ||
                    !startSequence ||
                    !activeCursor.continuityToken ||
                    activeCursor.continuityVersion === null ||
                    !activeCursor.sequenceToken ||
                    activeCursor.sequenceVersion === null
                ) {
                    return buildSyncFailure({
                        error: 'Audit continuity/sequence evidence is unavailable at the persisted cursor boundary.',
                        chunks,
                        processedBytes,
                        parsedEvents,
                        indexedEvents,
                        invalidLines,
                        chunkBudget: syncMaxChunks,
                        cursor: activeCursor,
                    });
                }
                if (!cursorSequenceMatches(activeCursor, startSequence)) {
                    return buildSyncFailure({
                        error: 'Audit slice did not preserve the persisted incremental sequence token at its start boundary.',
                        chunks,
                        processedBytes,
                        parsedEvents,
                        indexedEvents,
                        invalidLines,
                        chunkBudget: syncMaxChunks,
                        cursor: activeCursor,
                    });
                }
                if (!cursorContinuityMatches(activeCursor, startAnchor)) {
                    const transition = physicalChanged ? 'new-generation:replacement' : 'new-generation:rewrite';
                    activeCursor = advanceSourceGeneration(activeCursor, {
                        physicalFileIdentity,
                        fileBytes,
                        nowMs: now(),
                        transition,
                        physicalChanged,
                        rewrite: true,
                    });
                    offset = 0;
                    reset = true;
                    newGenerationsThisSync += 1;
                    continue;
                }

                if (physicalChanged) {
                    if (typeof readPrefixProof !== 'function') {
                        return buildSyncFailure({
                            error: 'Audit physical rebind requires a full-prefix proof capability.',
                            chunks,
                            processedBytes,
                            parsedEvents,
                            indexedEvents,
                            invalidLines,
                            chunkBudget: syncMaxChunks,
                            cursor: activeCursor,
                        });
                    }
                    const proof = await readPrefixProof({ offset });
                    prefixProofsThisSync += 1;
                    prefixProofBytesThisSync += nonNegativeInteger(proof.bytesRead);
                    if (!proof.ok) {
                        return buildSyncFailure({
                            error: proof.error ?? 'Audit full-prefix proof failed.',
                            chunks,
                            processedBytes,
                            parsedEvents,
                            indexedEvents,
                            invalidLines,
                            chunkBudget: syncMaxChunks,
                            cursor: activeCursor,
                        });
                    }
                    const proofIdentity = stringOrNull(proof.physicalFileIdentity);
                    if (
                        proof.sourcePresent !== true ||
                        proof.prefixAvailable !== true ||
                        proofIdentity !== physicalFileIdentity
                    ) {
                        return buildSyncFailure({
                            error: 'Audit source changed while proving a physical rebind; retry from a stable snapshot.',
                            chunks,
                            processedBytes,
                            parsedEvents,
                            indexedEvents,
                            invalidLines,
                            chunkBudget: syncMaxChunks,
                            cursor: activeCursor,
                        });
                    }
                    const proofAnchor = normalizeContinuityAnchor(proof.continuityAtOffset, offset);
                    const proofSequence = normalizeSequenceProof(proof.sequenceAtOffset);
                    if (!proofAnchor || !proofSequence || !sameContinuityAnchor(proofAnchor, startAnchor)) {
                        return buildSyncFailure({
                            error: 'Audit prefix proof and slice boundary disagree for the same physical file.',
                            chunks,
                            processedBytes,
                            parsedEvents,
                            indexedEvents,
                            invalidLines,
                            chunkBudget: syncMaxChunks,
                            cursor: activeCursor,
                        });
                    }
                    if (!cursorSequenceMatches(activeCursor, proofSequence)) {
                        activeCursor = advanceSourceGeneration(activeCursor, {
                            physicalFileIdentity,
                            fileBytes,
                            nowMs: now(),
                            transition: 'new-generation:replacement',
                            physicalChanged: true,
                            rewrite: true,
                        });
                        offset = 0;
                        reset = true;
                        newGenerationsThisSync += 1;
                        continue;
                    }
                }
            }

            if (physicalChanged) {
                activeCursor = {
                    ...activeCursor,
                    physicalFileIdentity,
                    fileBytes,
                    rebindCount: activeCursor.rebindCount + 1,
                    lastTransition: 'rebind',
                    updatedAtMs: now(),
                };
                rebound = true;
                rebindsThisSync += 1;
            }

            const entries = Array.isArray(slice.entries) ? slice.entries : [];
            const normalizedRows = [];
            for (const entry of entries) {
                const sourceOffset = Number(entry?.sourceOffset);
                const event = entry?.event;
                if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || !event || typeof event !== 'object')
                    continue;
                const normalized = normalizeMcpRoundTripAuditEvent(/** @type {Record<string, unknown>} */ (event));
                if (!normalized) continue;
                normalizedRows.push({
                    sourceGeneration: activeCursor.sourceGeneration,
                    physicalFileIdentity,
                    sourceOffset,
                    ...normalized,
                });
            }
            const nextOffset = nonNegativeInteger(slice.nextOffset, offset);
            if (nextOffset < offset || nextOffset > fileBytes) {
                return buildSyncFailure({
                    error: `Audit slice returned invalid nextOffset ${String(nextOffset)} for cursor ${String(offset)} and file size ${String(fileBytes)}.`,
                    chunks,
                    processedBytes,
                    parsedEvents,
                    indexedEvents,
                    invalidLines,
                    chunkBudget: syncMaxChunks,
                    cursor: activeCursor,
                });
            }
            const nextAnchor = normalizeContinuityAnchor(slice.continuityAtNext, nextOffset);
            const nextSequence = normalizeSequenceProof(slice.sequenceAtNext);
            if (!nextAnchor || !nextSequence) {
                return buildSyncFailure({
                    error: 'Audit slice did not provide valid continuity/sequence evidence for the next cursor boundary.',
                    chunks,
                    processedBytes,
                    parsedEvents,
                    indexedEvents,
                    invalidLines,
                    chunkBudget: syncMaxChunks,
                    cursor: activeCursor,
                });
            }
            const nextCursor = /** @type {RoundTripCursorState} */ ({
                ...activeCursor,
                physicalFileIdentity,
                byteOffset: nextOffset,
                fileBytes,
                continuityVersion: nextAnchor.version,
                continuityWindowBytes: nextAnchor.windowBytes,
                continuityToken: nextAnchor.token,
                sequenceVersion: nextSequence.version,
                sequenceToken: nextSequence.token,
                lastTransition:
                    activeCursor.lastTransition === 'bootstrap' && nextOffset > 0
                        ? 'append'
                        : activeCursor.lastTransition,
                updatedAtMs: now(),
            });
            ingestTransaction(normalizedRows, nextCursor);
            activeCursor = nextCursor;
            processedBytes += nonNegativeInteger(slice.bytesRead);
            parsedEvents += nonNegativeInteger(slice.parsedEvents);
            indexedEvents += normalizedRows.length;
            invalidLines += nonNegativeInteger(slice.invalidLines);
            offset = nextOffset;
            complete = slice.complete === true;
            if (complete || nonNegativeInteger(slice.bytesRead) <= 0) break;
        }

        const cutoff = now() - retentionMs;
        db.prepare(`DELETE FROM ${EVENT_TABLE} WHERE ts_ms < ?`).run(cutoff);
        cursor = readCursor(db);
        return {
            ok: true,
            error: null,
            chunks,
            processedBytes,
            parsedEvents,
            indexedEvents,
            invalidLines,
            complete,
            reset,
            rebound,
            sourcePresent,
            rebindsThisSync,
            newGenerationsThisSync,
            prefixProofsThisSync,
            prefixProofBytesThisSync,
            cursor: buildPublicCursor(cursor),
            sourceIntegrity: buildSourceIntegrity(cursor),
            physicalFileIdentity,
            fileBytes,
            lagBytes: sourcePresent === false ? null : Math.max(0, fileBytes - (cursor?.byteOffset ?? 0)),
            chunkBudget: syncMaxChunks,
        };
    }

    /** @param {{ windowMs?: number; top?: number; includeSynthetic?: boolean; sync?: boolean; runtimeSourceBinding?: string; runtimeEpochId?: string }} [summaryOptions] */
    async function summarize(summaryOptions = {}) {
        const ingestion = summaryOptions.sync === false ? null : await sync();
        const windowMs = boundedInteger(summaryOptions.windowMs, DEFAULT_WINDOW_MS, 60_000, 14 * 24 * 60 * 60 * 1000);
        const top = boundedInteger(summaryOptions.top, 20, 1, MAX_INTERNAL_SUMMARY_TOP);
        const includeSynthetic = summaryOptions.includeSynthetic === true;
        const runtimeSourceBinding = normalizeRuntimeSourceBindingFilter(summaryOptions.runtimeSourceBinding);
        const runtimeEpochId = normalizeRuntimeEpochIdFilter(summaryOptions.runtimeEpochId);
        const queryScope = {
            includeSynthetic,
            runtimeSourceBinding,
            ...(runtimeEpochId ? { runtimeEpochId } : {}),
        };
        const sourceIntegrity = buildSourceIntegrity(readCursor(db));
        if (ingestion?.sourcePresent === false || sourceIntegrity.status !== 'materialized') {
            return {
                ingestion,
                sourceIntegrity,
                queryScope,
                ...buildUnavailableRoundTripSnapshot(
                    windowMs,
                    includeSynthetic,
                    ingestion?.sourcePresent === false
                        ? 'derived-round-trip-source-absent'
                        : `derived-round-trip-index-v${String(MCP_ROUND_TRIP_NORMALIZER_VERSION)}-catch-up-required`,
                ),
            };
        }
        const cutoff = now() - windowMs;
        const window = readBoundedSummaryWindow(
            db,
            cutoff,
            includeSynthetic,
            maxSummaryRows,
            runtimeSourceBinding,
            runtimeEpochId,
        );
        return {
            ingestion,
            sourceIntegrity,
            queryScope,
            ...summarizeMcpRoundTripRows(window.rows, {
                windowMs,
                top,
                includeSynthetic,
                completeness: window.completeness,
            }),
        };
    }

    return { sync, summarize };
}

/**
 * Build one process-host-owned analytics capability over a lazy SQLite authority. The database reader is intentionally
 * supplied by composition so this owner never discovers Application Infra and never stores process-global runtime
 * identity. If the concrete database generation changes, the closure rebuilds its derived runtime locally.
 *
 * @param {() => import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} readDatabase
 * @param {Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readSlice' | 'readPrefixProof'>} audit
 */
export function createMcpRoundTripAnalyticsCapability(readDatabase, audit) {
    if (typeof readDatabase !== 'function') {
        throw new TypeError('MCP round-trip analytics capability requires a database reader.');
    }
    if (!audit || typeof audit.readSlice !== 'function' || typeof audit.readPrefixProof !== 'function') {
        throw new TypeError('MCP round-trip analytics capability requires audit slice and prefix-proof readers.');
    }
    /** @type {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} */
    let boundDatabase = null;
    /** @type {ReturnType<typeof createMcpRoundTripAnalytics> | null} */
    let analytics = null;

    const requireAnalytics = () => {
        const database = readDatabase();
        if (!database) throw new Error('MCP round-trip analytics database capability is unavailable.');
        if (database !== boundDatabase || !analytics) {
            boundDatabase = database;
            analytics = createMcpRoundTripAnalytics({
                db: database,
                readSlice: audit.readSlice,
                readPrefixProof: audit.readPrefixProof,
            });
        }
        return analytics;
    };

    return Object.freeze({
        sync: (/** @type {{ maxChunks?: number }} */ options = {}) => requireAnalytics().sync(options),
        summarize: (
            /** @type {{ windowMs?: number; top?: number; includeSynthetic?: boolean; sync?: boolean; runtimeSourceBinding?: string; runtimeEpochId?: string }} */ options = {},
        ) => requireAnalytics().summarize(options),
        readSnapshot: (
            /** @type {{ windowMs?: number; top?: number; includeSynthetic?: boolean; now?: () => number; runtimeSourceBinding?: string; runtimeEpochId?: string }} */ options = {},
        ) => {
            const database = readDatabase();
            return readMcpRoundTripAnalyticsSnapshot({
                ...options,
                ...(database ? { db: database } : {}),
            });
        },
    });
}

/**
 * Read the already-materialized derived index without creating tables, advancing cursors or ingesting audit bytes. This
 * is safe for read-only dashboards; the background monitor or explicit analytics tool owns synchronization.
 *
 * @param {{
 *     db?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 *     windowMs?: number;
 *     top?: number;
 *     includeSynthetic?: boolean;
 *     runtimeSourceBinding?: string;
 *     runtimeEpochId?: string;
 *     maxSummaryRows?: number;
 *     now?: () => number;
 * }} [options]
 */
export function readMcpRoundTripAnalyticsSnapshot(options = {}) {
    const db = options.db;
    const windowMs = boundedInteger(options.windowMs, DEFAULT_WINDOW_MS, 60_000, 14 * 24 * 60 * 60 * 1000);
    const top = boundedInteger(options.top, 20, 1, 100);
    const includeSynthetic = options.includeSynthetic === true;
    const runtimeSourceBinding = normalizeRuntimeSourceBindingFilter(options.runtimeSourceBinding);
    const runtimeEpochId = normalizeRuntimeEpochIdFilter(options.runtimeEpochId);
    const queryScope = {
        includeSynthetic,
        runtimeSourceBinding,
        ...(runtimeEpochId ? { runtimeEpochId } : {}),
    };
    const maxSummaryRows = boundedInteger(options.maxSummaryRows, MAX_SUMMARY_ROWS, 1, MAX_SUMMARY_ROWS);
    if (!db) {
        return {
            ...buildUnavailableRoundTripSnapshot(windowMs, includeSynthetic, 'database-capability-unavailable'),
            queryScope,
            sourceIntegrity: {
                indexSchemaVersion: null,
                indexNormalizerVersion: null,
                expectedSchemaVersion: MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION,
                expectedNormalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
                status: 'database-unavailable',
                lagBytes: null,
                cursor: null,
            },
        };
    }
    const indexMetadata = readIndexMetadata(db);
    if (!indexMetadataIsCurrent(indexMetadata)) {
        const observedGeneration = indexMetadata
            ? `schema-${String(indexMetadata.schemaVersion)}-normalizer-${String(indexMetadata.normalizerVersion)}`
            : 'unversioned';
        return {
            ...buildUnavailableRoundTripSnapshot(
                windowMs,
                includeSynthetic,
                `derived-round-trip-index-${observedGeneration}-v${String(MCP_ROUND_TRIP_NORMALIZER_VERSION)}-rebuild-required`,
            ),
            queryScope,
            sourceIntegrity: {
                indexSchemaVersion: indexMetadata?.schemaVersion ?? null,
                indexNormalizerVersion: indexMetadata?.normalizerVersion ?? null,
                expectedSchemaVersion: MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION,
                expectedNormalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
                status: 'rebuild-required',
                lagBytes: null,
                cursor: null,
            },
        };
    }
    const cursor = readCursor(db);
    const sourceIntegrity = buildSourceIntegrity(cursor);
    if (sourceIntegrity.status !== 'materialized') {
        return {
            ...buildUnavailableRoundTripSnapshot(
                windowMs,
                includeSynthetic,
                `derived-round-trip-index-v${String(MCP_ROUND_TRIP_NORMALIZER_VERSION)}-catch-up-required`,
            ),
            queryScope,
            sourceIntegrity,
        };
    }
    const cutoff = (options.now ?? Date.now)() - windowMs;
    const window = readBoundedSummaryWindow(db, cutoff, includeSynthetic, maxSummaryRows, runtimeSourceBinding, runtimeEpochId);
    return {
        available: true,
        queryScope,
        sourceIntegrity,
        ...summarizeMcpRoundTripRows(window.rows, {
            windowMs,
            top,
            includeSynthetic,
            completeness: window.completeness,
        }),
    };
}

/**
 * Read a complete window when it fits the bounded row budget; otherwise keep the newest bounded tail and explicitly
 * publish incompleteness. Silent prefix truncation is never allowed.
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {number} cutoff
 * @param {boolean} includeSynthetic
 * @param {number} maxRows
 * @param {string | null} [runtimeSourceBinding]
 * @param {string | null} [runtimeEpochId]
 */
function readBoundedSummaryWindow(db, cutoff, includeSynthetic, maxRows, runtimeSourceBinding = null, runtimeEpochId = null) {
    const predicates = ['ts_ms >= ?'];
    /** @type {(number|string)[]} */
    const parameters = [cutoff];
    if (!includeSynthetic) predicates.push('synthetic = 0');
    if (runtimeSourceBinding) {
        predicates.push('runtime_source_binding = ?');
        parameters.push(runtimeSourceBinding);
    }
    if (runtimeEpochId) {
        predicates.push('runtime_epoch_id = ?');
        parameters.push(runtimeEpochId);
    }
    const whereClause = predicates.join(' AND ');
    const countRow = /** @type {Record<string, unknown> | undefined} */ (
        db.prepare(`SELECT COUNT(*) AS count FROM ${EVENT_TABLE} WHERE ${whereClause}`).get(...parameters)
    );
    const rowsEligible = Math.max(0, Number(countRow?.['count'] ?? 0));
    const truncated = rowsEligible > maxRows;
    const rows = /** @type {Record<string, unknown>[]} */ (
        truncated
            ? db
                  .prepare(
                      `SELECT * FROM (
                           SELECT * FROM ${EVENT_TABLE}
                           WHERE ${whereClause}
                           ORDER BY ts_ms DESC, id DESC
                           LIMIT ?
                       ) ORDER BY ts_ms ASC, id ASC`,
                  )
                  .all(...parameters, maxRows)
            : db
                  .prepare(
                      `SELECT * FROM ${EVENT_TABLE}
                       WHERE ${whereClause}
                       ORDER BY ts_ms ASC, id ASC`,
                  )
                  .all(...parameters)
    );
    const rowsAnalyzed = rows.length;
    return {
        rows,
        completeness: {
            rowsEligible,
            rowsAnalyzed,
            maxRows,
            truncated,
            selection: truncated ? 'newest-bounded-tail' : 'complete-window',
            coverageRatio: rowsEligible > 0 ? Number((rowsAnalyzed / rowsEligible).toFixed(6)) : 1,
        },
    };
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {number} nowMs
 */
function ensureSchema(db, nowMs) {
    // The metadata check belongs inside the write transaction. Two overlapping process generations may both observe an
    // old index before acquiring SQLite's writer lock; the second one must re-read metadata after the first commits and
    // must never drop a freshly rebuilt v11 index.
    runSqliteTransaction(db, () => {
        if (indexMetadataIsCurrent(readIndexMetadata(db))) return;
        // This database is a rebuildable projection over the append-only JSONL. A legacy table may contain replayed
        // physical identities, so migration-by-reinterpretation is forbidden: replace only this owner's derived tables.
        db.exec(`
            DROP TABLE IF EXISTS ${CURSOR_TABLE};
            DROP TABLE IF EXISTS ${EVENT_TABLE};
            DROP TABLE IF EXISTS ${META_TABLE};
            CREATE TABLE ${META_TABLE} (
                meta_id TEXT PRIMARY KEY,
                schema_version INTEGER NOT NULL,
                normalizer_version INTEGER NOT NULL,
                schema_created_at_ms INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE ${CURSOR_TABLE} (
                cursor_id TEXT PRIMARY KEY,
                source_generation TEXT NOT NULL,
                generation_sequence INTEGER NOT NULL CHECK(generation_sequence >= 1),
                physical_file_identity TEXT,
                byte_offset INTEGER NOT NULL DEFAULT 0 CHECK(byte_offset >= 0),
                file_bytes INTEGER NOT NULL DEFAULT 0 CHECK(file_bytes >= 0),
                continuity_version INTEGER,
                continuity_window_bytes INTEGER,
                continuity_token TEXT,
                sequence_version INTEGER,
                sequence_token TEXT,
                rebind_count INTEGER NOT NULL DEFAULT 0 CHECK(rebind_count >= 0),
                new_generation_count INTEGER NOT NULL DEFAULT 1 CHECK(new_generation_count >= 1),
                physical_change_generation_count INTEGER NOT NULL DEFAULT 0 CHECK(physical_change_generation_count >= 0),
                rewrite_generation_count INTEGER NOT NULL DEFAULT 0 CHECK(rewrite_generation_count >= 0),
                truncation_generation_count INTEGER NOT NULL DEFAULT 0 CHECK(truncation_generation_count >= 0),
                last_transition TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            ) STRICT;
        CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_generation TEXT NOT NULL,
            physical_file_identity TEXT,
            source_offset INTEGER NOT NULL,
            ts_ms INTEGER NOT NULL,
            event TEXT NOT NULL,
            tool TEXT,
            call_id TEXT,
            trace_key TEXT,
            trace_context_state TEXT,
            target_precision TEXT,
            target_keys_json TEXT,
            runtime_epoch_id TEXT,
            runtime_source_binding TEXT,
            runtime_source_fingerprint TEXT,
            duration_ms INTEGER,
            is_error INTEGER,
            code TEXT,
            result_code TEXT,
            result_state TEXT,
            result_class TEXT,
            recovery_recipe_count INTEGER,
            retry_safe_recovery_recipe_count INTEGER,
            suggested_recovery_recipe_count INTEGER,
            manual_recovery_recipe_count INTEGER,
            no_retry_recovery_recipe_count INTEGER,
            exact_self_repair_attempted_count INTEGER,
            exact_self_repair_succeeded_count INTEGER,
            exact_self_repair_failed_closed_count INTEGER,
            option_contract_version TEXT,
            option_policy_coverage TEXT,
            option_mode TEXT,
            option_declared_count INTEGER,
            option_requested_count INTEGER,
            option_effective_requested_count INTEGER,
            option_defaulted_count INTEGER,
            option_normalized_count INTEGER,
            option_ignored_count INTEGER,
            option_coerced_count INTEGER,
            option_rejected_count INTEGER,
            option_conflict_count INTEGER,
            logical_operations INTEGER,
            failed_operations INTEGER,
            skipped_operations INTEGER,
            execution_mode TEXT,
            execution_policy_class TEXT,
            execution_failure_policy_class TEXT,
            execution_concurrency_class TEXT,
            batch_size INTEGER,
            batch_capacity INTEGER,
            result_budget_bytes INTEGER,
            truncated_operations INTEGER,
            continuation_required INTEGER,
            continuation_available INTEGER,
            continuation_available_operations INTEGER,
            continuation_transport_required INTEGER,
            continuation_transport_required_operations INTEGER,
            continuation_recommended INTEGER,
            continuation_recommended_operations INTEGER,
            result_bytes INTEGER,
            result_size_strategy TEXT,
            text_result_bytes INTEGER,
            non_text_result_bytes INTEGER,
            duplicate_text_bytes INTEGER,
            failure_class TEXT,
            retryability TEXT,
            causal_by_code_json TEXT,
            failure_class_counts_json TEXT,
            retryability_counts_json TEXT,
            recovery_required INTEGER,
            inline_next_action_provided INTEGER,
            inline_next_action_target_count INTEGER,
            inline_recovery_anchor_provided INTEGER,
            inline_recovery_anchor_target_count INTEGER,
            workflow_success INTEGER,
            partial INTEGER,
            apply_mode TEXT,
            operation_count INTEGER,
            target_count INTEGER,
            applied_count INTEGER,
            failed_count INTEGER,
            causal_failure_count INTEGER,
            aborted_operation_count INTEGER,
            recovery_required_target_count INTEGER,
            convergence_candidate_count INTEGER,
            synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0, 1)),
            UNIQUE(source_generation, source_offset)
        ) STRICT;
            CREATE INDEX idx_mcp_round_trip_events_ts ON ${EVENT_TABLE}(ts_ms);
            CREATE INDEX idx_mcp_round_trip_events_event_tool ON ${EVENT_TABLE}(event, tool, ts_ms);
            CREATE INDEX idx_mcp_round_trip_events_call_id ON ${EVENT_TABLE}(call_id, ts_ms);
            CREATE INDEX idx_mcp_round_trip_events_trace_key ON ${EVENT_TABLE}(trace_key, ts_ms);
            CREATE INDEX idx_mcp_round_trip_events_runtime_epoch ON ${EVENT_TABLE}(runtime_epoch_id, ts_ms);
            CREATE INDEX idx_mcp_round_trip_events_source_generation ON ${EVENT_TABLE}(source_generation, source_offset);
        `);
        db.prepare(
            `INSERT INTO ${META_TABLE} (meta_id, schema_version, normalizer_version, schema_created_at_ms)
             VALUES (?, ?, ?, ?)`,
        ).run(INDEX_META_ID, MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION, MCP_ROUND_TRIP_NORMALIZER_VERSION, nowMs);
    });
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @returns {{schemaVersion:number;normalizerVersion:number;schemaCreatedAtMs:number} | null}
 */
function readIndexMetadata(db) {
    const metaExists = db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
        .get(META_TABLE);
    if (!metaExists) return null;
    const row = /** @type {Record<string, unknown> | undefined} */ (
        db
            .prepare(
                `SELECT schema_version, normalizer_version, schema_created_at_ms
                 FROM ${META_TABLE} WHERE meta_id = ?`,
            )
            .get(INDEX_META_ID)
    );
    if (!row) return null;
    const schemaVersion = Number(row['schema_version']);
    const normalizerVersion = Number(row['normalizer_version']);
    const schemaCreatedAtMs = Number(row['schema_created_at_ms']);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) return null;
    if (!Number.isSafeInteger(normalizerVersion) || normalizerVersion < 1) return null;
    if (!Number.isFinite(schemaCreatedAtMs) || schemaCreatedAtMs < 0) return null;
    return { schemaVersion, normalizerVersion, schemaCreatedAtMs };
}

/** @param {{schemaVersion:number;normalizerVersion:number} | null} metadata */
function indexMetadataIsCurrent(metadata) {
    return (
        metadata?.schemaVersion === MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION &&
        metadata.normalizerVersion === MCP_ROUND_TRIP_NORMALIZER_VERSION
    );
}

/** @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */
function readCursor(db) {
    if (!indexMetadataIsCurrent(readIndexMetadata(db))) return null;
    const row = /** @type {Record<string, unknown> | undefined} */ (
        db
            .prepare(
                `SELECT source_generation, generation_sequence, physical_file_identity,
                        byte_offset, file_bytes, continuity_version, continuity_window_bytes, continuity_token,
                        sequence_version, sequence_token, rebind_count, new_generation_count, physical_change_generation_count,
                        rewrite_generation_count, truncation_generation_count, last_transition, updated_at_ms
                 FROM ${CURSOR_TABLE} WHERE cursor_id = ?`,
            )
            .get(CURSOR_ID)
    );
    if (!row) return null;
    const sourceGeneration = stringOrNull(row['source_generation']);
    const generationSequence = nonNegativeInteger(row['generation_sequence']);
    const lastTransition = stringOrNull(row['last_transition']);
    if (!sourceGeneration || generationSequence < 1 || !lastTransition) return null;
    return /** @type {RoundTripCursorState} */ ({
        cursorId: CURSOR_ID,
        sourceGeneration,
        generationSequence,
        physicalFileIdentity: stringOrNull(row['physical_file_identity']),
        byteOffset: nonNegativeInteger(row['byte_offset']),
        fileBytes: nonNegativeInteger(row['file_bytes']),
        continuityVersion: nullableInteger(row['continuity_version']),
        continuityWindowBytes: nullableInteger(row['continuity_window_bytes']),
        continuityToken: stringOrNull(row['continuity_token']),
        sequenceVersion: nullableInteger(row['sequence_version']),
        sequenceToken: stringOrNull(row['sequence_token']),
        rebindCount: nonNegativeInteger(row['rebind_count']),
        newGenerationCount: Math.max(1, nonNegativeInteger(row['new_generation_count'], 1)),
        physicalChangeGenerationCount: nonNegativeInteger(row['physical_change_generation_count']),
        rewriteGenerationCount: nonNegativeInteger(row['rewrite_generation_count']),
        truncationGenerationCount: nonNegativeInteger(row['truncation_generation_count']),
        lastTransition,
        updatedAtMs: nonNegativeInteger(row['updated_at_ms']),
    });
}

/** @param {string} physicalFileIdentity @param {number} fileBytes @param {number} nowMs */
function createInitialCursorState(physicalFileIdentity, fileBytes, nowMs) {
    return /** @type {RoundTripCursorState} */ ({
        cursorId: CURSOR_ID,
        sourceGeneration: buildSourceGeneration(1),
        generationSequence: 1,
        physicalFileIdentity,
        byteOffset: 0,
        fileBytes,
        continuityVersion: null,
        continuityWindowBytes: null,
        continuityToken: null,
        sequenceVersion: null,
        sequenceToken: null,
        rebindCount: 0,
        newGenerationCount: 1,
        physicalChangeGenerationCount: 0,
        rewriteGenerationCount: 0,
        truncationGenerationCount: 0,
        lastTransition: 'bootstrap',
        updatedAtMs: nowMs,
    });
}

/**
 * @param {RoundTripCursorState} cursor
 * @param {{physicalFileIdentity:string;fileBytes:number;nowMs:number;transition:string;physicalChanged:boolean;rewrite?:boolean;truncation?:boolean}} input
 */
function advanceSourceGeneration(cursor, input) {
    const generationSequence = cursor.generationSequence + 1;
    return /** @type {RoundTripCursorState} */ ({
        ...cursor,
        sourceGeneration: buildSourceGeneration(generationSequence),
        generationSequence,
        physicalFileIdentity: input.physicalFileIdentity,
        byteOffset: 0,
        fileBytes: input.fileBytes,
        continuityVersion: null,
        continuityWindowBytes: null,
        continuityToken: null,
        sequenceVersion: null,
        sequenceToken: null,
        newGenerationCount: cursor.newGenerationCount + 1,
        physicalChangeGenerationCount: cursor.physicalChangeGenerationCount + (input.physicalChanged ? 1 : 0),
        rewriteGenerationCount: cursor.rewriteGenerationCount + (input.rewrite === true ? 1 : 0),
        truncationGenerationCount: cursor.truncationGenerationCount + (input.truncation === true ? 1 : 0),
        lastTransition: input.transition,
        updatedAtMs: input.nowMs,
    });
}

/** @param {number} sequence */
function buildSourceGeneration(sequence) {
    return `mcp-audit:v${MCP_ROUND_TRIP_NORMALIZER_VERSION}:g${String(sequence)}`;
}

/** @param {unknown} value @param {number} expectedOffset @returns {AuditContinuityAnchor | null} */
function normalizeContinuityAnchor(value, expectedOffset) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = /** @type {Record<string, unknown>} */ (value);
    const version = Number(row['version']);
    const offset = Number(row['offset']);
    const windowStart = Number(row['windowStart']);
    const windowBytes = Number(row['windowBytes']);
    const token = stringOrNull(row['token']);
    if (version !== MCP_AUDIT_CONTINUITY_VERSION || row['algorithm'] !== 'sha256') return null;
    if (!Number.isSafeInteger(offset) || offset !== expectedOffset) return null;
    if (!Number.isSafeInteger(windowStart) || windowStart < 0 || windowStart > offset) return null;
    if (!Number.isSafeInteger(windowBytes) || windowBytes < 0 || windowBytes > MAX_CONTINUITY_WINDOW_BYTES) return null;
    if (windowStart !== Math.max(0, offset - windowBytes)) return null;
    if (!token || !/^[a-f0-9]{64}$/u.test(token)) return null;
    return { version, algorithm: 'sha256', offset, windowStart, windowBytes, token };
}

/** @param {unknown} value @returns {AuditSequenceProof | null} */
function normalizeSequenceProof(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = /** @type {Record<string, unknown>} */ (value);
    const version = Number(row['version']);
    const token = stringOrNull(row['token']);
    if (version !== MCP_AUDIT_SEQUENCE_VERSION || row['algorithm'] !== 'sha256-chain') return null;
    if (!token || !AUDIT_PROOF_TOKEN_PATTERN.test(token)) return null;
    return { version, algorithm: 'sha256-chain', token };
}

/** @param {AuditContinuityAnchor} left @param {AuditContinuityAnchor} right */
function sameContinuityAnchor(left, right) {
    return (
        left.version === right.version &&
        left.offset === right.offset &&
        left.windowStart === right.windowStart &&
        left.windowBytes === right.windowBytes &&
        left.token === right.token
    );
}

/** @param {RoundTripCursorState} cursor @param {AuditSequenceProof} sequence */
function cursorSequenceMatches(cursor, sequence) {
    return cursor.sequenceVersion === sequence.version && cursor.sequenceToken === sequence.token;
}

/** @param {RoundTripCursorState} cursor @param {AuditContinuityAnchor} anchor */
function cursorContinuityMatches(cursor, anchor) {
    return (
        cursor.byteOffset === anchor.offset &&
        cursor.continuityVersion === anchor.version &&
        cursor.continuityWindowBytes === anchor.windowBytes &&
        cursor.continuityToken === anchor.token
    );
}

/** @param {RoundTripCursorState | null} cursor */
function buildPublicCursor(cursor) {
    if (!cursor) return null;
    return {
        cursorId: cursor.cursorId,
        sourceGeneration: cursor.sourceGeneration,
        generationSequence: cursor.generationSequence,
        physicalFileIdentity: cursor.physicalFileIdentity,
        byteOffset: cursor.byteOffset,
        fileBytes: cursor.fileBytes,
        continuity: {
            version: cursor.continuityVersion,
            offset: cursor.byteOffset,
            windowBytes: cursor.continuityWindowBytes,
            tokenPresent: Boolean(cursor.continuityToken),
        },
        sequenceProof: {
            version: cursor.sequenceVersion,
            tokenPresent: Boolean(cursor.sequenceToken),
        },
        rebindCount: cursor.rebindCount,
        newGenerationCount: cursor.newGenerationCount,
        physicalChangeGenerationCount: cursor.physicalChangeGenerationCount,
        rewriteGenerationCount: cursor.rewriteGenerationCount,
        truncationGenerationCount: cursor.truncationGenerationCount,
        lastTransition: cursor.lastTransition,
        updatedAtMs: cursor.updatedAtMs,
    };
}

/** @param {RoundTripCursorState | null} cursor */
function buildSourceIntegrity(cursor) {
    const lagBytes = cursor ? Math.max(0, cursor.fileBytes - cursor.byteOffset) : null;
    return {
        indexSchemaVersion: MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION,
        indexNormalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        expectedSchemaVersion: MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION,
        expectedNormalizerVersion: MCP_ROUND_TRIP_NORMALIZER_VERSION,
        status: cursor ? (lagBytes === 0 ? 'materialized' : 'materializing') : 'bootstrap-required',
        lagBytes,
        cursor: buildPublicCursor(cursor),
    };
}

/**
 * @param {{error:unknown;chunks:number;processedBytes:number;parsedEvents:number;indexedEvents:number;invalidLines:number;chunkBudget:number;cursor:RoundTripCursorState|null}} input
 */
function buildSyncFailure(input) {
    const sourceIntegrity = buildSourceIntegrity(input.cursor);
    return {
        ok: false,
        error:
            input.error instanceof Error
                ? input.error.message
                : String(input.error ?? 'round-trip-analytics-sync-failed'),
        chunks: input.chunks,
        processedBytes: input.processedBytes,
        parsedEvents: input.parsedEvents,
        indexedEvents: input.indexedEvents,
        invalidLines: input.invalidLines,
        complete: false,
        reset: false,
        rebound: false,
        sourcePresent: null,
        rebindsThisSync: 0,
        newGenerationsThisSync: 0,
        prefixProofsThisSync: 0,
        prefixProofBytesThisSync: 0,
        cursor: buildPublicCursor(input.cursor),
        sourceIntegrity,
        physicalFileIdentity: input.cursor?.physicalFileIdentity ?? null,
        fileBytes: input.cursor?.fileBytes ?? 0,
        lagBytes: sourceIntegrity.lagBytes,
        chunkBudget: input.chunkBudget,
    };
}

/** @param {unknown} value @returns {string | null} */
function normalizeRuntimeSourceBindingFilter(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(text)) {
        throw new TypeError('runtimeSourceBinding filter must be a bounded machine-like source binding.');
    }
    return text;
}

/** @param {unknown} value @returns {string | null} */
function normalizeRuntimeEpochIdFilter(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(text)) {
        throw new TypeError('runtimeEpochId filter must be a bounded opaque runtime identity.');
    }
    return text;
}

/** @param {unknown} value @param {number} [fallback] */
function nonNegativeInteger(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** @param {unknown} value */
function nullableInteger(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/** @param {unknown} value */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
