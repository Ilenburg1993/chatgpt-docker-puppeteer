// @ts-check
/**
 * @module copilot/presentation/realtime/sse/envelope
 * @file Helpers para metadados internos de envelope SSE.
 */

/** Campo interno usado para propagar o ID canônico de replay entre fanout e pools SSE. */
export const SSE_REPLAY_EVENT_ID_FIELD = '__terminalSseEventId';

/**
 * Anexa o ID de replay canônico ao payload publicado no fanout interno.
 *
 * @param {object} data
 * @param {number} eventId
 * @returns {object}
 */
export function attachSseReplayEventId(data, eventId) {
    return { ...data, [SSE_REPLAY_EVENT_ID_FIELD]: eventId };
}

/**
 * Remove metadados internos de replay antes de expor payloads a clientes públicos.
 *
 * @param {object} data
 * @returns {{ payload: object; eventId: number | undefined }}
 */
export function detachSseReplayEventId(data) {
    const record = /** @type {Record<string, unknown>} */ (data);
    const rawEventId = record[SSE_REPLAY_EVENT_ID_FIELD];
    const eventId = Number.isFinite(rawEventId) ? Number(rawEventId) : undefined;
    const { [SSE_REPLAY_EVENT_ID_FIELD]: _internal, ...payload } = record;
    return { payload, eventId };
}
