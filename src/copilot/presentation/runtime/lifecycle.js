// @ts-check
/**
 * @module copilot/presentation/runtime-lifecycle
 * @file Projection compartilhada do lifecycle de processo: boot/shutdown e handlers registrados.
 */

import { getBootLifecycleMetrics, getLastBootLifecycleReport, readCopilotBootConfig } from '#copilot/boot';
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
 *     bootConfig: ReturnType<typeof readCopilotBootConfig>;
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
 *     capabilities: {
 *         canonicalEntrypoint: string;
 *         serverUrl: string;
 *         sdkRoutesEnabled: boolean;
 *         terminalDeclaredEnabled: boolean;
 *         configDiscoveryDefault: boolean;
 *         subAgentStreamingDefault: boolean;
 *         sessionFsEnabled: boolean;
 *         bootSurfaceValidated: boolean;
 *         warnings: string[];
 *     };
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
        bootConfig: readCopilotBootConfig(),
        shutdownHandlers: listShutdownHandlers(),
        lastShutdownReport: getLastShutdownReport(),
        shutdownMetrics: getShutdownLifecycleMetrics(),
        activeTimers: listActiveTimers(),
    };
}

/**
 * @param {RuntimeLifecycleSnapshot} lifecycle
 * @returns {RuntimeLifecycleSummary['capabilities']}
 */
function buildRuntimeCapabilitySummary(lifecycle) {
    const boot = lifecycle.lastBootReport;
    const bootConfig = lifecycle.bootConfig;
    const bootSurfaceValidationPhase = boot?.phases.find((phase) => phase.id === 'boot-surface-validation') ?? null;
    /** @type {string[]} */
    const warnings = [];
    if (!bootConfig.sdk.enabled) warnings.push('sdk_routes_disabled');
    if (!bootConfig.terminal.enabled) warnings.push('terminal_flag_disabled');
    if (!bootConfig.sessionDefaults.enableConfigDiscovery) warnings.push('config_discovery_disabled');
    if (!bootConfig.sessionDefaults.includeSubAgentStreamingEvents) warnings.push('subagent_streaming_guarded');
    if (bootSurfaceValidationPhase?.status !== 'ok') warnings.push('boot_surface_validation_incomplete');
    return {
        canonicalEntrypoint: bootConfig.entrypoints.canonical,
        serverUrl: bootConfig.server.url,
        sdkRoutesEnabled: bootConfig.sdk.enabled,
        terminalDeclaredEnabled: bootConfig.terminal.enabled,
        configDiscoveryDefault: bootConfig.sessionDefaults.enableConfigDiscovery,
        subAgentStreamingDefault: bootConfig.sessionDefaults.includeSubAgentStreamingEvents,
        sessionFsEnabled: bootConfig.sdk.sessionFs.enabled,
        bootSurfaceValidated: bootSurfaceValidationPhase?.status === 'ok',
        warnings,
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
        capabilities: buildRuntimeCapabilitySummary(lifecycle),
    };
}
