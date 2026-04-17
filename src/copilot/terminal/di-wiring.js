// @ts-check
/**
 * src/copilot/terminal/di-wiring.js
 *
 * Registra dependências DI específicas do modo terminal no container global. Extraído de `terminal/index.js` para
 * manter `startTerminalServer()` focado em orquestração de boot — não em low-level DI registration.
 *
 * @module copilot/terminal/di-wiring
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '#copilot/bridges';
import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { alwaysAliveAgent, configureHookTools, getAgent, setHub, setPermissionAgent } from '../agent/index.js';
import { setBridgeAgent } from '../channel/client.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { setFallbackAgent } from '../conversation-hub/orchestrator.js';
import { conversationStore } from '../conversation-hub/store.js';
import { container, wireLegacySetters } from '../core/di-container.js';
import { broadcastSse } from './dialog.js';

/** @type {boolean} */
let _terminalDiWired = false;

/**
 * Registra tokens DI do agent/tools stack e injeta setters legados.
 *
 * @returns {void}
 */
export function wireTerminalDI() {
    if (_terminalDiWired) {
        return;
    }

    // ARCH-02/03: injetar broadcastSse nas hook-tools
    configureHookTools({ broadcastSse });

    // DI container — registrar dependências de runtime (agent/tools stack)
    // L4: token canônico resolve a instância real do singleton lazy.
    // Os tokens legados abaixo continuam apontando para o proxy compatível porque `wireLegacySetters()` resolve esses
    // tokens imediatamente durante o boot do terminal.
    container.register(ALWAYS_ALIVE_AGENT, () => getAgent(), 'singleton');
    container.register(HUB, () => conversationHub, 'singleton');
    container.register(CONVERSATION_STORE, () => conversationStore, 'singleton');
    container.register(PERMISSION_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(FALLBACK_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(NERV_BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');

    // K-5: wiring centralizado — resolve tokens e invoca setters legados
    wireLegacySetters(container, [
        { token: HUB, setter: setHub },
        { token: PERMISSION_AGENT, setter: setPermissionAgent },
        { token: FALLBACK_AGENT, setter: setFallbackAgent },
        { token: BRIDGE_AGENT, setter: setBridgeAgent },
    ]);

    // Validação — garante que todos os tokens do terminal stack estão registrados
    container.validateRequired([
        ALWAYS_ALIVE_AGENT,
        HUB,
        CONVERSATION_STORE,
        PERMISSION_AGENT,
        FALLBACK_AGENT,
        BRIDGE_AGENT,
        NERV_BRIDGE_AGENT,
    ]);

    _terminalDiWired = true;
}
