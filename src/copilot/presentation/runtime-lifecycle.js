// @ts-check
/**
 * @module copilot/presentation/runtime-lifecycle
 * @file Projection compartilhada do lifecycle de processo: boot/shutdown e handlers registrados.
 */

import { getBootLifecycleMetrics, getLastBootLifecycleReport } from '#copilot/boot';
import {
    getLastShutdownReport,
    getShutdownLifecycleMetrics,
    isShuttingDown,
    listActiveTimers,
    listShutdownHandlers,
} from '#copilot/core';

/**
 * @typedef {{
 *     shuttingDown: boolean;
 *     lastBootReport: ReturnType<typeof getLastBootLifecycleReport>;
 *     bootMetrics: ReturnType<typeof getBootLifecycleMetrics>;
 *     shutdownHandlers: ReturnType<typeof listShutdownHandlers>;
 *     lastShutdownReport: ReturnType<typeof getLastShutdownReport>;
 *     shutdownMetrics: ReturnType<typeof getShutdownLifecycleMetrics>;
 *     activeTimers: ReturnType<typeof listActiveTimers>;
 * }} RuntimeLifecycleSnapshot
 *
 *
 * @typedef {{
 *     shuttingDown: boolean;
 *     boot: {
 *         status: 'ok' | 'failed';
 *         phases: string;
 *         phaseCount: number;
 *         completedCount: number;
 *         okCount: number;
 *         skippedCount: number;
 *         failedCount: number;
 *         timeoutCount: number;
 *         failedPhase: string | null;
 *         lastPhase: string | null;
 *         durationMs: number;
 *     } | null;
 *     shutdown: {
 *         status: 'ok' | 'failed';
 *         reason: string;
 *         handlers: string;
 *         handlerCount: number;
 *         okCount: number;
 *         failedCount: number;
 *         timeoutCount: number;
 *         failedHandler: string | null;
 *         durationMs: number;
 *     } | null;
 *     registeredShutdownHandlers: number;
 *     activeTimerCount: number;
 *     oldestActiveTimer: { id: string; type: 'timeout' | 'interval'; ageMs: number } | null;
 * }} RuntimeLifecycleSummary
 */

/**
 * Lê o lifecycle operacional do processo Copilot sem expor mutadores do core.
 *
 * @returns {RuntimeLifecycleSnapshot}
 */
export function readRuntimeLifecycleSnapshot() {
    return {
        shuttingDown: isShuttingDown(),
        lastBootReport: getLastBootLifecycleReport(),
        bootMetrics: getBootLifecycleMetrics(),
        shutdownHandlers: listShutdownHandlers(),
        lastShutdownReport: getLastShutdownReport(),
        shutdownMetrics: getShutdownLifecycleMetrics(),
        activeTimers: listActiveTimers(),
    };
}

/**
 * Projeta uma versão curta e estável do lifecycle para `/status` e UX local.
 *
 * @param {RuntimeLifecycleSnapshot} [lifecycle]
 * @returns {RuntimeLifecycleSummary}
 */
export function buildRuntimeLifecycleSummary(lifecycle = readRuntimeLifecycleSnapshot()) {
    const boot = lifecycle.lastBootReport;
    const shutdown = lifecycle.lastShutdownReport;
    const lastBootPhase = boot?.phases[boot.phases.length - 1] ?? null;
    const failedShutdownHandler = shutdown?.handlers.find((handler) => handler.status !== 'ok') ?? null;
    const bootSkippedCount = boot?.skippedCount ?? 0;
    const bootFailedCount = boot?.failedCount ?? (boot?.status === 'failed' ? 1 : 0);
    const bootTimeoutCount = boot?.timeoutCount ?? 0;
    const bootCompletedCount = boot ? boot.okCount + bootSkippedCount : 0;
    const oldestActiveTimer = lifecycle.activeTimers[0] ?? null;
    return {
        shuttingDown: lifecycle.shuttingDown,
        boot: boot
            ? {
                  status: boot.status,
                  phases: `${bootCompletedCount}/${boot.phaseCount}`,
                  phaseCount: boot.phaseCount,
                  completedCount: bootCompletedCount,
                  okCount: boot.okCount,
                  skippedCount: bootSkippedCount,
                  failedCount: bootFailedCount,
                  timeoutCount: bootTimeoutCount,
                  failedPhase: boot.failedPhase,
                  lastPhase: lastBootPhase?.id ?? null,
                  durationMs: boot.durationMs,
              }
            : null,
        shutdown: shutdown
            ? {
                  status: shutdown.failedCount > 0 || shutdown.timeoutCount > 0 ? 'failed' : 'ok',
                  reason: shutdown.reason,
                  handlers: `${shutdown.okCount}/${shutdown.handlerCount}`,
                  handlerCount: shutdown.handlerCount,
                  okCount: shutdown.okCount,
                  failedCount: shutdown.failedCount,
                  timeoutCount: shutdown.timeoutCount,
                  failedHandler: failedShutdownHandler?.name ?? null,
                  durationMs: shutdown.durationMs,
              }
            : null,
        registeredShutdownHandlers: lifecycle.shutdownHandlers.length,
        activeTimerCount: lifecycle.activeTimers.length,
        oldestActiveTimer: oldestActiveTimer
            ? { id: oldestActiveTimer.id, type: oldestActiveTimer.type, ageMs: oldestActiveTimer.ageMs }
            : null,
    };
}
