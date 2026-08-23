// @ts-check
/**
 * src/copilot/observability/observers/session-agent-handlers.js
 *
 * Handlers de session._, agent._, question._, permission._, system._, context:_, pending_messages._, exit_plan_mode._,
 * external_tool.* do AgentEventObserver.
 *
 * @module copilot/observability/observers/session-agent-handlers
 * @see EventBus
 */

import { AGENT_EMITTER_ERROR, AGENT_SESSION_FATAL } from '#copilot/events';
import { log } from '../logger.js';
import { startSpanImmediate } from '../otel.js';

import { toError } from '#copilot/infra/public/platform/error';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeUnknownErrorMessage(raw) {
    if (raw instanceof Error) return raw.message;
    if (raw && typeof raw === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (raw);
        if (typeof rec['message'] === 'string' && rec['message']) return rec['message'];
        const nestedError = rec['error'];
        if (nestedError && typeof nestedError === 'object') {
            const errRec = /** @type {Record<string, unknown>} */ (nestedError);
            if (typeof errRec['message'] === 'string' && errRec['message']) return errRec['message'];
        }
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw);
        }
    }
    return String(raw);
}

/**
 * Erros recuperáveis de `model_call` são sinais de roteamento/retry do SDK, não falhas operacionais finais. Eles
 * continuam no stream público via `agent.error`, mas não devem poluir `/errors` como erros vermelhos.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
function isRecoverableModelCallAgentError(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const rec = /** @type {Record<string, unknown>} */ (raw);
    return rec['hookType'] === 'errorOccurred' && rec['errorContext'] === 'model_call' && rec['recoverable'] === true;
}

/** @typedef {import('./context.js').ObserverContext} ObserverContext */

/**
 * Registra handlers de session/agent/misc no EventEmitter do agente.
 *
 * @param {ObserverContext} ctx
 * @returns {void}
 */
