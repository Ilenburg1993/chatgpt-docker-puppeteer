// @ts-check
/** Process-local operation counters/latency for one SQLite L2 cache instance. */
import { performance } from 'node:perf_hooks';
export function createIoL2CacheMetrics() {
    const stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        invalidations: 0,
        errors: 0,
        touchWrites: 0,
        touchSkips: 0,
        admissionSkips: 0,
        batchFlushes: 0,
        batchedRows: 0,
        batchFailures: 0,
    };
    const latency = Object.fromEntries(
        ['get', 'set', 'flush', 'invalidate', 'prune', 'clear'].map((key) => [
            key,
            { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        ]),
    );
    /** @param {'get'|'set'|'flush'|'invalidate'|'prune'|'clear'} operation @param {number} startedAt */
    function recordLatency(operation, startedAt) {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const metric = latency[operation];
        if (!metric) return;
        metric.count += 1;
        metric.totalMs += durationMs;
        metric.lastMs = durationMs;
        metric.maxMs = Math.max(metric.maxMs, durationMs);
    }
    function latencySnapshot() {
        return Object.fromEntries(
            Object.entries(latency).map(([operation, metric]) => [
                operation,
                {
                    count: metric.count,
                    totalMs: Number(metric.totalMs.toFixed(3)),
                    averageMs: metric.count > 0 ? Number((metric.totalMs / metric.count).toFixed(3)) : 0,
                    lastMs: Number(metric.lastMs.toFixed(3)),
                    maxMs: Number(metric.maxMs.toFixed(3)),
                },
            ]),
        );
    }
    return { stats, recordLatency, latencySnapshot };
}
