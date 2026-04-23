// @ts-check
/**
 * src/copilot/agent/ports/hook-port.js
 *
 * Porta compatível entre o runtime do agent e `hooks/`.
 *
 * Esta porta traduz o estado mínimo do agent para hooks de sessão do SDK. Ela existe para que `session-setup` não
 * precise conhecer presets, audit trail, bus default ou factory concreta de hooks.
 *
 * @module copilot/agent/ports/hook-port
 * @internal
 */

import { attachBus, defaultBus } from '../../hooks/bus.js';
import { createHooks } from '../../hooks/factory.js';
import { createSessionHooks } from '../../hooks/session-hooks.js';

/**
 * Entradas mínimas exigidas pelos hooks de sessão do agent.
 *
 * A regra aqui é manter dados operacionais, não objetos de runtime: callbacks entram como funções pequenas para evitar
 * que `hooks/` receba `AgentContext` ou `AlwaysAliveAgent` completos.
 *
 * @typedef {{
 *     emitWebhook: (event: string, payload: object) => Promise<void>;
 *     getModel: () => string | undefined;
 *     scheduleFallback: (model: string) => void;
 *     emit: (event: string, payload: object) => void;
 *     metrics: { recordSessionStart: () => void; recordSessionEnd: () => void };
 * }} AgentSessionHookInput
 */

/**
 * Monta os hooks finais enviados ao SDK.
 *
 * A ordem é relevante: primeiro cria lifecycle hooks do agent, depois aplica a factory de hooks do projeto e por fim
 * acopla o bus canônico.
 *
 * @param {AgentSessionHookInput} input
 * @returns {NonNullable<import('@github/copilot-sdk').SessionConfig['hooks']>}
 */
export function buildAgentBusHooks(input) {
    const lifecycleHooks = createSessionHooks(input);
    const hooks = createHooks({
        auditLog: true,
        onSessionStart: lifecycleHooks.onSessionStart,
        onSessionEnd: lifecycleHooks.onSessionEnd,
        onErrorOccurred: lifecycleHooks.onErrorOccurred,
    });

    return attachBus(hooks);
}

/**
 * Retorna o bus default dos hooks para diagnósticos e wiring legado.
 *
 * @returns {typeof defaultBus}
 */
export function getDefaultHookBus() {
    return defaultBus;
}
