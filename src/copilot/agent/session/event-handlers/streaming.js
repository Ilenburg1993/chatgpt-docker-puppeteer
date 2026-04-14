// @ts-check
/**
 * @module copilot/agent/session/event-handlers/streaming
 * @see EventBus
 * F62.3: Handler de eventos de streaming de tokens (reasoning + message delta).
 */

import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit' | 'isProcessing' | 'dialogLoopActive'>} cb
 * @returns {(() => void)[]}
 */
export function wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        session.on(SESSION_EVENTS.ASSISTANT_REASONING_DELTA, (evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (evt?.data?.['reasoningId'] ?? null),
                });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_MESSAGE_DELTA, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const chunk = /** @type {string} */ (d.deltaContent ?? d.content ?? '');
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
