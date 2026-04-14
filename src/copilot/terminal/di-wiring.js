// @ts-check
/**
 * src/copilot/terminal/di-wiring.js
 *
 * Registra dependências DI específicas do modo terminal no container global.
 * Extraído de `terminal/index.js` para manter `startTerminalServer()` focado
 * em orquestração de boot — não em low-level DI registration.
 *
 * @module copilot/terminal/di-wiring
 */

import { alwaysAliveAgent, configureHookTools, setHub, setPermissionAgent } from '../agent/index.js';
import { setBridgeAgent } from '../channel/client.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { setFallbackAgent } from '../conversation-hub/orchestrator.js';
import { container, wireLegacySetters } from '../core/di-container.js';
import {
    BRIDGE_AGENT,
    FALLBACK_AGENT,
    NERV_BRIDGE_AGENT,
    PERMISSION_AGENT,
} from '../bridges/di-tokens.js';
import { HUB } from '../conversation-hub/di-tokens.js';
import { broadcastSse } from './dialog.js';

/**
 * Registra tokens DI do agent/tools stack e injeta setters legados.
 *
 * @returns {void}
 */
export function wireTerminalDI() {
    // ARCH-02/03: injetar broadcastSse nas hook-tools
    configureHookTools({ broadcastSse });

    // DI container — registrar dependências de runtime (agent/tools stack)
    container.register(HUB, () => conversationHub, 'singleton');
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
}
