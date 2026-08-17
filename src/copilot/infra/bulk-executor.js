// @ts-check
/**
 * Shared bounded bulk execution primitive.
 *
 * This module is intentionally protocol-agnostic: MCP and the local LLM-B tool surface can reuse the same scheduler
 * without sharing tool schemas, authorization or presentation contracts.
 *
 * @module copilot/infra/bulk-executor
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const DEFAULT_BULK_CONCURRENCY = 4;
export const MAX_BULK_CONCURRENCY = 32;
export const DEFAULT_BULK_MAX_ITEMS = 64;
export const HARD_BULK_MAX_ITEMS = 256;

/** @typedef {'best-effort' | 'fail-fast'} BulkFailureMode */

/**
 * @template T
 * @typedef {{
 *     index: number;
 *     status: 'succeeded';
 *     success: true;
 *     durationMs: number;
 *     value: T;
 * } | {
 *     index: number;
 *     status: 'failed';
 *     success: false;
 *     durationMs: number;
 *     value?: T;
 *     error?: string;
 *     code?: string | null;
 * } | {
 *     index: number;
 *     status: 'skipped';
 *     success: false;
 *     durationMs: 0;
 *     reason: string;
 * }} BulkOperationResult
 */

/**
 * @template T,U
 * @typedef {{
 *     executionId: string;
 *     failureMode: BulkFailureMode;
 *     requestCount: number;
 *     attemptedCount: number;
 *     succeededCount: number;
 *     failedCount: number;
 *     skippedCount: number;
 *     concurrency: number;
 *     maxInFlight: number;
 *     inputBytes: number | null;
 *     durationMs: number;
 *     results: BulkOperationResult<U>[];
 * }} BulkExecutionResult
 */

/**
 * @template T,U
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<U> | U} worker
 * @param {{
 *     concurrency?: number;
 *     failureMode?: BulkFailureMode;
 *     maxItems?: number;
 *     maxInputBytes?: number;
 *     estimateItemBytes?: (item: T, index: number) => number;
 *     isFailure?: (value: U, index: number) => boolean;
 * }} [options]
 * @returns {Promise<BulkExecutionResult<T,U>>}
 */
export async function runBoundedOperationBatch(items, worker, options = {}) {
    if (!Array.isArray(items)) throw bulkLimitError('Bulk items must be an array.', 'ERR_BULK_ITEMS_REQUIRED');
    if (typeof worker !== 'function') throw bulkLimitError('Bulk worker must be a function.', 'ERR_BULK_WORKER_REQUIRED');

    const maxItems = normalizeMaxItems(options.maxItems);
    if (items.length > maxItems) {
        throw bulkLimitError(`Bulk request contains ${items.length} items; limit is ${maxItems}.`, 'ERR_BULK_ITEM_LIMIT');
    }

    const inputBytes = estimateTotalInputBytes(items, options.estimateItemBytes);
    if (
        inputBytes !== null &&
        Number.isFinite(options.maxInputBytes) &&
        Number(options.maxInputBytes) >= 0 &&
        inputBytes > Number(options.maxInputBytes)
    ) {
        throw bulkLimitError(
            `Bulk request is ${inputBytes} bytes; limit is ${Math.floor(Number(options.maxInputBytes))}.`,
            'ERR_BULK_INPUT_BYTES_LIMIT',
        );
    }

    const failureMode = options.failureMode === 'fail-fast' ? 'fail-fast' : 'best-effort';
    const concurrency = normalizeConcurrency(options.concurrency, items.length);
    const executionId = randomUUID();
    const startedAt = performance.now();
    /** @type {BulkOperationResult<U>[]} */
    const results = new Array(items.length);
    let nextIndex = 0;
    let stopRequested = false;
    let inFlight = 0;
    let maxInFlight = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            if (failureMode === 'fail-fast' && stopRequested) return;
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            const item = /** @type {T} */ (items[index]);
            const itemStartedAt = performance.now();
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            try {
                const value = await worker(item, index);
                const failed = options.isFailure?.(value, index) === true;
                const durationMs = roundDuration(performance.now() - itemStartedAt);
                if (failed) {
                    results[index] = { index, status: 'failed', success: false, durationMs, value };
                    if (failureMode === 'fail-fast') stopRequested = true;
                } else {
                    results[index] = { index, status: 'succeeded', success: true, durationMs, value };
                }
            } catch (error) {
                const durationMs = roundDuration(performance.now() - itemStartedAt);
                results[index] = {
                    index,
                    status: 'failed',
                    success: false,
                    durationMs,
                    error: error instanceof Error ? error.message : String(error),
                    code: readErrorCode(error),
                };
                if (failureMode === 'fail-fast') stopRequested = true;
            } finally {
                inFlight -= 1;
            }
        }
    });
    await Promise.all(workers);

    for (let index = 0; index < items.length; index += 1) {
        if (results[index]) continue;
        results[index] = {
            index,
            status: 'skipped',
            success: false,
            durationMs: 0,
            reason: failureMode === 'fail-fast' ? 'fail-fast-stop' : 'not-attempted',
        };
    }

    const attemptedCount = results.filter((result) => result.status !== 'skipped').length;
    const succeededCount = results.filter((result) => result.status === 'succeeded').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;
    const skippedCount = results.length - attemptedCount;
    return {
        executionId,
        failureMode,
        requestCount: items.length,
        attemptedCount,
        succeededCount,
        failedCount,
        skippedCount,
        concurrency,
        maxInFlight,
        inputBytes,
        durationMs: roundDuration(performance.now() - startedAt),
        results,
    };
}

