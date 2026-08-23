// @ts-check
/**
 * src/copilot/observability/agent-event-observer.js
 *
 * Fase P + FAIXA-L14 — Observador de eventos do AlwaysAliveAgent para o sistema de observabilidade.
 *
 * Suporta dois modos de attach:
 *
 * - `attach(agent)` — legado, registra diretamente no EventEmitter do agente
 * - `attachToBus(bus)` — FAIXA-L14, registra no EventBus centralizado usando constantes SSOT
 *
 * Alimenta MetricsStore e ErrorTracker com:
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
 * @see EventBus
 */

import { toError } from '#copilot/infra/public/platform/error';
import { createErrorAlerter } from './error-alerting.js';
import { log } from './logger.js';
import { EMITTER_TO_BUS_TYPE } from './observers/event-name-map.js';
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
 * @property {{
 *           record: (
 *               model: string,
 *               stats: { latencyMs: number; success: boolean; inputTokens?: number; outputTokens?: number },
 *           ) => void;
 *       }
 *     | null
 *     | undefined} [modelStatsTracker]
 *   Tracker de estatísticas de modelo (injetado pelo caller que tem acesso ao sdk/).
 */

/**
 * @typedef {object} AgentEventObserver
 * @property {(agent: import('node:events').EventEmitter) => void} attach Registra todos os listeners no EventEmitter do
 *   agente (legado).
 * @property {(bus: import('#copilot/events/runtime').EventBus) => void} attachToBus Registra todos os listeners no
 *   EventBus centralizado (FAIXA-L14).
 * @property {() => void} detach Remove todos os listeners previamente registrados e reseta estado.
 */

/**
 * Cria um observador de eventos do agente.
 *
 * @param {AgentEventObserverOptions} opts
 * @returns {AgentEventObserver}
 */
export function createAgentEventObserver({ metrics, errorTracker, modelStatsTracker }) {
    /** @type {{ emitter: import('node:events').EventEmitter; event: string; listener: (...args: any[]) => void }[]} */
    const _emitterRegistrations = [];

    /** @type {(() => void)[]} */
    const _busUnsubscribers = [];

    /** @type {import('./error-alerting.js').ErrorAlerter | null} */
    let _alerter = null;

    /**
     * Registra listener no EventEmitter (legado).
     *
     * Nunca deve ser chamada com `emitter = null` em modo emitter; o null guard existe apenas para satisfazer a
     * assinatura alargada de `ObserverContext.on` (que aceita `null` em modo bus).
     *
     * @param {import('node:events').EventEmitter | null} emitter
     * @param {string} event
     * @param {(...args: any[]) => void} listener
     */
    function _onEmitter(emitter, event, listener) {
        if (!emitter) return; // modo bus não usa esta função — guard defensivo
        emitter.on(event, listener);
        _emitterRegistrations.push({ emitter, event, listener });
    }

    /**
     * Cria função _on para modo EventBus. O primeiro arg (emitter) é ignorado — o listener é registrado no bus usando a
     * constante SSOT mapeada.
     *
     * @param {import('#copilot/events/runtime').EventBus} bus
     * @returns {(
     *     emitter: import('node:events').EventEmitter | null,
     *     event: string,
     *     listener: (...args: any[]) => void,
     * ) => void}
     */
    function _createBusOn(bus) {
        return (_emitter, event, listener) => {
            const busType = EMITTER_TO_BUS_TYPE[event];
            if (!busType) {
                log(
                    'WARN',
                    `[agent-event-observer] no SSOT mapping for agent event '${event}' — skipping bus registration`,
                );
                return;
            }
            const unsub = bus.on(busType, (evt) => listener(evt));
            _busUnsubscribers.push(unsub);
        };
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
            } catch (err) {
                log('WARN', `[agent-event-observer] erro no handler ${context}: ${toError(err).message ?? err}`);
            }
        };
    }

    /**
     * @param {import('./error-alerting.js').ErrorAlerter | null} alerter
     */
    function _setupAlerter(alerter) {
        _alerter = alerter;
    }

    /**
     * Configura o error alerter se errorTracker presente.
     */
    function _initAlerter() {
        if (errorTracker) {
            _setupAlerter(
                createErrorAlerter(errorTracker, {
                    windowMs: 60_000,
                    warningThreshold: 5,
                    criticalThreshold: 15,
                    cooldownMs: 120_000,
                }),
            );
        }
    }

    /**
     * Registra todos os listeners no EventEmitter do agente (modo legado).
     *
     * @param {import('node:events').EventEmitter} agent
     * @returns {void}
     */
    function attach(agent) {
        /** @type {import('./observers/context.js').ObserverContext} */
        const ctx = {
            metrics,
            errorTracker: errorTracker ?? null,
            agent,
            on: _onEmitter,
            safe: _safe,
            modelStatsTracker: modelStatsTracker ?? null,
        };

        attachDialogTaskHandlers(ctx);
        attachSessionAgentHandlers(ctx);

        _initAlerter();
        log('INFO', '[agent-event-observer] Attached to agent EventEmitter');
    }

    /**
     * Registra todos os listeners no EventBus centralizado (FAIXA-L14).
     *
     * Os handlers recebem o mesmo payload structure que via agent EventEmitter (o bridgeEmitter espalha o payload
     * original), portanto a mesma lógica de handlers funciona sem alteração.
     *
     * @param {import('#copilot/events/runtime').EventBus} bus
     * @returns {void}
     */
    function attachToBus(bus) {
        const busOn = _createBusOn(bus);

        /** @type {import('./observers/context.js').ObserverContext} */
        const ctx = {
            metrics,
            errorTracker: errorTracker ?? null,
            // Modo bus: sem EventEmitter de agente — agent é null, `on` ignora o primeiro argumento
            agent: null,
            on: busOn,
            safe: _safe,
            modelStatsTracker: modelStatsTracker ?? null,
        };

        attachDialogTaskHandlers(ctx);
        attachSessionAgentHandlers(ctx);

        _initAlerter();
        log('INFO', '[agent-event-observer] Attached to EventBus (FAIXA-L14)');
    }

    /**
     * Remove todos os listeners registrados (ambos modos).
     *
     * @returns {void}
     */
    function detach() {
        // Emitter registrations (legacy)
        for (const { emitter, event, listener } of _emitterRegistrations) {
            emitter.off(event, listener);
        }
        _emitterRegistrations.length = 0;

        // Bus subscriptions (L14)
        for (const unsub of _busUnsubscribers) {
            unsub();
        }
        _busUnsubscribers.length = 0;

        if (_alerter) {
            _alerter.destroy();
            _alerter = null;
        }
        log('INFO', '[agent-event-observer] Detached');
    }

    return { attach, attachToBus, detach };
}
