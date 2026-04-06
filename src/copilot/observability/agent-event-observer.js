// @ts-check
/**
 * src/copilot/observability/agent-event-observer.js
 *
 * Fase P — Observador de eventos do AlwaysAliveAgent para o sistema de observabilidade.
 *
 * Conecta-se ao EventEmitter do agente e alimenta MetricsStore e ErrorTracker com:
 *
 * - Turns do dialog loop (dialog.turn_start / dialog.turn_end)
 * - Stalls e timeouts do dialog (dialog.stalled / dialog.turn_timeout)
 * - Tasks concluídas ou com erro (task.completed / task.error)
 * - Permissões concedidas / negadas (permission.mode_changed)
 * - Sessão finalizada com fatal (session.fatal)
 * - Agent metrics emitidos periodicamente (agent.metrics)
 *
 * Design:
 *
 * - Zero acoplamento de runtime — recebe dependências por construção
 * - Todos os listeners são armazenados para cleanup via `detach()`
 * - Seguro a erros: qualquer exceção nos handlers é capturada e logada
 *
 * @module copilot/observability/agent-event-observer
 */

import { modelStatsTracker } from '../lib/model-registry.js';
import { createErrorAlerter } from './error-alerting.js';
import { log } from './logger.js';
import { startSpanImmediate } from './otel.js';

/**
 * @typedef {import('./metrics.js').MetricsStore} MetricsStore
 *
 * @typedef {import('./error-tracker.js').ErrorTracker} ErrorTracker
 */

/**
 * @typedef {object} AgentEventObserverOptions
 * @property {MetricsStore} metrics - Store de métricas a alimentar.
 * @property {ErrorTracker} [errorTracker] - Tracker de erros a alimentar.
 */

/**
 * @typedef {object} AgentEventObserver
 * @property {(agent: import('node:events').EventEmitter) => void} attach Registra todos os listeners no EventEmitter do
 *   agente.
 * @property {() => void} detach Remove todos os listeners previamente registrados e reseta estado.
 */

/**
 * Cria um observador de eventos do agente.
 *
 * @param {AgentEventObserverOptions} opts
 * @returns {AgentEventObserver}
 */
