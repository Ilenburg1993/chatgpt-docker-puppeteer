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

import { wireAgentRuntimeEventBusBridge } from './facades/agent-runtime-event-bridge.js';

/**
 * @typedef {import('node:events').EventEmitter & {
 *     ctx: {
 *         getDialogLoopManagerSnapshot: () => import('node:events').EventEmitter;
 *         getHandoffManagerSnapshot: () => import('node:events').EventEmitter;
 *         eventBus: import('#copilot/events/runtime').EventBus | null;
 *     };
 * }} AgentBridgeHost
 */

let _eventBusBridgeWired = false;

/**
 * Wires the runtime emitters to the application-owned EventBus exactly once for the current agent instance.
 * @param {AgentBridgeHost} agent
 * @param {{ isCurrentAgent: (agent: AgentBridgeHost) => boolean }} options
 */
export function ensureAgentEventBusBridge(agent, options) {
    if (_eventBusBridgeWired || !options.isCurrentAgent(agent) || !agent.ctx.eventBus) return;
    wireAgentRuntimeEventBusBridge(agent, agent.ctx.eventBus);
    _eventBusBridgeWired = true;
}

/**
 * Reseta o estado interno do wiring lazy do bridge.
 *
 * @returns {void}
 */
export function resetAgentEventBusBridgeWiring() {
    _eventBusBridgeWired = false;
}
