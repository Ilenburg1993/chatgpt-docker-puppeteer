// @ts-check
/**
 * src/copilot/agent/event-bridge-wiring.js
 *
 * K6b: wiring lazy do bridge EventEmitter → EventBus extraído de `always-alive.js`.
 *
 * Mantém a estratégia de bootstrap preguiçoso: o wiring só é tentado quando o singleton é solicitado, e reintenta em
 * chamadas futuras caso o EventBus ainda não esteja disponível.
 *
 * @module copilot/agent/event-bridge-wiring
 */

import { container, logSwallowed } from '#copilot/core';
import { wireAgentRuntimeEventBusBridge } from './facades/index.js';

/**
 * @typedef {import('node:events').EventEmitter & {
 *     ctx: {
 *         getDialogLoopManagerSnapshot: () => import('node:events').EventEmitter;
 *         getHandoffManagerSnapshot: () => import('node:events').EventEmitter;
 *     };
 * }} AgentBridgeHost
 */

let _eventBusBridgeWired = false;
let _eventBusBridgePending = false;

/**
 * Extrai o campo `code` de um erro arbitrário sem recorrer a cast duplo via `unknown`.
 *
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getErrorCode(error) {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return undefined;
    }
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}

/**
 * Inicializa o bridge do agente para o EventBus central de forma lazy.
 *
 * O wiring fica fora do topo do módulo para permitir que o singleton seja criado apenas sob demanda. Se o EventBus
 * ainda não estiver disponível, uma próxima chamada poderá tentar novamente.
 *
 * @param {AgentBridgeHost} agent
 * @param {{ isCurrentAgent: (agent: AgentBridgeHost) => boolean }} options
 * @returns {void}
 */
export function ensureAgentEventBusBridge(agent, options) {
    if (_eventBusBridgeWired || _eventBusBridgePending) {
        return;
    }
    _eventBusBridgePending = true;

    void (async () => {
        try {
            const { EVENT_BUS } = await import('../core/di-tokens.js');

            if (!options.isCurrentAgent(agent)) {
                return;
            }

            if (!container.has(EVENT_BUS)) {
                return;
            }

            const bus = container.resolve(EVENT_BUS);
            if (!bus) {
                return;
            }

            wireAgentRuntimeEventBusBridge(agent, bus);

            _eventBusBridgeWired = true;
        } catch (_busWiringErr) {
            const code = getErrorCode(_busWiringErr);
            if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
                logSwallowed(_busWiringErr, 'AlwaysAliveAgent.eventBusWiring');
            }
        } finally {
            if (!_eventBusBridgeWired || !options.isCurrentAgent(agent)) {
                _eventBusBridgePending = false;
            }
        }
    })();
}

/**
 * Reseta o estado interno do wiring lazy do bridge.
 *
 * @returns {void}
 */
export function resetAgentEventBusBridgeWiring() {
    _eventBusBridgeWired = false;
    _eventBusBridgePending = false;
}
