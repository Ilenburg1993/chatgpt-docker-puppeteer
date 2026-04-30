// @ts-check
/**
 * @module copilot/runtime-wiring
 * @file Composition root do runtime Copilot.
 *
 *   Este módulo pode conhecer `agent/`, `channel/`, `conversation-hub/` e adapters legados porque não é borda.
 *   `terminal/` e `server/` recebem as dependências já compostas.
 */

import {
    ALWAYS_ALIVE_AGENT,
    alwaysAliveAgent,
    configureHookTools,
    getAgent,
    readRuntimeControlState,
    setHub,
    setPermissionAgent,
} from '#copilot/agent';
import { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '#copilot/bridges';
import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { setBridgeAgent } from './channel/client.js';
import { conversationHub } from './conversation-hub/hub.js';
import { setFallbackAgent } from './conversation-hub/orchestrator.js';
import { conversationStore } from './conversation-hub/store.js';
import { container, wireLegacySetters } from './core/di-container.js';
import { SHUTDOWN_PRIORITY } from './core/shutdown-priorities.js';
import { registerShutdownHandler } from './core/shutdown.js';
import { log } from './observability/logger.js';

/** @type {boolean} */
let _runtimeDiWired = false;

/**
 * Registra tokens DI do agent/tools stack e injeta setters legados.
 *
 * @param {{ broadcastSse: (event: string, payload?: unknown) => void }} deps
 * @returns {void}
 */
export function wireCopilotRuntimeDI({ broadcastSse }) {
    if (_runtimeDiWired) return;

    configureHookTools({ broadcastSse });

    container.register(ALWAYS_ALIVE_AGENT, () => getAgent(), 'singleton');
    container.register(HUB, () => conversationHub, 'singleton');
    container.register(CONVERSATION_STORE, () => conversationStore, 'singleton');
    container.register(PERMISSION_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(FALLBACK_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(NERV_BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');

    wireLegacySetters(container, [
        { token: HUB, setter: setHub },
        { token: PERMISSION_AGENT, setter: setPermissionAgent },
        { token: FALLBACK_AGENT, setter: setFallbackAgent },
        { token: BRIDGE_AGENT, setter: setBridgeAgent },
    ]);

    container.validateRequired([
        ALWAYS_ALIVE_AGENT,
        HUB,
        CONVERSATION_STORE,
        PERMISSION_AGENT,
        FALLBACK_AGENT,
        BRIDGE_AGENT,
        NERV_BRIDGE_AGENT,
    ]);

    registerShutdownHandler(
        'copilot.agent.stop',
        async () => {
            const agent = getAgent();
            if (readRuntimeControlState(agent).status === 'stopped') return;
            await agent.stop({ preserveDialogLoopIntent: true });
            log('INFO', '[runtime-wiring] AlwaysAliveAgent parado com intenção de dialog loop preservada.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_CRITICAL,
        { timeoutMs: 30_000 },
    );

    _runtimeDiWired = true;
}
