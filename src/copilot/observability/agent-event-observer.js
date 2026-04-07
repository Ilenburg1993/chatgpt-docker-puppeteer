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

import { createErrorAlerter } from './error-alerting.js';
import { log } from './logger.js';
import { attachDialogTaskHandlers, attachSessionAgentHandlers } from './observers/index.js';

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

    /** @type {import('./error-alerting.js').ErrorAlerter | null} */
    let _alerter = null;

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
        /** @type {import('./observers/context.js').ObserverContext} */
        const ctx = { metrics, errorTracker: errorTracker ?? null, agent, on: _on, safe: _safe };

        attachDialogTaskHandlers(ctx);
        attachSessionAgentHandlers(ctx);

        log('INFO', '[agent-event-observer] Attached to agent EventEmitter');

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

        if (_alerter) {
            _alerter.destroy();
            _alerter = null;
        }
        log('INFO', '[agent-event-observer] Detached from agent EventEmitter');
    }

    return { attach, detach };
}
