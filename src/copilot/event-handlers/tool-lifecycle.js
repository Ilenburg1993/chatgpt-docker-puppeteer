// @ts-check
/**
 * @module copilot/event-handlers/tool-lifecycle
 * @see EventBus
 * Faixa B3: Bridge canônico de todos os eventos de lifecycle de tools vindos da sessão SDK.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/sdk/session';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireToolLifecycleEvents(session, { emit }) {
    return [
        // ── tool.execution_start ────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.TOOL_EXECUTION_START, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            const toolName = /** @type {string | undefined} */ (data['toolName']);
            const mcpServerName = /** @type {string | undefined} */ (data['mcpServerName']);
            log('INFO', `[tool-lifecycle] start: ${toolName ?? toolCallId ?? '?'} call=${toolCallId ?? '?'}`);
            emit('tool.execution_start', {
                toolCallId,
                toolName,
                args: data['arguments'] ?? data['args'] ?? {},
                mcpServerName: mcpServerName ?? null,
                requestId: /** @type {string | undefined} */ (data['requestId']) ?? null,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── tool.execution_partial_result ───────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.TOOL_EXECUTION_PARTIAL_RESULT, (evt) => {
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
        onSessionEvent(session, SESSION_EVENTS.TOOL_EXECUTION_PROGRESS, (evt) => {
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
        onSessionEvent(session, SESSION_EVENTS.TOOL_USER_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[tool-lifecycle] user_requested: ${toolName ?? '?'} requestId=${requestId ?? '?'}`);
            emit('tool.user_requested', { toolName, requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── tool.execution_complete ─────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.TOOL_EXECUTION_COMPLETE, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            const toolName = /** @type {string | undefined} */ (data['toolName']);
            const success = /** @type {boolean | undefined} */ (data['success']);
            log('DEBUG', `[tool-lifecycle] complete: ${toolName ?? toolCallId ?? '?'} success=${success ?? '?'}`);
            emit('tool.execution_complete', {
                toolCallId,
                toolName: toolName ?? null,
                args: data['arguments'] ?? data['args'] ?? null,
                result: data['result'] ?? data['output'] ?? null,
                success: success ?? false,
                requestId: /** @type {string | undefined} */ (data['requestId']) ?? null,
                durationMs: /** @type {number | undefined} */ (data['durationMs']) ?? null,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── external_tool.requested ─────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXTERNAL_TOOL_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName'] ?? data['name']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            log(
                'INFO',
                `[tool-lifecycle] external requested: ${toolName ?? '?'} requestId=${requestId ?? '?'} toolCallId=${toolCallId ?? '?'}`,
            );
            emit('external_tool.requested', {
                toolName,
                requestId,
                toolCallId,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── external_tool.completed ─────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXTERNAL_TOOL_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName'] ?? data['name']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const success = /** @type {boolean | undefined} */ (data['success']);
            const toolCallId = /** @type {string | undefined} */ (data['toolCallId']);
            log('DEBUG', `[tool-lifecycle] external completed: ${toolName ?? '?'} requestId=${requestId ?? '?'}`);
            emit('external_tool.completed', {
                toolName,
                requestId,
                toolCallId,
                success,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),
    ];
}