/** @param {unknown} value @param {number} itemCount */
function normalizeConcurrency(value, itemCount) {
    const parsed = Number(value ?? DEFAULT_BULK_CONCURRENCY);
    const bounded = Number.isFinite(parsed)
        ? Math.max(1, Math.min(MAX_BULK_CONCURRENCY, Math.floor(parsed)))
        : DEFAULT_BULK_CONCURRENCY;
    return itemCount > 0 ? Math.min(bounded, itemCount) : 0;
}

/** @param {unknown} value */
function normalizeMaxItems(value) {
    const parsed = Number(value ?? DEFAULT_BULK_MAX_ITEMS);
    return Number.isFinite(parsed)
        ? Math.max(1, Math.min(HARD_BULK_MAX_ITEMS, Math.floor(parsed)))
        : DEFAULT_BULK_MAX_ITEMS;
}

/**
 * @template T
 * @param {T[]} items
 * @param {((item: T, index: number) => number) | undefined} estimator
 * @returns {number | null}
 */
function estimateTotalInputBytes(items, estimator) {
    if (typeof estimator !== 'function') return null;
    let total = 0;
    for (const [index, item] of items.entries()) {
        const bytes = Number(estimator(item, index));
        if (!Number.isFinite(bytes) || bytes < 0) {
            throw bulkLimitError(`Invalid input byte estimate for bulk item ${index}.`, 'ERR_BULK_INPUT_BYTES_ESTIMATE');
        }
        total += Math.ceil(bytes);
        if (!Number.isSafeInteger(total)) {
            throw bulkLimitError('Bulk input byte estimate overflowed the safe integer range.', 'ERR_BULK_INPUT_BYTES_ESTIMATE');
        }
    }
    return total;
}

/** @param {unknown} error @returns {string | null} */
function readErrorCode(error) {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    const code = /** @type {{ code?: unknown }} */ (error).code;
    return typeof code === 'string' && code.trim() ? code : null;
}

/** @param {number} value */
function roundDuration(value) {
    return Math.round(Math.max(0, value) * 1000) / 1000;
}

/** @param {string} message @param {string} code */
function bulkLimitError(message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    error.code = code;
    return error;
}
