// @ts-check
/** Instance-owned bounded per-operation latency histograms. @module copilot/infra/telemetry/latency */
import { createHistogram } from 'node:perf_hooks';

export function createIoLatencyRuntime() {
    const maxHistograms = 64;
    /** @type {Map<string,ReturnType<typeof createHistogram>>} */ const histograms = new Map();
    /** @param {string} operation */
    function histogramFor(operation) {
        let histogram = histograms.get(operation);
        if (!histogram) {
            if (histograms.size >= maxHistograms) {
                const oldest = histograms.keys().next().value;
                if (typeof oldest === 'string') histograms.delete(oldest);
            }
            histogram = createHistogram();
            histograms.set(operation, histogram);
        }
        return histogram;
    }
    /** @param {string} operation @param {number|undefined} durationMs */
    function record(operation, durationMs) {
        if (!Number.isFinite(durationMs) || Number(durationMs) <= 0) return;
        histogramFor(operation).record(Math.max(1, Math.round(Number(durationMs))));
    }
    function stats() {
        /** @type {Record<string,{mean:number;p50:number;p95:number;p99:number;count:number}>} */ const out = {};
        for (const [operation, histogram] of histograms) {
            out[operation] = {
                mean: Math.round(histogram.mean),
                p50: histogram.percentile(50),
                p95: histogram.percentile(95),
                p99: histogram.percentile(99),
                count: histogram.count,
            };
        }
        return out;
    }
    function reset() {
        histograms.clear();
    }
    return Object.freeze({ record, stats, reset, dispose: reset });
}
