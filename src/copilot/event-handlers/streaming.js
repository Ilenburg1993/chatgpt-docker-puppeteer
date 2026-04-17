// @ts-check
/**
 * @module copilot/event-handlers/streaming
 * @see EventBus
 * F62.3: Handler de eventos de streaming de tokens (reasoning + message delta).
 */

import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<
 *     import('#copilot/agent/session/event-wirer').SessionWirerCallbacks,
 *     'emit' | 'isProcessing' | 'dialogLoopActive'
 * >} cb
 * @returns {(() => void)[]}
 */
export function wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        session.on(SESSION_EVENTS.ASSISTANT_REASONING_DELTA, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const chunk = /** @type {string} */ (data['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (data['reasoningId'] ?? null),
                });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_MESSAGE_DELTA, (evt) => {
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
