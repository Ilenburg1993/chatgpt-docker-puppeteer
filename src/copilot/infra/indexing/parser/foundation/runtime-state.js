// @ts-check
/**
 * Process-wide parser operational counters.
 *
 * The mutable record is deliberately private: sibling parser modules receive narrow mutation commands and health
 * consumers receive immutable snapshots. This keeps process-global observability without exporting write authority.
 *
 * @module copilot/infra/indexing/parser/foundation/runtime-state
 */

const parserRuntimeStats = {
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
};

/**
 * @typedef {'budgetExceeded'
 *     | 'skippedByLineGuard'
 *     | 'workerRequests'
 *     | 'workerTimeouts'
 *     | 'workerFailures'
 *     | 'workerFallbacks'
 *     | 'workerQueueRejected'
 *     | 'workerQueueTimeouts'
 *     | 'workerRestarts'
 *     | 'workerRestartFailures'
 *     | 'workerInitFailures'
 *     | 'workerInitRecoveries'} ParserRuntimeCounter
 */

/** @param {ParserRuntimeCounter} counter */
export function incrementParserRuntimeCounter(counter) {
    parserRuntimeStats[counter] += 1;
}

/** @param {number} durationMs */
export function recordParserRuntimeDuration(durationMs) {
    parserRuntimeStats.lastParseDurationMs = Math.max(0, Number(durationMs) || 0);
}

/** @param {number} waitMs */
export function recordParserWorkerQueueWait(waitMs) {
    const normalized = Math.max(0, Number(waitMs) || 0);
    parserRuntimeStats.workerQueueWaitMsLast = normalized;
    parserRuntimeStats.workerQueueWaitMsMax = Math.max(parserRuntimeStats.workerQueueWaitMsMax, normalized);
}

/** @param {number} depth */
export function recordParserWorkerQueueDepth(depth) {
    parserRuntimeStats.workerQueueHighWater = Math.max(
        parserRuntimeStats.workerQueueHighWater,
        Math.max(0, Math.trunc(Number(depth) || 0)),
    );
}

export function getParserRuntimeStatsSnapshot() {
    return Object.freeze({ ...parserRuntimeStats });
}
