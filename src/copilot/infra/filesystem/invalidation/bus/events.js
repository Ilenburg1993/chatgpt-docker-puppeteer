// @ts-check
/**
 * Tipos e normalização de eventos de invalidação de I/O.
 *
 * @module copilot/infra/filesystem/invalidation/bus/events
 */

/**
 * @typedef {{
 *     recursive?: boolean;
 *     source?: string;
 * }} IoInvalidationEvent
 */

/**
 * @param {IoInvalidationEvent} [event]
 * @returns {{ recursive: boolean; source: string }}
 */
export function normalizeIoInvalidationEvent(event = {}) {
    return {
        recursive: event.recursive === true,
        source: event.source ?? 'io-cache',
    };
}
