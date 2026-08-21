// @ts-check
/** Bounded per-operation latency histograms. */
import { createHistogram } from 'node:perf_hooks';

const MAX_IO_LATENCY_HISTOGRAMS = 64;
/** @type {Map<string, ReturnType<typeof createHistogram>>} */
const latencyHistograms = new Map();

/** @param {string} operation */
function getOrCreateHistogram(operation) {
    let histogram = latencyHistograms.get(operation);
    if (!histogram) {
        if (latencyHistograms.size >= MAX_IO_LATENCY_HISTOGRAMS) {
            const oldest = latencyHistograms.keys().next().value;
            if (typeof oldest === 'string') latencyHistograms.delete(oldest);
        }
        histogram = createHistogram();
        latencyHistograms.set(operation, histogram);
    }
    return histogram;
}

/** @param {string} operation @param {number | undefined} durationMs */
export function recordIoLatency(operation, durationMs) {
    if (!Number.isFinite(durationMs) || Number(durationMs) <= 0) return;
    getOrCreateHistogram(operation).record(Math.max(1, Math.round(Number(durationMs))));
}

/** @returns {Record<string, { mean: number; p50: number; p95: number; p99: number; count: number }>} */
export function getIoLatencyStats() {
    /** @type {Record<string, { mean: number; p50: number; p95: number; p99: number; count: number }>} */
    const stats = {};
    for (const [operation, histogram] of latencyHistograms) {
        stats[operation] = {
            mean: Math.round(histogram.mean),
            p50: histogram.percentile(50),
            p95: histogram.percentile(95),
            p99: histogram.percentile(99),
            count: histogram.count,
        };
    }
    return stats;
}
