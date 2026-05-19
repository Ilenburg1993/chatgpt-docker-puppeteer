// @ts-check
/**
 * @module copilot/event-handlers/streaming
 * @see EventBus
 * F62.3: Handler de eventos de streaming de tokens (reasoning + message delta).
 */

import { SESSION_EVENTS } from '#copilot/events';
import { onSessionEvent } from '#copilot/sdk/session';

/** @type {WeakSet<object>} */
const SEEN_MESSAGE_DELTA_EVENTS = new WeakSet();

/** @type {WeakMap<object, Set<string>>} */
const SEEN_MESSAGE_DELTA_IDS_BY_SESSION = new WeakMap();

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * @param {Record<string, unknown>} evt
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function resolveMessageDeltaEventId(evt, data) {
    return (
        stringOrEmpty(evt['id']) ||
        stringOrEmpty(evt['eventId']) ||
        stringOrEmpty(data['eventId']) ||
        stringOrEmpty(data['deltaId']) ||
        ''
    );
}

/**
 * Suprime o mesmo evento SDK quando a sessao foi wireada mais de uma vez ou quando o SDK entrega o mesmo objeto por
 * canais internos redundantes. Nao deduplica por chunk puro para preservar respostas que repetem texto legitimamente.
 *
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {unknown} rawEvent
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function shouldSkipDuplicateMessageDelta(session, rawEvent, data) {
    if (rawEvent && typeof rawEvent === 'object') {
        if (SEEN_MESSAGE_DELTA_EVENTS.has(rawEvent)) return true;
        SEEN_MESSAGE_DELTA_EVENTS.add(rawEvent);
    }

    const event = /** @type {Record<string, unknown>} */ (rawEvent ?? {});
    const eventId = resolveMessageDeltaEventId(event, data);
    if (!eventId) return false;

    let seenIds = SEEN_MESSAGE_DELTA_IDS_BY_SESSION.get(session);
    if (!seenIds) {
        seenIds = new Set();
        SEEN_MESSAGE_DELTA_IDS_BY_SESSION.set(session, seenIds);
    }
    if (seenIds.has(eventId)) return true;
    seenIds.add(eventId);
    if (seenIds.size > 2_000) {
        const oldest = seenIds.values().next().value;
        if (typeof oldest === 'string') seenIds.delete(oldest);
    }
    return false;
}

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<
 *     import('./contracts.js').SessionWirerCallbacks,
 *     'emit' | 'isProcessing' | 'dialogLoopActive'
 * >} cb
 * @returns {(() => void)[]}
 */
export function wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_STREAMING_DELTA, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const totalResponseSizeBytes = /** @type {number | undefined} */ (data['totalResponseSizeBytes']);
            if (typeof totalResponseSizeBytes === 'number') {
                emit('assistant.streaming_delta', {
                    totalResponseSizeBytes,
                    ts: evt?.timestamp ?? Date.now(),
                });
            }
        }),
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_REASONING_DELTA, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const chunk = /** @type {string} */ (data['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (data['reasoningId'] ?? null),
                });
        }),
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_MESSAGE_START, () => {
            SEEN_MESSAGE_DELTA_IDS_BY_SESSION.delete(session);
        }),
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_MESSAGE_DELTA, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const chunk = /** @type {string} */ (d['deltaContent'] ?? d['content'] ?? '');
            if (!chunk) return;
            if (shouldSkipDuplicateMessageDelta(session, evt, d)) return;

            if (dialogLoopActive()) {
                emit('dialog.delta', { chunk });
                return;
            }
            if (isProcessing()) return;
            emit('task.delta', { taskId: null, chunk });
        }),
    ];
}
