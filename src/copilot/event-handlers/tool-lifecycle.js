// @ts-check
/**
 * @module copilot/event-handlers/tool-lifecycle
 * @see EventBus
 * Faixa B3: Handlers dedicados para tool.execution_progress, tool.user_requested, tool.execution_start/complete.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireToolLifecycleEvents(session, { emit }) {
    return [
        // ── tool.execution_partial_result ───────────────────────────────
        session.on(SESSION_EVENTS.TOOL_EXECUTION_PARTIAL_RESULT, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            const partialOutput = /** @type {string | undefined} */ (data['partialOutput']);
            if (!partialOutput) return;
            log('DEBUG', `[tool-lifecycle] partial_result: ${toolCallId ?? '?'} len=${partialOutput.length}`);
            emit('tool.execution_partial_result', {
                toolCallId,
                partialOutput,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── tool.execution_progress ──────────────────────────────────────
        session.on(SESSION_EVENTS.TOOL_EXECUTION_PROGRESS, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            const toolName = /** @type {string | undefined} */ (data['toolName']);
            const progress = /** @type {number | undefined} */ (data['progress']);
            const progressMessage = /** @type {string | undefined} */ (data['progressMessage']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log(
                'DEBUG',
                `[tool-lifecycle] progress: ${toolName ?? toolCallId ?? '?'} ${progressMessage ?? progress ?? '?'}`,
            );
            emit('tool.execution_progress', {
                toolCallId,
                toolName,
                progress,
                progressMessage,
                requestId,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── tool.user_requested ──────────────────────────────────────────
        session.on(SESSION_EVENTS.TOOL_USER_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[tool-lifecycle] user_requested: ${toolName ?? '?'} requestId=${requestId ?? '?'}`);
            emit('tool.user_requested', { toolName, requestId, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
