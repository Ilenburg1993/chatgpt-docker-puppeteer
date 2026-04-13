// @ts-check
/**
 * src/copilot/observability/collectors/tool-handlers.js
 *
 * Handlers de eventos de tool execution do EventCollector.
 *
 * @module copilot/observability/collectors/tool-handlers
 * @see EventBus
 */

import { globalAuditBuffer } from '#copilot/audit';
import { SESSION_EVENTS as SE } from '#copilot/events';
import { log } from '../logger.js';

/** @typedef {import('./context.js').CollectorContext} CollectorContext */

/** TTL para entradas pending em milissegundos (10 min). */
const _PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Registra handlers de tool.* na sessão SDK.
 *
 * @param {CollectorContext} ctx
 * @returns {(() => void)[]}
 */
export function attachToolHandlers(ctx) {
    const { session, sessionId, metrics, errorTracker, hookBus, persist, persistSet, persistEvent, pending } = ctx;
    /** @type {(() => void)[]} */
    const unsubs = [];

    // ── tool.execution_start ──────────────────────────────────────────────
    unsubs.push(
        session.on(SE.TOOL_EXECUTION_START, (event) => {
            const { toolCallId, toolName, mcpServerName } = event.data;
            const _now = Date.now();
            for (const [id, entry] of pending) {
                if (_now - entry.startTs > _PENDING_TTL_MS) pending.delete(id);
            }
            pending.set(toolCallId, {
                toolName,
                mcpServerName: mcpServerName ?? null,
                startTs: Date.now(),
                toolArgs: /** @type {Record<string, unknown>} */ (event.data.arguments ?? {}),
            });
            if (persist && persistSet.has('tool.execution_start')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    toolName,
                    toolCallId,
                    mcpServerName: mcpServerName ?? null,
                    toolArgs: event.data.arguments ?? {},
                    parentToolCallId: event.data.parentToolCallId ?? null,
                });
            }
        }),
    );

    // ── tool.execution_complete ───────────────────────────────────────────
    unsubs.push(
        session.on(SE.TOOL_EXECUTION_COMPLETE, (event) => {
            const { toolCallId, success } = event.data;
            const pendingEntry = pending.get(toolCallId);
            pending.delete(toolCallId);
            const durationMs = pendingEntry ? Date.now() - pendingEntry.startTs : 0;
            const toolName = pendingEntry?.toolName ?? toolCallId;

            metrics?.recordToolCall(toolName, durationMs, success);
            if (!success && errorTracker) {
                errorTracker.trackError(new Error(`Tool failed: ${toolName}`), {
                    source: 'sdk:tool.execution_complete',
                    sessionId,
                    metadata: { toolName, durationMs },
                });
            }
            hookBus?.emitHook('post_tool_use', sessionId, { toolName, success }, { durationMs });

            globalAuditBuffer.push({
                toolName,
                toolArgs: pendingEntry?.toolArgs ?? {},
                toolResult: event.data.result?.content ?? null,
                sessionId,
                ts: event.timestamp ?? new Date().toISOString(),
                durationMs,
            });

            if (persist && persistSet.has('tool.execution_complete')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    toolName,
                    durationMs,
                    success: event.data.success,
                });
            }

            log(
                'DEBUG',
                `[event-collector] tool.execution_complete: ${toolName} (${durationMs}ms, ${success ? 'ok' : 'err'}) session=${sessionId}`,
            );
        }),
    );

    // ── tool.execution_progress (ephemeral — não persistir) ──────────────
    unsubs.push(
        session.on(SE.TOOL_EXECUTION_PROGRESS, (event) => {
            hookBus?.emitHook(
                'post_tool_use',
                sessionId,
                {
                    _eventType: 'tool.execution_progress',
                    toolCallId: event.data.toolCallId,
                    progressMessage: event.data.progressMessage,
                },
                null,
            );
        }),
    );

    // ── tool.execution_partial_result — contador apenas ──────────────────
    unsubs.push(
        session.on(SE.TOOL_EXECUTION_PARTIAL_RESULT, () => {
            metrics?.recordCounter('tool.execution_partial_result');
        }),
    );

    // ── tool.user_requested ──────────────────────────────────────────────
    unsubs.push(
        session.on(SE.TOOL_USER_REQUESTED, (event) => {
            const { toolCallId, toolName } = event.data;
            metrics?.recordCounter('tool.user_requested');
            if (persist && persistSet.has('tool.user_requested')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    toolCallId,
                    toolName,
                    toolArgs: event.data.arguments ?? {},
                });
            }
            log('DEBUG', `[event-collector] tool.user_requested: ${toolName} session=${sessionId}`);
        }),
    );

    return unsubs;
}
