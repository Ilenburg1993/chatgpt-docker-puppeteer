// @ts-check
/**
 * @module copilot/agent/session/event-handlers/streaming
 * F62.3: Handler de eventos de streaming de tokens (reasoning + message delta).
 */

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit' | 'isProcessing' | 'dialogLoopActive'>} cb
 * @returns {(() => void)[]}
 */
export function wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        session.on('assistant.reasoning_delta', (/** @type {any} */ evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (evt?.data?.['reasoningId'] ?? null),
                });
        }),
        session.on('assistant.message_delta', (/** @type {any} */ evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? evt?.data?.['content'] ?? '');
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