export function createAgentEventObserver({ metrics, errorTracker }) {
    /** @type {{ emitter: import('node:events').EventEmitter; event: string; listener: (...args: any[]) => void }[]} */
    const _registrations = [];

    /** @type {import('./error-alerting.js').ErrorAlerter | null} F39: instância do alerter. */
    let _alerter = null;

    /**
     * Mapa de turnId → { ts, span? } do turn_start ativo.
     *
     * Fase BB: usa turnId dinâmico como chave (em vez da chave estática 'current') para suportar múltiplos turnos
     * concorrentes sem corromper as durações. Entradas são removidas ao processar turn_end ou após TTL máximo para
     * prevenir memory leak. CO-03: inclui span OTEL para rastreio de turnos.
     *
     * @type {Map<string, { ts: number; span: import('./otel.js').OtelSpan | null }>}
     */
    const _turnStarts = new Map();

    /** TTL máximo de um turn no Map antes de ser descartado automaticamente (5 minutos). */
    const _TURN_START_TTL_MS = 5 * 60 * 1000;

    /** CR-02: timestamp do último chunk de streaming para medir intervalo. */
    let _lastChunkTs = 0;

    /** F40.4: duração e success do último turn (para alimentar ModelStatsTracker no session.usage). */
    let _lastTurnDurationMs = 0;
    let _lastTurnSuccess = true;

    /**
     * @param {import('node:events').EventEmitter} emitter
     * @param {string} event
     * @param {(...args: any[]) => void} listener
     */
    function _on(emitter, event, listener) {
        emitter.on(event, listener);
        _registrations.push({ emitter, event, listener });
    }

    /**
     * @param {(...args: any[]) => void} fn
     * @param {string} context
     * @returns {(...args: any[]) => void}
     */
    function _safe(fn, context) {
        return (...args) => {
            try {
                fn(...args);
            } catch (/** @type {any} */ err) {
                log('WARN', `[agent-event-observer] erro no handler ${context}: ${err?.message ?? err}`);
            }
        };
    }

    /**
     * Registra todos os listeners no EventEmitter do agente.
     *
     * @param {import('node:events').EventEmitter} agent
     * @returns {void}
     */
    function attach(agent) {
        // ── dialog.turn_start — marca início do turn ─────────────────────────
        _on(
            agent,
            'dialog.turn_start',
            _safe((/** @type {{ ts?: number; turnId?: string; message?: string }} */ evt) => {
                const ts = performance.now();
                // Fase BB: usar turnId dinâmico como chave; fallback para 'current' por retrocompatibilidade
                const turnId = evt?.turnId ?? 'current';
                // CN-01 fix: TTL agora usa performance.now() (mesma base que ts armazenado)
                const nowPerf = performance.now();
                for (const [id, entry] of _turnStarts) {
                    if (nowPerf - entry.ts > _TURN_START_TTL_MS) {
                        entry.span?.end();
                        _turnStarts.delete(id);
                        log('DEBUG', `[agent-event-observer] dialog.turn_start: TTL expirado para turnId=${id}`);
                    }
                }
                // CO-03: span OTEL para rastreio de turn
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

        // ── dialog.turn_end — registra latência do turn ──────────────────────
        _on(
            agent,
            'dialog.turn_end',
            _safe((/** @type {{ durationMs?: number; turnId?: string; reply?: string }} */ evt) => {
                // Fase BB: correlacionar por turnId para suportar turnos concorrentes
                const turnId = evt?.turnId ?? 'current';
                const entry = _turnStarts.get(turnId);
                _turnStarts.delete(turnId); // cleanup imediato após consumo
                const durationMs = evt?.durationMs ?? (entry ? performance.now() - entry.ts : 0);
                const success = typeof evt?.reply === 'string' && evt.reply.length > 0;
                metrics.recordDialogTurn(Math.round(durationMs), success);
                // F40.4: rastrear última latência/sucesso para alimentar ModelStatsTracker
                _lastTurnDurationMs = Math.round(durationMs);
                _lastTurnSuccess = success;
                // CO-03: fechar span OTEL do turn
                if (entry?.span) {
                    entry.span.setAttribute('duration_ms', Math.round(durationMs));
                    entry.span.setAttribute('success', success);
                    entry.span.end();
                }
                // CR-02: resetar timestamp de chunk para não contaminar próximo turn
                _lastChunkTs = 0;
                log(
                    'DEBUG',
                    `[agent-event-observer] dialog.turn_end turnId=${turnId} durationMs=${Math.round(durationMs)} success=${success}`,
                );
            }, 'dialog.turn_end'),
        );

        // ── dialog.stalled — registra stall com tempo acumulado ───────────────
        _on(
            agent,
            'dialog.stalled',
            _safe((/** @type {{ stalledMs?: number }} */ evt) => {
                const stalledMs = evt?.stalledMs ?? 0;
                metrics.recordDialogStall(stalledMs);
                metrics.recordCounter('dialog.stalls');
                log('DEBUG', `[agent-event-observer] dialog.stalled stalledMs=${stalledMs}`);
            }, 'dialog.stalled'),
        );

        // ── dialog.turn_timeout ──────────────────────────────────────────────
        _on(
            agent,
            'dialog.turn_timeout',
            _safe((/** @type {{ phase?: string; timeoutMs?: number; turnId?: string }} */ evt) => {
                metrics.recordDialogTimeout();
                metrics.recordCounter(`dialog.timeout.${evt?.phase ?? 'unknown'}`);
                // Fase BB: limpar entrada do turn no map quando há timeout
                if (evt?.turnId) _turnStarts.delete(evt.turnId);
                // Fase BM: propagar para ErrorTracker
                if (errorTracker) {
                    const err = new Error(`Dialog turn timeout [phase=${evt?.phase ?? 'unknown'}]`);
                    errorTracker.trackError(err, {
                        source: 'agent:dialog.turn_timeout',
                        metadata: { phase: evt?.phase, timeoutMs: evt?.timeoutMs, turnId: evt?.turnId },
                    });
                }
                log('DEBUG', `[agent-event-observer] dialog.turn_timeout phase=${evt?.phase}`);
            }, 'dialog.turn_timeout'),
        );

        // ── task.completed ───────────────────────────────────────────────────
        _on(
            agent,
            'task.completed',
            _safe((/** @type {{ durationMs?: number; taskId?: string }} */ evt) => {
                const durationMs = evt?.durationMs ?? 0;
                metrics.recordTaskCompletion(durationMs, true);
                metrics.recordCounter('tasks.completed');
                // F29.4: fechar span OTEL da task
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

        // ── task.error ───────────────────────────────────────────────────────
        _on(
            agent,
            'task.error',
            _safe((/** @type {{ durationMs?: number; taskId?: string; error?: unknown }} */ evt) => {
                const durationMs = evt?.durationMs ?? 0;
                metrics.recordTaskCompletion(durationMs, false);
                metrics.recordCounter('tasks.errors');
                metrics.recordSessionError();

                // F29.4: fechar span OTEL da task com erro
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

                // Fase BM: propagar para ErrorTracker (anteriormente ausente para task.error)
                if (errorTracker) {
                    const err = evt?.error instanceof Error ? evt.error : new Error(String(evt?.error ?? 'task.error'));
                    errorTracker.trackError(err, { source: 'agent:task.error', metadata: { taskId } });
                }

                log('WARN', `[agent-event-observer] task.error taskId=${taskId}`);
            }, 'task.error'),
        );

        // ── permission.mode_changed ──────────────────────────────────────────
        _on(
            agent,
            'permission.mode_changed',
            _safe((/** @type {{ mode?: string }} */ evt) => {
                metrics.recordCounter(`permission.mode.${evt?.mode ?? 'unknown'}`);
                log('DEBUG', `[agent-event-observer] permission.mode_changed mode=${evt?.mode}`);
            }, 'permission.mode_changed'),
        );

        // ── session.fatal ─────────────────────────────────────────────────────
        _on(
            agent,
            'session.fatal',
            _safe((/** @type {{ error?: unknown; sessionId?: string }} */ evt) => {
                metrics.recordCounter('session.fatal');
                metrics.recordSessionError();

                if (errorTracker && evt?.error) {
                    const err = evt.error instanceof Error ? evt.error : new Error(String(evt.error));
                    errorTracker.trackError(err, {
                        source: 'agent:session.fatal',
                        metadata: { sessionId: evt?.sessionId },
                    });
                }

                log('WARN', `[agent-event-observer] session.fatal sessionId=${evt?.sessionId}`);
            }, 'session.fatal'),
        );

        // ── pr.fallback_model — registra fallback de modelo ───────────────────
        _on(
            agent,
            'pr.fallback_model',
            _safe((/** @type {{ from?: string; to?: string }} */ evt) => {
                metrics.recordCounter('model.fallback');
                log('INFO', `[agent-event-observer] pr.fallback_model from=${evt?.from} to=${evt?.to}`);
            }, 'pr.fallback_model'),
        );

        // ── tool.execution_start — contabiliza início de ferramenta ──────────
        /** @type {Map<string, { toolName: string; ts: number }>} Tool callId → start info para duration calc */
        const _toolStarts = new Map();
        /** @type {number} TTL para entradas _toolStarts (2 min) */
        const _TOOL_START_TTL_MS = 2 * 60 * 1000;

        _on(
            agent,
            'tool.execution_start',
            _safe((/** @type {{ toolName?: string; callId?: string }} */ evt) => {
                metrics.recordCounter('tool.execution.start');
                const callId = evt?.callId;
                if (callId) {
                    // FINDING-P5-4: TTL cleanup antes de inserir nova entrada
                    const _nowPerf = performance.now();
                    for (const [id, entry] of _toolStarts) {
                        if (_nowPerf - entry.ts > _TOOL_START_TTL_MS) _toolStarts.delete(id);
                    }
                    _toolStarts.set(callId, { toolName: evt?.toolName ?? 'unknown', ts: _nowPerf });
                }
                log('DEBUG', `[agent-event-observer] tool.execution_start tool=${evt?.toolName ?? '?'}`);
            }, 'tool.execution_start'),
        );

        // ── tool.execution_complete — contabiliza fim de ferramenta ──────────
        _on(
            agent,
            'tool.execution_complete',
            _safe(
                (/** @type {{ toolName?: string; callId?: string; durationMs?: number; success?: boolean }} */ evt) => {
                    metrics.recordCounter('tool.execution.complete');
                    // CN-06 fix: alimentar histograma de ferramentas no MetricsStore
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
                },
                'tool.execution_complete',
            ),
        );

        // ── agent.metrics — snapshot periódico de estado do agente ───────────
        // F33.2: só registra counter/gauge quando há delta significativo vs snapshot anterior
        /** @type {{ queueDepth: number; uptime: number }} */
        let _lastMetricsSnapshot = { queueDepth: -1, uptime: 0 };
        _on(
            agent,
            'agent.metrics',
            _safe((/** @type {{ queueDepth?: number; uptime?: number; sessionId?: string }} */ evt) => {
                const depth = typeof evt?.queueDepth === 'number' ? evt.queueDepth : _lastMetricsSnapshot.queueDepth;
                const uptime = typeof evt?.uptime === 'number' ? evt.uptime : _lastMetricsSnapshot.uptime;
                const hasDelta =
                    depth !== _lastMetricsSnapshot.queueDepth ||
                    Math.abs(uptime - _lastMetricsSnapshot.uptime) > 60_000;
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

        // ── pr.consumed — contabiliza tokens de PR consumidos ─────────────────
        _on(
            agent,
            'pr.consumed',
            _safe((/** @type {{ tokens?: number; model?: string }} */ evt) => {
                metrics.recordCounter('pr.consumed');
                log(
                    'DEBUG',
                    `[agent-event-observer] pr.consumed model=${evt?.model ?? '?'} tokens=${evt?.tokens ?? '?'}`,
                );
            }, 'pr.consumed'),
        );

        // ── Fase CE: eventos adicionais ───────────────────────────────────────

        // ── status — CT-03: rastreia reconnects + status genérico (unificado FINDING-P5-1) ─
        _on(
            agent,
            'status',
            _safe((/** @type {string | { status?: string }} */ raw) => {
                const val = typeof raw === 'string' ? raw : (raw?.status ?? 'unknown');
                if (typeof val === 'string' && val.startsWith('reconnecting:')) {
                    metrics.recordCounter('agent.reconnect.attempt');
                    log('WARN', `[agent-event-observer] reconnect attempt: ${val}`);
                }
                metrics.recordCounter(`agent.status.${val}`);
            }, 'status'),
        );

        // ── task.queued — tarefa enfileirada ──────────────────────────────────
        _on(
            agent,
            'task.queued',
            _safe((/** @type {{ taskId?: string }} */ evt) => {
                metrics.recordCounter('tasks.queued');
                log('DEBUG', `[agent-event-observer] task.queued taskId=${evt?.taskId ?? '?'}`);
            }, 'task.queued'),
        );

        // ── F29.4: Map de taskId → { ts, span } para OTEL de tasks não-dialog ───
        /** @type {Map<string, { ts: number; span: import('./otel.js').OtelSpan | null }>} */
        const _taskSpans = new Map();
        /** TTL para entradas _taskSpans (10 minutos) */
        const _TASK_SPAN_TTL_MS = 10 * 60 * 1000;

        // ── task.started — tarefa iniciada ────────────────────────────────────
        _on(
            agent,
            'task.started',
            _safe((/** @type {{ taskId?: string }} */ evt) => {
                metrics.recordCounter('tasks.started');
                const taskId = evt?.taskId ?? 'unknown';
                // F29.4: TTL cleanup
                const nowPerf = performance.now();
                for (const [id, entry] of _taskSpans) {
                    if (nowPerf - entry.ts > _TASK_SPAN_TTL_MS) {
                        entry.span?.end();
                        _taskSpans.delete(id);
                    }
                }
                // F29.4: span OTEL para rastreio de task
                const span = startSpanImmediate('copilot.task', { taskId });
                _taskSpans.set(taskId, { ts: nowPerf, span });
                log('DEBUG', `[agent-event-observer] task.started taskId=${taskId}`);
            }, 'task.started'),
        );

        // ── session.compaction_start ──────────────────────────────────────────
        /** @type {import('./otel.js').OtelSpan | null} CO-04: span para compaction */
        let _compactionSpan = null;

        _on(
            agent,
            'session.compaction_start',
            _safe(() => {
                metrics.recordCounter('session.compaction.start');
                // CO-04: span OTEL para compaction; FINDING-P5-3: fechar span anterior se ainda aberto
                if (_compactionSpan) {
                    _compactionSpan.end();
                    _compactionSpan = null;
                }
                _compactionSpan = startSpanImmediate('copilot.compaction');
                log('DEBUG', '[agent-event-observer] session.compaction_start');
            }, 'session.compaction_start'),
        );

        // ── session.compaction_complete ───────────────────────────────────────
        _on(
            agent,
            'session.compaction_complete',
            _safe((/** @type {{ savedTokens?: number }} */ evt) => {
                metrics.recordCounter('session.compaction.complete');
                if (typeof evt?.savedTokens === 'number') {
                    metrics.recordCounter('session.compaction.saved_tokens', evt.savedTokens);
                }
                // CO-04: fechar span de compaction
                if (_compactionSpan) {
                    if (typeof evt?.savedTokens === 'number') {
                        _compactionSpan.setAttribute('savedTokens', evt.savedTokens);
                    }
                    _compactionSpan.end();
                    _compactionSpan = null;
                }
                log(
                    'DEBUG',
                    `[agent-event-observer] session.compaction_complete savedTokens=${evt?.savedTokens ?? '?'}`,
                );
            }, 'session.compaction_complete'),
        );

        // ── dialog.loop.changed — loop ativado/desativado ─────────────────────
        _on(
            agent,
            'dialog.loop.changed',
            _safe((/** @type {{ active?: boolean }} */ evt) => {
                metrics.recordCounter(evt?.active ? 'dialog.loop.activated' : 'dialog.loop.deactivated');
                // CN-04 fix: gauge real-time para status do dialog loop
                metrics.recordGauge('dialog.loop.active', evt?.active ? 1 : 0);
                log('DEBUG', `[agent-event-observer] dialog.loop.changed active=${evt?.active}`);
            }, 'dialog.loop.changed'),
        );

        // ── session.mode_changed ──────────────────────────────────────────────
        _on(
            agent,
            'session.mode_changed',
            _safe((/** @type {{ newMode?: string; previousMode?: string }} */ evt) => {
                metrics.recordCounter(`session.mode.${evt?.newMode ?? 'unknown'}`);
                log('DEBUG', `[agent-event-observer] session.mode_changed ${evt?.previousMode} → ${evt?.newMode}`);
            }, 'session.mode_changed'),
        );

        // ── session.token_budget_warning ──────────────────────────────────────
        _on(
            agent,
            'session.token_budget_warning',
            _safe((/** @type {{ remaining?: number; budgetPct?: number }} */ evt) => {
                metrics.recordCounter('session.token_budget_warning');
                log(
                    'WARN',
                    `[agent-event-observer] session.token_budget_warning remaining=${evt?.remaining ?? '?'} pct=${evt?.budgetPct ?? '?'}`,
                );
            }, 'session.token_budget_warning'),
        );

        // ── agent.background.completed ────────────────────────────────────────
        _on(
            agent,
            'agent.background.completed',
            _safe((/** @type {{ agentId?: string; durationMs?: number }} */ evt) => {
                metrics.recordCounter('agent.background.completed');
                log('DEBUG', `[agent-event-observer] agent.background.completed agentId=${evt?.agentId ?? '?'}`);
            }, 'agent.background.completed'),
        );

        // ── agent.shell.completed ───────────────────────────────────────────
        _on(
            agent,
            'agent.shell.completed',
            _safe((/** @type {{ exitCode?: number; command?: string }} */ evt) => {
                metrics.recordCounter('agent.shell.completed');
                const code = evt?.exitCode ?? 0;
                if (code !== 0) metrics.recordCounter('agent.shell.error');
                log('DEBUG', `[agent-event-observer] agent.shell.completed exitCode=${code}`);
            }, 'agent.shell.completed'),
        );

        // ── Fase CF: Dialog state e lifecycle ────────────────────────────────

        // ── dialog.ready — loop pronto para receber mensagens ────────────────
        _on(
            agent,
            'dialog.ready',
            _safe(() => {
                metrics.recordCounter('dialog.ready');
                log('DEBUG', '[agent-event-observer] dialog.ready');
            }, 'dialog.ready'),
        );

        // ── dialog.reply — resposta emitida pelo loop ─────────────────────────
        _on(
            agent,
            'dialog.reply',
            _safe((/** @type {{ reply?: string; turnId?: string }} */ evt) => {
                metrics.recordCounter('dialog.reply');
                log('DEBUG', `[agent-event-observer] dialog.reply turnId=${evt?.turnId ?? '?'}`);
            }, 'dialog.reply'),
        );

        // ── dialog.stopped — loop parado permanentemente ──────────────────────
        _on(
            agent,
            'dialog.stopped',
            _safe((/** @type {{ reason?: string }} */ evt) => {
                metrics.recordCounter('dialog.stopped');
                if (evt?.reason) metrics.recordCounter(`dialog.stopped.${evt.reason}`);
                log('DEBUG', `[agent-event-observer] dialog.stopped reason=${evt?.reason ?? '?'}`);
            }, 'dialog.stopped'),
        );

        // ── dialog.paused — loop pausado temporariamente ──────────────────────
        _on(
            agent,
            'dialog.paused',
            _safe(() => {
                metrics.recordCounter('dialog.paused');
                log('DEBUG', '[agent-event-observer] dialog.paused');
            }, 'dialog.paused'),
        );

        // ── dialog.resumed — loop retomado após pausa ─────────────────────────
        _on(
            agent,
            'dialog.resumed',
            _safe(() => {
                metrics.recordCounter('dialog.resumed');
                log('DEBUG', '[agent-event-observer] dialog.resumed');
            }, 'dialog.resumed'),
        );

        // ── task.delta — chunk de streaming de resposta ───────────────────────
        _on(
            agent,
            'task.delta',
            _safe((/** @type {{ delta?: string; taskId?: string }} */ evt) => {
                metrics.recordCounter('task.streaming.deltas');
                const bytes = evt?.delta?.length ?? 0;
                if (bytes > 0) metrics.recordCounter('task.streaming.bytes', bytes);
                // CR-02: registrar intervalo entre chunks no histograma
                const now = performance.now();
                if (_lastChunkTs > 0) {
                    metrics.recordStreamingChunk(now - _lastChunkTs);
                }
                _lastChunkTs = now;
            }, 'task.delta'),
        );

        // ── task.reasoning — chunk de raciocínio (chain-of-thought) ──────────
        _on(
            agent,
            'task.reasoning',
            _safe((/** @type {{ text?: string; taskId?: string }} */ evt) => {
                metrics.recordCounter('task.reasoning.chunks');
                const bytes = evt?.text?.length ?? 0;
                if (bytes > 0) metrics.recordCounter('task.reasoning.bytes', bytes);
            }, 'task.reasoning'),
        );

        // ── agent lifecycle: ready, stopped, before-stop ─────────────────────
        _on(
            agent,
            'ready',
            _safe(() => {
                metrics.recordCounter('agent.ready');
                log('DEBUG', '[agent-event-observer] agent ready');
            }, 'ready'),
        );

        _on(
            agent,
            'stopped',
            _safe(() => {
                metrics.recordCounter('agent.stopped');
                log('DEBUG', '[agent-event-observer] agent stopped');
            }, 'stopped'),
        );

        _on(
            agent,
            'before-stop',
            _safe(() => {
                metrics.recordCounter('agent.before_stop');
                log('DEBUG', '[agent-event-observer] agent before-stop');
            }, 'before-stop'),
        );

        // FINDING-P5-1: segundo handler de 'status' removido (unificado em CT-03 acima)

        // ── error no EventEmitter do agente ───────────────────────────────────
        _on(
            agent,
            'error',
            _safe((/** @type {unknown} */ err) => {
                metrics.recordCounter('agent.emitter.error');
                if (errorTracker) {
                    const e = err instanceof Error ? err : new Error(String(err));
                    errorTracker.trackError(e, { source: 'agent:emitter.error' });
                }
                log('WARN', `[agent-event-observer] agent error: ${err instanceof Error ? err.message : String(err)}`);
            }, 'error'),
        );

        // ── session lifecycle ─────────────────────────────────────────────────

        // ── session.usage — event sumário de tokens e custo ───────────────────
        _on(
            agent,
            'session.usage',
            _safe(
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
                    // CN-03 fix: propagar cacheRead/cacheWrite para MetricsStore
                    const cacheRead = evt?.cacheReadTokens ?? 0;
                    const cacheWrite = evt?.cacheWriteTokens ?? 0;
                    // F30: recordUsage removido daqui para evitar dupla contagem.
                    // O event-collector.js já chama recordUsage() diretamente do SDK session event,
                    // que é o source-of-truth para persistência de usage.
                    // F40.4: alimentar ModelStatsTracker com latência do último turn
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

        // ── session.history_synced ────────────────────────────────────────────
        _on(
            agent,
            'session.history_synced',
            _safe(() => {
                metrics.recordCounter('session.history_synced');
                log('DEBUG', '[agent-event-observer] session.history_synced');
            }, 'session.history_synced'),
        );

        // ── session.title_changed ─────────────────────────────────────────────
        _on(
            agent,
            'session.title_changed',
            _safe(() => {
                metrics.recordCounter('session.title_changed');
                log('DEBUG', '[agent-event-observer] session.title_changed');
            }, 'session.title_changed'),
        );

        // ── session.info ──────────────────────────────────────────────────────
        _on(
            agent,
            'session.info',
            _safe((/** @type {{ type?: string }} */ evt) => {
                metrics.recordCounter(`session.info.${evt?.type ?? 'unknown'}`);
                log('DEBUG', `[agent-event-observer] session.info type=${evt?.type ?? '?'}`);
            }, 'session.info'),
        );

        // ── session.snapshot_rewind ────────────────────────────────────────────
        _on(
            agent,
            'session.snapshot_rewind',
            _safe(() => {
                metrics.recordCounter('session.snapshot_rewind');
                log('DEBUG', '[agent-event-observer] session.snapshot_rewind');
            }, 'session.snapshot_rewind'),
        );

        // ── context:compacted — contexto foi compactado (RLE/summarize) ───────
        _on(
            agent,
            'context:compacted',
            _safe((/** @type {{ savedTokens?: number }} */ evt) => {
                metrics.recordCounter('context.compacted');
                if (typeof evt?.savedTokens === 'number') {
                    metrics.recordCounter('context.compacted.saved_tokens', evt.savedTokens);
                }
                log('DEBUG', `[agent-event-observer] context:compacted savedTokens=${evt?.savedTokens ?? '?'}`);
            }, 'context:compacted'),
        );

        // ── background e shells restantes ─────────────────────────────────────

        // ── agent.background.idle ─────────────────────────────────────────────
        _on(
            agent,
            'agent.background.idle',
            _safe(() => {
                metrics.recordCounter('agent.background.idle');
                log('DEBUG', '[agent-event-observer] agent.background.idle');
            }, 'agent.background.idle'),
        );

        // ── agent.shell.detached_completed ────────────────────────────────────
        _on(
            agent,
            'agent.shell.detached_completed',
            _safe((/** @type {{ exitCode?: number }} */ evt) => {
                metrics.recordCounter('agent.shell.detached_completed');
                const code = evt?.exitCode ?? 0;
                if (code !== 0) metrics.recordCounter('agent.shell.detached_error');
                log('DEBUG', `[agent-event-observer] agent.shell.detached_completed exitCode=${code}`);
            }, 'agent.shell.detached_completed'),
        );

        // ── domain events ─────────────────────────────────────────────────────

        // ── system.message ─────────────────────────────────────────────────────
        _on(
            agent,
            'system.message',
            _safe((/** @type {{ type?: string }} */ evt) => {
                metrics.recordCounter('system.message');
                log('DEBUG', `[agent-event-observer] system.message type=${evt?.type ?? '?'}`);
            }, 'system.message'),
        );

        // ── pending_messages.modified ─────────────────────────────────────────
        _on(
            agent,
            'pending_messages.modified',
            _safe((/** @type {{ count?: number }} */ evt) => {
                metrics.recordCounter('pending_messages.modified');
                log('DEBUG', `[agent-event-observer] pending_messages.modified count=${evt?.count ?? '?'}`);
            }, 'pending_messages.modified'),
        );

        // ── exit_plan_mode.completed ──────────────────────────────────────────
        _on(
            agent,
            'exit_plan_mode.completed',
            _safe(() => {
                metrics.recordCounter('exit_plan_mode.completed');
                log('DEBUG', '[agent-event-observer] exit_plan_mode.completed');
            }, 'exit_plan_mode.completed'),
        );

        // ── external_tool.completed ────────────────────────────────────────────
        _on(
            agent,
            'external_tool.completed',
            _safe((/** @type {{ toolName?: string; durationMs?: number }} */ evt) => {
                metrics.recordCounter('external_tool.completed');
                log('DEBUG', `[agent-event-observer] external_tool.completed tool=${evt?.toolName ?? '?'}`);
            }, 'external_tool.completed'),
        );

        // ── tool.execution_progress ────────────────────────────────────────────
        _on(
            agent,
            'tool.execution_progress',
            _safe((/** @type {{ toolName?: string; progress?: number }} */ evt) => {
                metrics.recordCounter('tool.execution.progress');
                log(
                    'DEBUG',
                    `[agent-event-observer] tool.execution_progress tool=${evt?.toolName ?? '?'} progress=${evt?.progress ?? '?'}`,
                );
            }, 'tool.execution_progress'),
        );

        // ── session.workspace_file_changed ─────────────────────────────────────
        _on(
            agent,
            'session.workspace_file_changed',
            _safe((/** @type {{ path?: string }} */ evt) => {
                metrics.recordCounter('session.workspace_file_changed');
                log('DEBUG', `[agent-event-observer] session.workspace_file_changed path=${evt?.path ?? '?'}`);
            }, 'session.workspace_file_changed'),
        );

        // ── question lifecycle ─────────────────────────────────────────────────

        /** @type {Map<string, number>} Mapa questionId → timestamp para calcular latência de resposta */
        const _questionStarts = new Map();
        /** @type {number} TTL para entradas de _questionStarts (30 minutos) */
        const _QUESTION_START_TTL_MS = 30 * 60 * 1000;

        _on(
            agent,
            'question.pending',
            _safe((/** @type {{ questionId?: string }} */ evt) => {
                // CN-02 fix: não gerar chave fallback — sem questionId não há correlação possível
                const qId = evt?.questionId ?? null;
                // FINDING-P5-2: padronizar para performance.now() igual a _turnStarts (monotônico)
                const now = performance.now();
                // TTL cleanup antes de inserir nova entrada
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

        _on(
            agent,
            'question.answered',
            _safe((/** @type {{ questionId?: string }} */ evt) => {
                const qId = evt?.questionId ?? null;
                const startTs = qId ? _questionStarts.get(qId) : null;
                if (qId) _questionStarts.delete(qId);
                metrics.recordCounter('question.answered');
                if (startTs) {
                    // FINDING-P5-2: startTs agora é performance.now() base
                    const waitMs = performance.now() - startTs;
                    metrics.recordGauge('question.last_wait_ms', waitMs);
                    // CS-02: registrar no histograma de latência de questions
                    metrics.recordQuestionLatency(waitMs);
                    log('DEBUG', `[agent-event-observer] question.answered questionId=${qId} waitMs=${waitMs}`);
                }
            }, 'question.answered'),
        );

        log('INFO', '[agent-event-observer] Attached to agent EventEmitter');

        // F39: Criar error alerter vinculado ao error tracker deste observer
        if (errorTracker) {
            _alerter = createErrorAlerter(errorTracker, {
                windowMs: 60_000,
                warningThreshold: 5,
                criticalThreshold: 15,
                cooldownMs: 120_000,
            });
        }
    }

    /**
     * Remove todos os listeners registrados.
     *
     * @returns {void}
     */
    function detach() {
        for (const { emitter, event, listener } of _registrations) {
            emitter.off(event, listener);
        }
        _registrations.length = 0;
        _turnStarts.clear();
        _lastChunkTs = 0;

        // F39: destruir error alerter
        if (_alerter) {
            _alerter.destroy();
            _alerter = null;
        }
        log('INFO', '[agent-event-observer] Detached from agent EventEmitter');
    }

    return { attach, detach };
}
