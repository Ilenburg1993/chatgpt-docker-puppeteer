// @ts-check
/**
 * src/copilot/agent/always-alive-singleton.js
 *
 * Composition root explícito do runtime AlwaysAlive default.
 *
 * Mantém a API lazy histórica (`alwaysAliveAgent`, `getAgent`, `resetAgent`) fora da classe/fachada `always-alive.js`,
 * alinhando agent ao padrão barrel-first 2.1 já aplicado em terminal/presentation.
 *
 * @module copilot/agent/always-alive-singleton
 */

import { getApplicationEventBus } from '#copilot/boot/application-events';
import { AlwaysAliveAgent } from './always-alive.js';
import { ensureAgentEventBusBridge, resetAgentEventBusBridgeWiring } from './event-bridge/index.js';
import { registerAgentRuntime, unregisterAgentRuntime } from './runtime/registry/index.js';

export { AlwaysAliveAgent } from './always-alive.js';

/** @type {AlwaysAliveAgent | null} */
let _alwaysAliveAgent = null;

/**
 * Reseta a instância lazy do agente.
 *
 * Útil principalmente em testes e cenários controlados de reinicialização do runtime.
 *
 * @returns {void}
 */
export function resetAgent() {
    if (_alwaysAliveAgent) {
        unregisterAgentRuntime();
    }
    _alwaysAliveAgent = null;
    resetAgentEventBusBridgeWiring();
}

/**
 * G1-ARCH-01: Accessor lazy do singleton default.
 *
 * @returns {AlwaysAliveAgent}
 */
export function getAgent() {
    if (!_alwaysAliveAgent) {
        _alwaysAliveAgent = new AlwaysAliveAgent({ eventBus: getApplicationEventBus() });
    }
    registerAgentRuntime(_alwaysAliveAgent, 'default', { agentProfileId: 'always-alive' });
    ensureAgentEventBusBridge(_alwaysAliveAgent, {
        isCurrentAgent: (agent) => agent === _alwaysAliveAgent,
    });
    return _alwaysAliveAgent;
}

/**
 * Proxy de compatibilidade para manter a API pública `alwaysAliveAgent` sem instanciar o singleton no topo do módulo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = /** @type {AlwaysAliveAgent} */ (
    new Proxy(
        {},
        {
            get(_target, prop) {
                const agent = getAgent();
                const value = Reflect.get(agent, prop, agent);
                return typeof value === 'function' ? value.bind(agent) : value;
            },
            set(_target, prop, value) {
                const agent = getAgent();
                return Reflect.set(agent, prop, value, agent);
            },
            defineProperty(_target, prop, descriptor) {
                return Reflect.defineProperty(getAgent(), prop, descriptor);
            },
            deleteProperty(_target, prop) {
                return Reflect.deleteProperty(getAgent(), prop);
            },
            getOwnPropertyDescriptor(_target, prop) {
                const agent = getAgent();
                return (
                    Reflect.getOwnPropertyDescriptor(agent, prop) ??
                    Reflect.getOwnPropertyDescriptor(AlwaysAliveAgent.prototype, prop)
                );
            },
            has(_target, prop) {
                return prop in getAgent();
            },
            ownKeys() {
                return Reflect.ownKeys(getAgent());
            },
            getPrototypeOf() {
                return AlwaysAliveAgent.prototype;
            },
            isExtensible() {
                return Reflect.isExtensible(getAgent());
            },
            preventExtensions() {
                return Reflect.preventExtensions(getAgent());
            },
        },
    )
);
