// @ts-check
/**
 * @module copilot/event-handlers/streaming
 * @see EventBus
 * F62.3: Handler de eventos de streaming de tokens (reasoning + message delta).
 */

import { SESSION_EVENTS } from '#copilot/events';
import { onSessionEvent } from '../sdk/session/events.js';

/**
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<
 *     import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks,
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
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_MESSAGE_DELTA, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const chunk = /** @type {string} */ (d['deltaContent'] ?? d['content'] ?? '');
            if (!chunk) return;

            if (dialogLoopActive()) {
                emit('dialog.delta', { chunk });
                return;
            }
            if (isProcessing()) return;
            emit('task.delta', { taskId: null, chunk });
        }),
    ];
}
