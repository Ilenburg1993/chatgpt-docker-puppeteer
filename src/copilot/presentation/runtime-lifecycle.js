// @ts-check
/**
 * @module copilot/presentation/runtime-lifecycle
 * @file Projection compartilhada do lifecycle de processo: boot/shutdown e handlers registrados.
 */

import { getLastBootLifecycleReport } from '#copilot/boot';
import { getLastShutdownReport, isShuttingDown, listShutdownHandlers } from '#copilot/core';

/**
 * @typedef {{
 *     shuttingDown: boolean;
 *     lastBootReport: ReturnType<typeof getLastBootLifecycleReport>;
 *     shutdownHandlers: ReturnType<typeof listShutdownHandlers>;
 *     lastShutdownReport: ReturnType<typeof getLastShutdownReport>;
 * }} RuntimeLifecycleSnapshot
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
        shutdownHandlers: listShutdownHandlers(),
        lastShutdownReport: getLastShutdownReport(),
    };
}
