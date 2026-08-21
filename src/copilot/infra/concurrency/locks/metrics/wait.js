// @ts-check
/**
 * Métricas bounded compartilhadas pelos locks L0 e L1.
 *
 * @module copilot/infra/concurrency/locks/metrics/wait
 */

import { createHistogram } from 'node:perf_hooks';

const DEFAULT_MAX_OPERATIONS = 32;
const MAX_OPERATION_LENGTH = 64;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeLockOperation(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return 'unspecified';
    if (raw.includes('/') || raw.includes('\\') || /^[a-z]:/i.test(raw)) return 'redacted';
    const sanitized = raw.replaceAll(/[^a-zA-Z0-9_.:-]/g, '_');
    return sanitized.slice(0, MAX_OPERATION_LENGTH) || 'unspecified';
}

/**
 * @param {ReturnType<typeof createHistogram>} histogram
 * @returns {{ count: number; mean: number; p50: number; p95: number; p99: number; max: number }}
 */
function histogramSnapshot(histogram) {
    if (histogram.count === 0) {
        return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
    return {
        count: histogram.count,
        mean: Math.round(histogram.mean),
        p50: histogram.percentile(50),
        p95: histogram.percentile(95),
        p99: histogram.percentile(99),
        max: histogram.max,
    };
}

/**
 * @param {number} [maxOperations]
 */
export function createBoundedLockWaitMetrics(maxOperations = DEFAULT_MAX_OPERATIONS) {
    const overall = createHistogram();
    /** @type {Map<string, ReturnType<typeof createHistogram>>} */
    const byOperation = new Map();

    return {
        /**
         * @param {number} waitMs
         * @param {unknown} operation
         */
        record(waitMs, operation) {
            const value = Math.max(1, Math.round(Number.isFinite(waitMs) ? waitMs : 0));
            overall.record(value);
            const operationKey = sanitizeLockOperation(operation);
            let histogram = byOperation.get(operationKey);
            if (!histogram) {
                if (byOperation.size >= Math.max(1, maxOperations)) {
                    const oldest = byOperation.keys().next().value;
                    if (typeof oldest === 'string') byOperation.delete(oldest);
                }
                histogram = createHistogram();
                byOperation.set(operationKey, histogram);
            }
            histogram.record(value);
        },

        /**
         * @returns {{
         *     overall: ReturnType<typeof histogramSnapshot>;
         *     byOperation: Record<string, ReturnType<typeof histogramSnapshot>>;
         *     operationCardinality: number;
         *     maxOperationCardinality: number;
         * }}
         */
        snapshot() {
            /** @type {Record<string, ReturnType<typeof histogramSnapshot>>} */
            const operations = {};
            for (const [operation, histogram] of byOperation) {
                operations[operation] = histogramSnapshot(histogram);
            }
            return {
                overall: histogramSnapshot(overall),
                byOperation: operations,
                operationCardinality: byOperation.size,
                maxOperationCardinality: Math.max(1, maxOperations),
            };
        },
    };
}
