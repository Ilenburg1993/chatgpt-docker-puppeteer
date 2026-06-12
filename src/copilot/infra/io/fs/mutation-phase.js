// @ts-check
/**
 * Fases observáveis de mutações baixas para telemetria e fault injection determinístico.
 *
 * @module copilot/infra/io/fs/mutation-phase
 */

/**
 * @param {{ onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void> }} options
 * @param {string} phase
 * @param {Record<string, unknown>} details
 * @returns {Promise<void>}
 */
export async function emitMutationPhase(options, phase, details) {
    await options.onPhase?.(phase, details);
}
