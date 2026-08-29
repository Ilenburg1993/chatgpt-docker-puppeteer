// @ts-check
/**
 * Shared MCP framing for bounded repository-read batches.
 *
 * Concurrency/execution remains owned by infra/concurrency/bulk. This module owns only the MCP-specific projection of a
 * completed bounded execution: compact item rows, aggregate result budgeting, result-size hints and continuation hints.
 * It deliberately knows nothing about filesystem IO, parsing, search engines or individual read-tool schemas.
 *
 * @module copilot/mcp/tools/repo-read-batch
 */

import { truncateUtf8String } from '#copilot/infra/public/platform/buffer';
import {
    estimateStructuredTextResultBytes,
    okResult,
    withResultExecutionHint,
    withResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';

const STRUCTURAL_PAYLOAD_KEYS = /** @type {const} */ (['symbols', 'imports', 'exports', 'outline', 'topComments']);
const TEXT_PAYLOAD_KEYS = /** @type {const} */ (['content', 'output']);

/**
 * @typedef {{
 *   defaultResultBudgetBytes:number;
 *   minResultBudgetBytes:number;
 *   maxResultBudgetBytes:number;
 *   maxBatchItems:number;
 * }} RepoReadBatchLimits
 *
 * @typedef {{
 *   executionId:string;
 *   failureMode:'best-effort'|'fail-fast';
 *   requestCount:number;
 *   attemptedCount:number;
 *   succeededCount:number;
 *   failedCount:number;
 *   skippedCount:number;
 *   concurrency:number;
 *   maxInFlight:number;
 *   inputBytes:number|null;
 *   durationMs:number;
 *   results:Array<
 *     {index:number;status:'succeeded';success:true;durationMs:number;value:import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult}
 *     | {index:number;status:'failed';success:false;durationMs:number;value?:import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult;error?:string;code?:string|null}
 *     | {index:number;status:'skipped';success:false;durationMs:0;reason:string}
 *   >;
 * }} RepoReadBatchExecution
 */

/**
 * @param {number} index
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 */
function compactBatchCallResult(index, result) {
    return {
        index,
        isError: result.isError === true,
        ...(result.structuredContent ?? {}),
    };
}

/** @param {RepoReadBatchExecution} execution */
export function compactRepoReadBatchExecution(execution) {
    return execution.results.map((row) => {
        if (row.status === 'skipped') {
            return {
                index: row.index,
                status: row.status,
                isError: true,
                success: false,
                skipped: true,
                durationMs: row.durationMs,
                code: 'ERR_BATCH_SKIPPED',
                reason: row.reason,
            };
        }
        if (row.status === 'succeeded') {
            return {
                ...compactBatchCallResult(row.index, row.value),
                status: row.status,
                durationMs: row.durationMs,
            };
        }
        if ('value' in row && row.value) {
            return {
                ...compactBatchCallResult(row.index, row.value),
                status: row.status,
                durationMs: row.durationMs,
            };
        }
        return {
            index: row.index,
            status: 'failed',
            isError: true,
            success: false,
            durationMs: row.durationMs,
            code: row.code ?? 'ERR_BATCH_ITEM_EXECUTION',
            error: row.error ?? 'Batch item execution failed.',
        };
    });
}

/**
 * Bound aggregate batch payload without deleting recovery semantics. Text payloads can be UTF-8 truncated; structural
 * collections are omitted atomically because partial arrays could masquerade as a valid parser page. When a structural
 * page is omitted, the row keeps its input cursor as payloadRecoveryCursor so the same page can be requested again.
 *
 * @param {Record<string, unknown>[]} inputResults
 * @param {number} budgetBytes
 * @param {RepoReadBatchLimits} limits
 */
export function boundRepoReadBatchPayload(inputResults, budgetBytes, limits) {
    const effectiveBudget = Math.max(
        limits.minResultBudgetBytes,
        Math.min(limits.maxResultBudgetBytes, Math.floor(budgetBytes)),
    );
    const originalResultBytes = Buffer.byteLength(JSON.stringify(inputResults), 'utf8');
    if (originalResultBytes <= effectiveBudget) {
        return {
            results: inputResults,
            resultBudgetBytes: effectiveBudget,
            originalResultBytes,
            resultBytes: originalResultBytes,
            payloadTruncatedCount: 0,
        };
    }

    const results = inputResults.map((row) => ({ ...row }));
    /** @type {{row:Record<string,unknown>;key:'content'|'output';original:string;originalBytes:number}[]} */
    const heavyText = [];
    let payloadTruncatedCount = 0;

    for (const row of results) {
        let structuralBytes = 0;
        let structuralOmitted = false;
        for (const key of STRUCTURAL_PAYLOAD_KEYS) {
            const value = row[key];
            if (!Array.isArray(value) || value.length === 0) continue;
            structuralBytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
            row[key] = [];
            structuralOmitted = true;
        }
        if (structuralOmitted) {
            row['payloadTruncated'] = true;
            row['payloadOmittedForBatchBudget'] = true;
            row['originalStructuralPayloadBytes'] = structuralBytes;
            row['payloadRecoveryCursor'] = typeof row['cursor'] === 'string' ? row['cursor'] : null;
            row['payloadRecoveryStrategy'] = 'repeat-same-page-with-larger-batch-budget-or-single-call';
            payloadTruncatedCount += 1;
        }
        for (const key of TEXT_PAYLOAD_KEYS) {
            const value = row[key];
            if (typeof value !== 'string' || value.length === 0) continue;
            heavyText.push({ row, key, original: value, originalBytes: Buffer.byteLength(value, 'utf8') });
            row[key] = '';
        }
    }

    const skeletonBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    let remaining = Math.max(0, effectiveBudget - skeletonBytes - 4096);
    let remainingFields = heavyText.length;
    for (const field of heavyText) {
        const share = remainingFields > 0 ? Math.max(0, Math.floor(remaining / remainingFields)) : 0;
        const bounded = truncateUtf8String(field.original, share);
        field.row[field.key] = bounded.text;
        if (bounded.truncated) {
            if (field.row['payloadTruncated'] !== true) payloadTruncatedCount += 1;
            field.row['payloadTruncated'] = true;
            field.row['originalPayloadBytes'] = field.originalBytes;
        }
        remaining = Math.max(0, remaining - Buffer.byteLength(bounded.text, 'utf8'));
        remainingFields -= 1;
    }

    let resultBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    if (resultBytes > effectiveBudget) {
        for (const field of heavyText) {
            if (field.row['payloadTruncated'] !== true) payloadTruncatedCount += 1;
            field.row[field.key] = '';
            field.row['payloadTruncated'] = true;
            field.row['payloadOmittedForBatchBudget'] = true;
            field.row['originalPayloadBytes'] = field.originalBytes;
        }
        resultBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    }
    return {
        results,
        resultBudgetBytes: effectiveBudget,
        originalResultBytes,
        resultBytes,
        payloadTruncatedCount,
    };
}

/** @param {Record<string, unknown>[]} results */
function inspectRepoReadBatchContinuation(results) {
    let availableOperations = 0;
    let transportRequiredOperations = 0;
    let recommendedOperations = 0;
    for (const row of results) {
        const nextCursor = typeof row['nextCursor'] === 'string' && row['nextCursor'].length > 0;
        const hasMore = row['hasMore'] === true;
        const transportRequired = row['payloadTruncated'] === true;
        const recommended = transportRequired || hasMore || row['truncated'] === true;
        const available = transportRequired || hasMore || nextCursor;
        if (available) availableOperations += 1;
        if (transportRequired) transportRequiredOperations += 1;
        if (recommended) recommendedOperations += 1;
    }
    return { availableOperations, transportRequiredOperations, recommendedOperations };
}

/**
 * @param {RepoReadBatchExecution} execution
 * @param {{
 *   rows?:Record<string,unknown>[] | undefined;
 *   budgetBytes?:number | undefined;
 *   limits:RepoReadBatchLimits;
 *   marker:string;
 *   modePrefix:string;
 *   sizeHintSource:string;
 *   summaryNoun:string;
 * }} options
 */
export function frameRepoReadBatchExecution(execution, options) {
    const rows = options.rows ?? compactRepoReadBatchExecution(execution);
    const bounded = boundRepoReadBatchPayload(
        rows,
        options.budgetBytes ?? options.limits.defaultResultBudgetBytes,
        options.limits,
    );
    const structured = {
        success: execution.failedCount === 0 && execution.skippedCount === 0,
        [options.marker]: true,
        executionId: execution.executionId,
        failureMode: execution.failureMode,
        requestCount: execution.requestCount,
        attemptedCount: execution.attemptedCount,
        succeededCount: execution.succeededCount,
        failedCount: execution.failedCount,
        skippedCount: execution.skippedCount,
        concurrency: execution.concurrency,
        maxInFlight: execution.maxInFlight,
        inputBytes: execution.inputBytes,
        durationMs: execution.durationMs,
        resultBudgetBytes: bounded.resultBudgetBytes,
        originalResultBytes: bounded.originalResultBytes,
        resultBytes: bounded.resultBytes,
        payloadTruncatedCount: bounded.payloadTruncatedCount,
        results: bounded.results,
    };
    const text = `${options.summaryNoun} batch completed: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped; payloads are in structuredContent.results.`;
    const result = withResultSizeHint(okResult(structured, text), {
        bytes: estimateStructuredTextResultBytes(structured, text),
        strategy: 'conservative-estimate',
        source: options.sizeHintSource,
    });
    const continuation = inspectRepoReadBatchContinuation(bounded.results);
    return withResultExecutionHint(result, {
        logicalOperations: execution.requestCount,
        failedOperations: execution.failedCount,
        skippedOperations: execution.skippedCount,
        mode: `${options.modePrefix}:${execution.failureMode}`,
        batchSize: execution.requestCount,
        batchCapacity: options.limits.maxBatchItems,
        resultBudgetBytes: bounded.resultBudgetBytes,
        truncatedOperations: bounded.payloadTruncatedCount,
        continuationAvailable: continuation.availableOperations > 0,
        continuationAvailableOperations: continuation.availableOperations,
        continuationTransportRequired: continuation.transportRequiredOperations > 0,
        continuationTransportRequiredOperations: continuation.transportRequiredOperations,
        continuationRecommended: continuation.recommendedOperations > 0,
        continuationRecommendedOperations: continuation.recommendedOperations,
    });
}
