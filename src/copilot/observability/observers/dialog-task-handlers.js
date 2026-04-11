// @ts-check
/**
 * src/copilot/observability/observers/dialog-task-handlers.js
 *
 * Handlers de dialog._, task._, tool._, pr._, model.fallback e session.usage do AgentEventObserver.
 *
 * @module copilot/observability/observers/dialog-task-handlers
 * @see EventBus
 */

import { TimeoutError } from '#copilot/core';
import { AGENT_DIALOG_TURN_TIMEOUT, AGENT_TASK_ERROR } from '#copilot/events';
import { modelStatsTracker } from '#copilot/sdk';
import { log } from '../logger.js';
import { startSpanImmediate } from '../otel.js';

/** @typedef {import('./context.js').ObserverContext} ObserverContext */

/**
 * Registra handlers de dialog/task/tool no EventEmitter do agente.
 *
 * @param {ObserverContext} ctx
 * @returns {{ lastTurnDurationMs: () => number; lastTurnSuccess: () => boolean; resetChunkTs: () => void }} Acessores
 *   para estado compartilhado necessário por outros handler groups.
 */
export function attachDialogTaskHandlers(ctx) {
    const { metrics, errorTracker, agent, on, safe } = ctx;

    // ── Estado local ──────────────────────────────────────────────────────────

    /**
     * Mapa de turnId → { ts, span? } do turn_start ativo.
     *
     * @type {Map<string, { ts: number; span: import('../otel.js').OtelSpan | null }>}
     */
    const _turnStarts = new Map();
    const _TURN_START_TTL_MS = 5 * 60 * 1000;

    let _lastChunkTs = 0;
    let _lastTurnDurationMs = 0;
    let _lastTurnSuccess = true;

    /** @type {Map<string, { toolName: string; ts: number }>} */
    const _toolStarts = new Map();
    const _TOOL_START_TTL_MS = 2 * 60 * 1000;

    /** @type {Map<string, { ts: number; span: import('../otel.js').OtelSpan | null }>} */
    const _taskSpans = new Map();
    const _TASK_SPAN_TTL_MS = 10 * 60 * 1000;

    // ── dialog.turn_start ─────────────────────────────────────────────────────
    on(
        agent,
        'dialog.turn_start',
        safe((/** @type {{ ts?: number; turnId?: string; message?: string }} */ evt) => {
            const ts = performance.now();
            const turnId = evt?.turnId ?? 'current';
            const nowPerf = performance.now();
            for (const [id, entry] of _turnStarts) {
                if (nowPerf - entry.ts > _TURN_START_TTL_MS) {
                    entry.span?.end();
                    _turnStarts.delete(id);
                    log('DEBUG', `[agent-event-observer] dialog.turn_start: TTL expirado para turnId=${id}`);
                }
            }
            const span = startSpanImmediate('copilot.dialog.turn', { turnId });
            _turnStarts.set(turnId, { ts, span });
            if (!evt?.turnId) {
                log(
                    'DEBUG',
                    "[agent-event-observer] dialog.turn_start: turnId ausente, usando chave 'current' (retrocompatibilidade)",
                );
            }
            log('DEBUG', `[agent-event-observer] dialog.turn_start turnId=${turnId}`);
        }, 'dialog.turn_start'),
    );

    // ── dialog.turn_end ───────────────────────────────────────────────────────
    on(
        agent,
        'dialog.turn_end',
        safe((/** @type {{ durationMs?: number; turnId?: string; reply?: string }} */ evt) => {
            const turnId = evt?.turnId ?? 'current';
            const entry = _turnStarts.get(turnId);
            _turnStarts.delete(turnId);
            const durationMs = evt?.durationMs ?? (entry ? performance.now() - entry.ts : 0);
            const success = typeof evt?.reply === 'string' && evt.reply.length > 0;
            metrics.recordDialogTurn(Math.round(durationMs), success);
            _lastTurnDurationMs = Math.round(durationMs);
            _lastTurnSuccess = success;
            if (entry?.span) {
                entry.span.setAttribute('duration_ms', Math.round(durationMs));
                entry.span.setAttribute('success', success);
                entry.span.end();
            }
            _lastChunkTs = 0;
            log(
                'DEBUG',
                `[agent-event-observer] dialog.turn_end turnId=${turnId} durationMs=${Math.round(durationMs)} success=${success}`,
            );
        }, 'dialog.turn_end'),
    );

    // ── dialog.stalled ────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.stalled',
        safe((/** @type {{ stalledMs?: number }} */ evt) => {
            const stalledMs = evt?.stalledMs ?? 0;
            metrics.recordDialogStall(stalledMs);
            metrics.recordCounter('dialog.stalls');
            log('DEBUG', `[agent-event-observer] dialog.stalled stalledMs=${stalledMs}`);
        }, 'dialog.stalled'),
    );

    // ── dialog.turn_timeout ───────────────────────────────────────────────────
    on(
        agent,
        'dialog.turn_timeout',
        safe((/** @type {{ phase?: string; timeoutMs?: number; turnId?: string }} */ evt) => {
            metrics.recordDialogTimeout();
            metrics.recordCounter(`dialog.timeout.${evt?.phase ?? 'unknown'}`);
            if (evt?.turnId) _turnStarts.delete(evt.turnId);
            if (errorTracker) {
                const err = new TimeoutError(`Dialog turn timeout [phase=${evt?.phase ?? 'unknown'}]`);
                errorTracker.trackError(err, {
                    source: AGENT_DIALOG_TURN_TIMEOUT,
                    metadata: { phase: evt?.phase, timeoutMs: evt?.timeoutMs, turnId: evt?.turnId },
                });
            }
            log('DEBUG', `[agent-event-observer] dialog.turn_timeout phase=${evt?.phase}`);
        }, 'dialog.turn_timeout'),
    );

    // ── dialog.loop.changed ───────────────────────────────────────────────────
    on(
        agent,
        'dialog.loop.changed',
        safe((/** @type {{ active?: boolean }} */ evt) => {
            metrics.recordCounter(evt?.active ? 'dialog.loop.activated' : 'dialog.loop.deactivated');
            metrics.recordGauge('dialog.loop.active', evt?.active ? 1 : 0);
            log('DEBUG', `[agent-event-observer] dialog.loop.changed active=${evt?.active}`);
        }, 'dialog.loop.changed'),
    );

    // ── dialog.ready ──────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.ready',
        safe(() => {
            metrics.recordCounter('dialog.ready');
            log('DEBUG', '[agent-event-observer] dialog.ready');
        }, 'dialog.ready'),
    );

    // ── dialog.reply ──────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.reply',
        safe((/** @type {{ reply?: string; turnId?: string }} */ evt) => {
            metrics.recordCounter('dialog.reply');
            log('DEBUG', `[agent-event-observer] dialog.reply turnId=${evt?.turnId ?? '?'}`);
        }, 'dialog.reply'),
    );

    // ── dialog.stopped ────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.stopped',
        safe((/** @type {{ reason?: string }} */ evt) => {
            metrics.recordCounter('dialog.stopped');
            if (evt?.reason) metrics.recordCounter(`dialog.stopped.${evt.reason}`);
            log('DEBUG', `[agent-event-observer] dialog.stopped reason=${evt?.reason ?? '?'}`);
        }, 'dialog.stopped'),
    );

    // ── dialog.paused ─────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.paused',
        safe(() => {
            metrics.recordCounter('dialog.paused');
            log('DEBUG', '[agent-event-observer] dialog.paused');
        }, 'dialog.paused'),
    );

    // ── dialog.resumed ────────────────────────────────────────────────────────
    on(
        agent,
        'dialog.resumed',
        safe(() => {
            metrics.recordCounter('dialog.resumed');
            log('DEBUG', '[agent-event-observer] dialog.resumed');
        }, 'dialog.resumed'),
    );

    // ── task.completed ────────────────────────────────────────────────────────
    on(
        agent,
        'task.completed',
        safe((/** @type {{ durationMs?: number; taskId?: string }} */ evt) => {
            const durationMs = evt?.durationMs ?? 0;
            metrics.recordTaskCompletion(durationMs, true);
            metrics.recordCounter('tasks.completed');
            const taskId = evt?.taskId ?? 'unknown';
            const entry = _taskSpans.get(taskId);
            if (entry) {
                _taskSpans.delete(taskId);
                if (entry.span) {
                    entry.span.setAttribute('duration_ms', Math.round(durationMs));
                    entry.span.setAttribute('success', true);
                    entry.span.end();
                }
            }
            log('DEBUG', `[agent-event-observer] task.completed taskId=${taskId} durationMs=${durationMs}`);
        }, 'task.completed'),
    );

    // ── task.error ────────────────────────────────────────────────────────────
    on(
        agent,
        'task.error',
        safe((/** @type {{ durationMs?: number; taskId?: string; error?: unknown }} */ evt) => {
            const durationMs = evt?.durationMs ?? 0;
            metrics.recordTaskCompletion(durationMs, false);
            metrics.recordCounter('tasks.errors');
            metrics.recordSessionError();
            const taskId = evt?.taskId ?? 'unknown';
            const entry = _taskSpans.get(taskId);
            if (entry) {
                _taskSpans.delete(taskId);
                if (entry.span) {
                    entry.span.setAttribute('duration_ms', Math.round(durationMs));
                    entry.span.setAttribute('success', false);
                    entry.span.setStatus({ code: 2, message: String(evt?.error ?? 'task.error') });
                    if (evt?.error) entry.span.recordException(evt.error);
                    entry.span.end();
                }
            }
            if (errorTracker) {
                const err = evt?.error instanceof Error ? evt.error : new Error(String(evt?.error ?? 'task.error'));
                errorTracker.trackError(err, { source: AGENT_TASK_ERROR, metadata: { taskId } });
            }
            log('WARN', `[agent-event-observer] task.error taskId=${taskId}`);
        }, 'task.error'),
    );

    // ── task.queued ───────────────────────────────────────────────────────────
    on(
        agent,
        'task.queued',
        safe((/** @type {{ taskId?: string }} */ evt) => {
            metrics.recordCounter('tasks.queued');
            log('DEBUG', `[agent-event-observer] task.queued taskId=${evt?.taskId ?? '?'}`);
        }, 'task.queued'),
    );

    // ── task.started ──────────────────────────────────────────────────────────
    on(
        agent,
        'task.started',
        safe((/** @type {{ taskId?: string }} */ evt) => {
            metrics.recordCounter('tasks.started');
            const taskId = evt?.taskId ?? 'unknown';
            const nowPerf = performance.now();
            for (const [id, entry] of _taskSpans) {
                if (nowPerf - entry.ts > _TASK_SPAN_TTL_MS) {
                    entry.span?.end();
                    _taskSpans.delete(id);
                }
            }
            const span = startSpanImmediate('copilot.task', { taskId });
            _taskSpans.set(taskId, { ts: nowPerf, span });
            log('DEBUG', `[agent-event-observer] task.started taskId=${taskId}`);
        }, 'task.started'),
    );

    // ── task.delta ────────────────────────────────────────────────────────────
    on(
        agent,
        'task.delta',
        safe((/** @type {{ delta?: string; taskId?: string }} */ evt) => {
            metrics.recordCounter('task.streaming.deltas');
            const bytes = evt?.delta?.length ?? 0;
            if (bytes > 0) metrics.recordCounter('task.streaming.bytes', bytes);
            const now = performance.now();
            if (_lastChunkTs > 0) {
                metrics.recordStreamingChunk(now - _lastChunkTs);
            }
            _lastChunkTs = now;
        }, 'task.delta'),
    );

    // ── task.reasoning ────────────────────────────────────────────────────────
    on(
        agent,
        'task.reasoning',
        safe((/** @type {{ text?: string; taskId?: string }} */ evt) => {
            metrics.recordCounter('task.reasoning.chunks');
            const bytes = evt?.text?.length ?? 0;
            if (bytes > 0) metrics.recordCounter('task.reasoning.bytes', bytes);
        }, 'task.reasoning'),
    );

    // ── tool.execution_start ──────────────────────────────────────────────────
    on(
        agent,
        'tool.execution_start',
        safe((/** @type {{ toolName?: string; callId?: string }} */ evt) => {
            metrics.recordCounter('tool.execution.start');
            const callId = evt?.callId;
            if (callId) {
                const _nowPerf = performance.now();
                for (const [id, entry] of _toolStarts) {
                    if (_nowPerf - entry.ts > _TOOL_START_TTL_MS) _toolStarts.delete(id);
                }
                _toolStarts.set(callId, { toolName: evt?.toolName ?? 'unknown', ts: _nowPerf });
            }
            log('DEBUG', `[agent-event-observer] tool.execution_start tool=${evt?.toolName ?? '?'}`);
        }, 'tool.execution_start'),
    );

    // ── tool.execution_complete ───────────────────────────────────────────────
    on(
        agent,
        'tool.execution_complete',
        safe((/** @type {{ toolName?: string; callId?: string; durationMs?: number; success?: boolean }} */ evt) => {
            metrics.recordCounter('tool.execution.complete');
            const callId = evt?.callId;
            const startInfo = callId ? _toolStarts.get(callId) : null;
            if (callId) _toolStarts.delete(callId);
            const toolName = evt?.toolName ?? startInfo?.toolName ?? 'unknown';
            const durationMs = evt?.durationMs ?? (startInfo ? performance.now() - startInfo.ts : undefined);
            const success = evt?.success !== false;
            if (typeof durationMs === 'number') {
                metrics.recordToolCall(toolName, durationMs, success);
            }
            log(
                'DEBUG',
                `[agent-event-observer] tool.execution_complete tool=${toolName} duration=${durationMs ?? '?'}ms`,
            );
        }, 'tool.execution_complete'),
    );

    // ── tool.execution_progress ───────────────────────────────────────────────
    on(
        agent,
        'tool.execution_progress',
        safe((/** @type {{ toolName?: string; progress?: number }} */ evt) => {
            metrics.recordCounter('tool.execution.progress');
            log(
                'DEBUG',
                `[agent-event-observer] tool.execution_progress tool=${evt?.toolName ?? '?'} progress=${evt?.progress ?? '?'}`,
            );
        }, 'tool.execution_progress'),
    );

    // ── pr.fallback_model ─────────────────────────────────────────────────────
    on(
        agent,
        'pr.fallback_model',
        safe((/** @type {{ from?: string; to?: string }} */ evt) => {
            metrics.recordCounter('model.fallback');
            log('INFO', `[agent-event-observer] pr.fallback_model from=${evt?.from} to=${evt?.to}`);
        }, 'pr.fallback_model'),
    );

    // ── pr.consumed ───────────────────────────────────────────────────────────
    on(
        agent,
        'pr.consumed',
        safe((/** @type {{ tokens?: number; model?: string }} */ evt) => {
            metrics.recordCounter('pr.consumed');
            log('DEBUG', `[agent-event-observer] pr.consumed model=${evt?.model ?? '?'} tokens=${evt?.tokens ?? '?'}`);
        }, 'pr.consumed'),
    );

    // ── session.usage — event sumário de tokens e custo ───────────────────────
    on(
        agent,
        'session.usage',
        safe(
            (
                /**
                 * @type {{
                 *     tokens?: number;
                 *     cost?: number;
                 *     model?: string;
                 *     inputTokens?: number;
                 *     outputTokens?: number;
                 *     cacheReadTokens?: number;
                 *     cacheWriteTokens?: number;
                 * }}
                 */ evt,
            ) => {
                metrics.recordCounter('session.usage');
                const model = evt?.model ?? 'unknown';
                const input = evt?.inputTokens ?? 0;
                const output = evt?.outputTokens ?? evt?.tokens ?? 0;
                const cacheRead = evt?.cacheReadTokens ?? 0;
                const cacheWrite = evt?.cacheWriteTokens ?? 0;
                if (model !== 'unknown') {
                    modelStatsTracker.record(model, {
                        latencyMs: _lastTurnDurationMs,
                        success: _lastTurnSuccess,
                        inputTokens: input,
                        outputTokens: output,
                    });
                }
                log(
                    'DEBUG',
                    `[agent-event-observer] session.usage tokens=${evt?.tokens ?? '?'} model=${model} input=${input} output=${output} cache=${cacheRead}/${cacheWrite}`,
                );
            },
            'session.usage',
        ),
    );

    return {
        lastTurnDurationMs: () => _lastTurnDurationMs,
        lastTurnSuccess: () => _lastTurnSuccess,
        resetChunkTs: () => {
            _lastChunkTs = 0;
        },
    };
}
