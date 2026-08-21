// @ts-check
/** Mutable parser counters shared by sibling parser components. */

export const parserRuntimeStats = {
    budgetExceeded: 0,
    skippedByLineGuard: 0,
    lastParseDurationMs: 0,
    workerRequests: 0,
    workerTimeouts: 0,
    workerFailures: 0,
    workerFallbacks: 0,
    workerQueueRejected: 0,
    workerQueueTimeouts: 0,
    workerQueueHighWater: 0,
    workerQueueWaitMsLast: 0,
    workerQueueWaitMsMax: 0,
    workerRestarts: 0,
    workerRestartFailures: 0,
    workerInitFailures: 0,
    workerInitRecoveries: 0,
    symbolCacheHits: 0,
    symbolCacheMisses: 0,
    symbolCacheStale: 0,
    symbolSnapshotReads: 0,
    symbolSuppliedSnapshots: 0,
    symbolFreshnessChecks: 0,
    symbolSnapshotPrechecksAvoided: 0,
    symbolSnapshotConflicts: 0,
};

export function resetParserRuntimeStatsForTest() {
    for (const key of /** @type {(keyof typeof parserRuntimeStats)[]} */ (Object.keys(parserRuntimeStats)))
        parserRuntimeStats[key] = 0;
}
