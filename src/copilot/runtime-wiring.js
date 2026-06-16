// @ts-check
/**
 * @module copilot/runtime-wiring
 * @file Composition root do runtime Copilot.
 *
 *   Este módulo pode conhecer `agent/`, `channel/` e `conversation-hub/` porque não é borda. `terminal/` e `server/`
 *   recebem as dependências já compostas.
 */

import { alwaysAliveAgent, getAgent } from '#copilot/agent/always-alive';
import { ALWAYS_ALIVE_AGENT } from '#copilot/agent/di-tokens';
import { configureHookTools } from '#copilot/agent/ports';
import { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '#copilot/bridges';
import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { getAgentRuntimeControlStateForTarget } from '#copilot/runtime';
import { configureDefaultUserInputContext } from '#copilot/sdk';
import { setHub, setModelGatewayRuntimeControl, setPermissionAgent } from '#copilot/tools';
import { readRuntimeCapabilitiesProjection } from './presentation/runtime/capabilities.js';
import {
    readRuntimeModelStatsProjection,
    switchRuntimeModelProjection,
    switchRuntimeRouteProjection,
} from './presentation/runtime/models.js';
import { setBridgeAgent } from './channel/client.js';
import { conversationHub } from './conversation-hub/hub.js';
import { setFallbackAgent } from './conversation-hub/orchestrator.js';
import { conversationStore } from './conversation-hub/store.js';
import { container } from './core/di-container.js';
import { SHUTDOWN_PRIORITY } from './core/shutdown-priorities.js';
import { registerShutdownHandler } from './core/shutdown.js';
import { log } from './observability/logger.js';

/** @type {boolean} */
let _runtimeDiWired = false;

/**
 * Registra tokens DI do agent/tools stack e aplica as injeções explícitas de composição necessárias.
 *
 * @param {{ broadcastSse: (event: string, payload?: unknown) => void }} deps
 * @returns {void}
 */
export function wireCopilotRuntimeDI({ broadcastSse }) {
    if (_runtimeDiWired) return;

    // P2-2: unificar estado de user-input com o ToolSessionContext do agente principal.
    // `alwaysAliveAgent` é um Proxy lazy — acessar getToolSessionContext() aqui cria
    // a instância singleton do AlwaysAliveAgent se ainda não existe (comportamento intencional).
    const toolSessionContext = alwaysAliveAgent.getToolSessionContext?.() ?? undefined;
    configureHookTools({ broadcastSse, toolSessionContext });
    if (toolSessionContext) {
        configureDefaultUserInputContext(toolSessionContext);
    }

    container.register(ALWAYS_ALIVE_AGENT, () => getAgent(), 'singleton');
    container.register(HUB, () => conversationHub, 'singleton');
    container.register(CONVERSATION_STORE, () => conversationStore, 'singleton');
    container.register(PERMISSION_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(FALLBACK_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(NERV_BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');

    setHub(conversationHub);
    setModelGatewayRuntimeControl({
        readCapabilities: readRuntimeCapabilitiesProjection,
        readStats: readRuntimeModelStatsProjection,
        switchModel: switchRuntimeModelProjection,
        switchRoute: switchRuntimeRouteProjection,
    });
    setPermissionAgent(alwaysAliveAgent);
    setFallbackAgent(alwaysAliveAgent);
    setBridgeAgent(alwaysAliveAgent);

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
            if (getAgentRuntimeControlStateForTarget(agent).status === 'stopped') return;
            await agent.stop({ preserveDialogLoopIntent: true });
            log('INFO', '[runtime-wiring] AlwaysAliveAgent parado com intenção de dialog loop preservada.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_CRITICAL,
        { timeoutMs: 30_000 },
    );

    _runtimeDiWired = true;
}