export function attachSessionAgentHandlers(ctx) {
    const { metrics, errorTracker, agent, on, safe } = ctx;

    // ── permission.mode_changed ───────────────────────────────────────────────
    on(
        agent,
        'permission.mode_changed',
        safe((/** @type {{ mode?: string }} */ evt) => {
            metrics.recordCounter(`permission.mode.${evt?.mode ?? 'unknown'}`);
            log('DEBUG', `[agent-event-observer] permission.mode_changed mode=${evt?.mode}`);
        }, 'permission.mode_changed'),
    );

    // ── session.fatal ─────────────────────────────────────────────────────────
    on(
        agent,
        'session.fatal',
        safe((/** @type {{ error?: unknown; sessionId?: string }} */ evt) => {
            metrics.recordCounter('session.fatal');
            metrics.recordSessionError();
            if (errorTracker && evt?.error) {
                const err = toError(evt.error);
                errorTracker.trackError(err, {
                    source: AGENT_SESSION_FATAL,
                    metadata: { sessionId: evt?.sessionId },
                });
            }
            log('WARN', `[agent-event-observer] session.fatal sessionId=${evt?.sessionId}`);
        }, 'session.fatal'),
    );

    // ── session.compaction_start ──────────────────────────────────────────────
    /** @type {import('../otel.js').OtelSpan | null} */
    let _compactionSpan = null;

    on(
        agent,
        'session.compaction_start',
        safe(() => {
            metrics.recordCounter('session.compaction.start');
            if (_compactionSpan) {
                _compactionSpan.end();
                _compactionSpan = null;
            }
            _compactionSpan = startSpanImmediate('copilot.compaction');
            log('DEBUG', '[agent-event-observer] session.compaction_start');
        }, 'session.compaction_start'),
    );

    // ── session.compaction_complete ───────────────────────────────────────────
    on(
        agent,
        'session.compaction_complete',
        safe((/** @type {{ savedTokens?: number }} */ evt) => {
            metrics.recordCounter('session.compaction.complete');
            if (typeof evt?.savedTokens === 'number') {
                metrics.recordCounter('session.compaction.saved_tokens', evt.savedTokens);
            }
            if (_compactionSpan) {
                if (typeof evt?.savedTokens === 'number') {
                    _compactionSpan.setAttribute('savedTokens', evt.savedTokens);
                }
                _compactionSpan.end();
                _compactionSpan = null;
            }
            log('DEBUG', `[agent-event-observer] session.compaction_complete savedTokens=${evt?.savedTokens ?? '?'}`);
        }, 'session.compaction_complete'),
    );

    // ── session.mode_changed ──────────────────────────────────────────────────
    on(
        agent,
        'session.mode_changed',
        safe((/** @type {{ newMode?: string; previousMode?: string }} */ evt) => {
            metrics.recordCounter(`session.mode.${evt?.newMode ?? 'unknown'}`);
            log('DEBUG', `[agent-event-observer] session.mode_changed ${evt?.previousMode} → ${evt?.newMode}`);
        }, 'session.mode_changed'),
    );

    // ── session.token_budget_warning ──────────────────────────────────────────
    on(
        agent,
        'session.token_budget_warning',
        safe((/** @type {{ remaining?: number; budgetPct?: number }} */ evt) => {
            metrics.recordCounter('session.token_budget_warning');
            log(
                'WARN',
                `[agent-event-observer] session.token_budget_warning remaining=${evt?.remaining ?? '?'} pct=${evt?.budgetPct ?? '?'}`,
            );
        }, 'session.token_budget_warning'),
    );

    // ── session.history_synced ────────────────────────────────────────────────
    on(
        agent,
        'session.history_synced',
        safe(() => {
            metrics.recordCounter('session.history_synced');
            log('DEBUG', '[agent-event-observer] session.history_synced');
        }, 'session.history_synced'),
    );

    // ── session.title_changed ─────────────────────────────────────────────────
    on(
        agent,
        'session.title_changed',
        safe(() => {
            metrics.recordCounter('session.title_changed');
            log('DEBUG', '[agent-event-observer] session.title_changed');
        }, 'session.title_changed'),
    );

    // ── session.info ──────────────────────────────────────────────────────────
    on(
        agent,
        'session.info',
        safe((/** @type {{ type?: string }} */ evt) => {
            metrics.recordCounter(`session.info.${evt?.type ?? 'unknown'}`);
            log('DEBUG', `[agent-event-observer] session.info type=${evt?.type ?? '?'}`);
        }, 'session.info'),
    );

    // ── session.snapshot_rewind ────────────────────────────────────────────────
    on(
        agent,
        'session.snapshot_rewind',
        safe(() => {
            metrics.recordCounter('session.snapshot_rewind');
            log('DEBUG', '[agent-event-observer] session.snapshot_rewind');
        }, 'session.snapshot_rewind'),
    );

    // ── session.workspace_file_changed ─────────────────────────────────────────
    on(
        agent,
        'session.workspace_file_changed',
        safe((/** @type {{ path?: string }} */ evt) => {
            metrics.recordCounter('session.workspace_file_changed');
            log('DEBUG', `[agent-event-observer] session.workspace_file_changed path=${evt?.path ?? '?'}`);
        }, 'session.workspace_file_changed'),
    );

    // ── context:compacted ─────────────────────────────────────────────────────
    on(
        agent,
        'context:compacted',
        safe((/** @type {{ savedTokens?: number }} */ evt) => {
            metrics.recordCounter('context.compacted');
            if (typeof evt?.savedTokens === 'number') {
                metrics.recordCounter('context.compacted.saved_tokens', evt.savedTokens);
            }
            log('DEBUG', `[agent-event-observer] context:compacted savedTokens=${evt?.savedTokens ?? '?'}`);
        }, 'context:compacted'),
    );

    // ── agent.metrics ─────────────────────────────────────────────────────────
    /** @type {{ queueDepth: number; uptime: number }} */
    let _lastMetricsSnapshot = { queueDepth: -1, uptime: 0 };

    on(
        agent,
        'agent.metrics',
        safe((/** @type {{ queueDepth?: number; uptime?: number; sessionId?: string }} */ evt) => {
            const depth = typeof evt?.queueDepth === 'number' ? evt.queueDepth : _lastMetricsSnapshot.queueDepth;
            const uptime = typeof evt?.uptime === 'number' ? evt.uptime : _lastMetricsSnapshot.uptime;
            const hasDelta =
                depth !== _lastMetricsSnapshot.queueDepth || Math.abs(uptime - _lastMetricsSnapshot.uptime) > 60_000;
            if (hasDelta) {
                metrics.recordCounter('agent.metrics.snapshot');
                if (typeof evt?.queueDepth === 'number') {
                    metrics.recordGauge('agent.queue.depth', evt.queueDepth);
                }
                if (typeof evt?.uptime === 'number') {
                    metrics.recordGauge('agent.session.uptime', evt.uptime);
                }
                _lastMetricsSnapshot = { queueDepth: depth, uptime };
                log('DEBUG', '[agent-event-observer] agent.metrics snapshot recebido (delta)');
            }
        }, 'agent.metrics'),
    );

    // ── status (CT-03) ────────────────────────────────────────────────────────
    on(
        agent,
        'status',
        safe((/** @type {string | { status?: string }} */ raw) => {
            const val = typeof raw === 'string' ? raw : (raw?.status ?? 'unknown');
            if (typeof val === 'string' && val.startsWith('reconnecting:')) {
                metrics.recordCounter('agent.reconnect.attempt');
                log('WARN', `[agent-event-observer] reconnect attempt: ${val}`);
            }
            metrics.recordCounter(`agent.status.${val}`);
        }, 'status'),
    );

    // ── agent lifecycle ───────────────────────────────────────────────────────
    on(
        agent,
        'ready',
        safe(() => {
            metrics.recordCounter('agent.ready');
            log('DEBUG', '[agent-event-observer] agent ready');
        }, 'ready'),
    );

    on(
        agent,
        'stopped',
        safe(() => {
            metrics.recordCounter('agent.stopped');
            log('DEBUG', '[agent-event-observer] agent stopped');
        }, 'stopped'),
    );

    on(
        agent,
        'before-stop',
        safe(() => {
            metrics.recordCounter('agent.before_stop');
            log('DEBUG', '[agent-event-observer] agent before-stop');
        }, 'before-stop'),
    );

    // ── error no EventEmitter do agente ───────────────────────────────────────
    on(
        agent,
        'error',
        safe((/** @type {unknown} */ err) => {
            metrics.recordCounter('agent.emitter.error');
            if (errorTracker && !isRecoverableModelCallAgentError(err)) {
                const e = toError(err);
                errorTracker.trackError(e, { source: AGENT_EMITTER_ERROR });
            }
            log('WARN', `[agent-event-observer] agent error: ${normalizeUnknownErrorMessage(err)}`);
        }, 'error'),
    );

    // ── agent.background.completed ────────────────────────────────────────────
    on(
        agent,
        'agent.background.completed',
        safe((/** @type {{ agentId?: string; durationMs?: number }} */ evt) => {
            metrics.recordCounter('agent.background.completed');
            log('DEBUG', `[agent-event-observer] agent.background.completed agentId=${evt?.agentId ?? '?'}`);
        }, 'agent.background.completed'),
    );

    // ── agent.background.idle ─────────────────────────────────────────────────
    on(
        agent,
        'agent.background.idle',
        safe(() => {
            metrics.recordCounter('agent.background.idle');
            log('DEBUG', '[agent-event-observer] agent.background.idle');
        }, 'agent.background.idle'),
    );

    // ── agent.shell.completed ─────────────────────────────────────────────────
    on(
        agent,
        'agent.shell.completed',
        safe((/** @type {{ exitCode?: number; command?: string }} */ evt) => {
            metrics.recordCounter('agent.shell.completed');
            const code = evt?.exitCode ?? 0;
            if (code !== 0) metrics.recordCounter('agent.shell.error');
            log('DEBUG', `[agent-event-observer] agent.shell.completed exitCode=${code}`);
        }, 'agent.shell.completed'),
    );

    // ── agent.shell.detached_completed ────────────────────────────────────────
    on(
        agent,
        'agent.shell.detached_completed',
        safe((/** @type {{ exitCode?: number }} */ evt) => {
            metrics.recordCounter('agent.shell.detached_completed');
            const code = evt?.exitCode ?? 0;
            if (code !== 0) metrics.recordCounter('agent.shell.detached_error');
            log('DEBUG', `[agent-event-observer] agent.shell.detached_completed exitCode=${code}`);
        }, 'agent.shell.detached_completed'),
    );

    // ── system.message ────────────────────────────────────────────────────────
    on(
        agent,
        'system.message',
        safe((/** @type {{ type?: string }} */ evt) => {
            metrics.recordCounter('system.message');
            log('DEBUG', `[agent-event-observer] system.message type=${evt?.type ?? '?'}`);
        }, 'system.message'),
    );

    // ── pending_messages.modified ─────────────────────────────────────────────
    on(
        agent,
        'pending_messages.modified',
        safe((/** @type {{ count?: number }} */ evt) => {
            metrics.recordCounter('pending_messages.modified');
            log('DEBUG', `[agent-event-observer] pending_messages.modified count=${evt?.count ?? '?'}`);
        }, 'pending_messages.modified'),
    );

    // ── exit_plan_mode.completed ──────────────────────────────────────────────
    on(
        agent,
        'exit_plan_mode.completed',
        safe(() => {
            metrics.recordCounter('exit_plan_mode.completed');
            log('DEBUG', '[agent-event-observer] exit_plan_mode.completed');
        }, 'exit_plan_mode.completed'),
    );

    // ── external_tool.completed ───────────────────────────────────────────────
    on(
        agent,
        'external_tool.completed',
        safe((/** @type {{ toolName?: string; durationMs?: number }} */ evt) => {
            metrics.recordCounter('external_tool.completed');
            log('DEBUG', `[agent-event-observer] external_tool.completed tool=${evt?.toolName ?? '?'}`);
        }, 'external_tool.completed'),
    );

    // ── question lifecycle ────────────────────────────────────────────────────
    /** @type {Map<string, number>} */
    const _questionStarts = new Map();
    const _QUESTION_START_TTL_MS = 30 * 60 * 1000;

    on(
        agent,
        'question.pending',
        safe((/** @type {{ questionId?: string }} */ evt) => {
            const qId = evt?.questionId ?? null;
            const now = performance.now();
            for (const [id, ts] of _questionStarts) {
                if (now - ts > _QUESTION_START_TTL_MS) {
                    _questionStarts.delete(id);
                }
            }
            if (qId) _questionStarts.set(qId, now);
            metrics.recordCounter('question.pending');
            log('DEBUG', `[agent-event-observer] question.pending questionId=${qId ?? '(sem id)'}`);
        }, 'question.pending'),
    );

    on(
        agent,
        'question.answered',
        safe((/** @type {{ questionId?: string }} */ evt) => {
            const qId = evt?.questionId ?? null;
            const startTs = qId ? _questionStarts.get(qId) : null;
            if (qId) _questionStarts.delete(qId);
            metrics.recordCounter('question.answered');
            if (startTs) {
                const waitMs = performance.now() - startTs;
                metrics.recordGauge('question.last_wait_ms', waitMs);
                metrics.recordQuestionLatency(waitMs);
                log('DEBUG', `[agent-event-observer] question.answered questionId=${qId} waitMs=${waitMs}`);
            }
        }, 'question.answered'),
    );
}
