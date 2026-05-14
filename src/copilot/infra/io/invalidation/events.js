// @ts-check
/**
 * Tipos e normalização de eventos de invalidação de I/O.
 *
 * @module copilot/infra/io/invalidation/events
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
