// @ts-check
/**
 * Projection family: metrics.
 */

import { defaultErrorTracker } from '#copilot/observability';
import { readToolStatsProjection } from '../../../presentation/system-metrics.js';
import { readTerminalActivitySnapshot } from '../../activity-state.js';
import { normalizeTerminalModelBillingProjection, readTerminalRuntimeBase } from './shared.js';
import { readTerminalTimelineProjection } from './timeline.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     runtimeSessionId: string | null;
 *     contextWindow: import('./shared.js').ContextWindowProjection | null;
 *     pr: Record<string, any> | null;
 *     modelBilling: import('./shared.js').TerminalModelBillingProjection;
 *     turnCount: number;
 *     bridgeTurnCount: number;
 *     timelineSource: import('./timeline.js').TerminalTimelineSource;
 *     timelineAuthority: import('./timeline.js').TerminalTimelineAuthority;
 *     timelineReconciliationStatus: import('./timeline.js').TerminalTimelineReconciliation;
 *     toolCallCount: number;
 *     toolErrorCount: number;
 *     errorStats: { total: number; buffered: number };
 *     activity: import('../../activity-state.js').TerminalActivitySnapshot;
 * }}
 */
export function readTerminalMetricsProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const timeline = readTerminalTimelineProjection({ limitPairs: 10, runtimeId: runtimeId ?? null });
    const pr = /** @type {Record<string, any> | null} */ (base.lastPrInfo ?? null);
    const modelBilling = normalizeTerminalModelBillingProjection(pr, String(base.snap['model'] ?? base.model ?? ''));
    const toolStats = readToolStatsProjection().stats;
    let toolCallCount = 0;
    let toolErrorCount = 0;
    for (const stat of Object.values(toolStats)) {
        toolCallCount += Number(stat['calls'] ?? 0);
        toolErrorCount += Number(stat['errors'] ?? 0);
    }
    const errorStats =
        typeof defaultErrorTracker?.getStats === 'function'
            ? defaultErrorTracker.getStats()
            : { total: 0, buffered: 0 };
    return {
        snap: base.snap,
        health: base.health,
        binding: base.binding,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        runtimeSessionId: base.runtimeSessionId,
        contextWindow: base.contextWindow,
        pr,
        modelBilling,
        turnCount: timeline.turns.length,
        bridgeTurnCount: timeline.bridgeTurnCount,
        timelineSource: timeline.timelineSource,
        timelineAuthority: timeline.timelineAuthority,
        timelineReconciliationStatus: timeline.reconciliationStatus,
        toolCallCount,
        toolErrorCount,
        activity: readTerminalActivitySnapshot(),
        errorStats: {
            total: Number(errorStats.total ?? 0),
            buffered: Number(errorStats.buffered ?? 0),
        },
    };
}

/**
 * @returns {ReturnType<typeof readToolStatsProjection>}
 */
export function readTerminalToolStatsProjection() {
    return readToolStatsProjection();
}

/**
 * @param {number} limit
 * @returns {{
 *     stats: { total: number; buffered: number };
 *     recent: { timestamp: number; errorType?: string; source?: string; message: string }[];
 * }}
 */
export function readTerminalErrorsProjection(limit) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const stats =
        typeof defaultErrorTracker?.getStats === 'function'
            ? defaultErrorTracker.getStats()
            : { total: 0, buffered: 0 };
    const recent = typeof defaultErrorTracker?.getErrors === 'function' ? defaultErrorTracker.getErrors(safeLimit) : [];
    return {
        stats: {
            total: Number(stats.total ?? 0),
            buffered: Number(stats.buffered ?? 0),
        },
        recent,
    };
}
