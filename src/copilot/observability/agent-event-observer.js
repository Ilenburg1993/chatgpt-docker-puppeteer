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

import { log } from './logger.js';

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

    /**
     * Mapa de turnId → performance timestamp do turn_start ativo.
     *
     * Fase BB: usa turnId dinâmico como chave (em vez da chave estática 'current') para suportar múltiplos turnos
     * concorrentes sem corromper as durações. Entradas são removidas ao processar turn_end ou após TTL máximo para
     * prevenir memory leak.
     *
     * @type {Map<string, number>}
     */
    const _turnStarts = new Map();

    /** TTL máximo de um turn no Map antes de ser descartado automaticamente (5 minutos). */
    const _TURN_START_TTL_MS = 5 * 60 * 1000;

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
                // Limpeza de entradas antigas por TTL antes de inserir nova (memory leak guard)
                const now = Date.now();
                for (const [id, startTs] of _turnStarts) {
                    if (now - startTs > _TURN_START_TTL_MS) {
                        _turnStarts.delete(id);
                        log('DEBUG', `[agent-event-observer] dialog.turn_start: TTL expirado para turnId=${id}`);
                    }
                }
                _turnStarts.set(turnId, ts);
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
                const startTs = _turnStarts.get(turnId) ?? 0;
                _turnStarts.delete(turnId); // cleanup imediato após consumo
                const durationMs = evt?.durationMs ?? (startTs ? performance.now() - startTs : 0);
                const success = typeof evt?.reply === 'string' && evt.reply.length > 0;
                metrics.recordDialogTurn(Math.round(durationMs), success);
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
                log('DEBUG', `[agent-event-observer] task.completed taskId=${evt?.taskId} durationMs=${durationMs}`);
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

                // Fase BM: propagar para ErrorTracker (anteriormente ausente para task.error)
                if (errorTracker) {
                    const err = evt?.error instanceof Error ? evt.error : new Error(String(evt?.error ?? 'task.error'));
                    errorTracker.trackError(err, { source: 'agent:task.error', metadata: { taskId: evt?.taskId } });
                }

                log('WARN', `[agent-event-observer] task.error taskId=${evt?.taskId}`);
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
        _on(
            agent,
            'tool.execution_start',
            _safe((/** @type {{ toolName?: string; callId?: string }} */ evt) => {
                metrics.recordCounter('tool.execution.start');
                log('DEBUG', `[agent-event-observer] tool.execution_start tool=${evt?.toolName ?? '?'}`);
            }, 'tool.execution_start'),
        );

        // ── tool.execution_complete — contabiliza fim de ferramenta ──────────
        _on(
            agent,
            'tool.execution_complete',
            _safe((/** @type {{ toolName?: string; callId?: string; durationMs?: number }} */ evt) => {
                metrics.recordCounter('tool.execution.complete');
                log(
                    'DEBUG',
                    `[agent-event-observer] tool.execution_complete tool=${evt?.toolName ?? '?'} duration=${evt?.durationMs ?? '?'}ms`,
                );
            }, 'tool.execution_complete'),
        );

        // ── agent.metrics — snapshot periódico de estado do agente ───────────
        _on(
            agent,
            'agent.metrics',
            _safe(() => {
                metrics.recordCounter('agent.metrics.snapshot');
                log('DEBUG', '[agent-event-observer] agent.metrics snapshot recebido');
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

        log('INFO', '[agent-event-observer] Attached to agent EventEmitter');
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
        log('INFO', '[agent-event-observer] Detached from agent EventEmitter');
    }

    return { attach, detach };
}
