// @ts-check
/**
 * @module copilot/runtime-wiring
 * @file Composition root do runtime Copilot.
 *
 *   Este módulo pode conhecer `agent/`, `channel/` e `conversation-hub/` porque não é borda. `terminal/` e `server/`
 *   recebem as dependências já compostas.
 */

import { alwaysAliveAgent, getAgent } from '#copilot/agent/always-alive';
import { configureHookTools } from '#copilot/agent/ports';
import { PROCESS_SHUTDOWN_PHASE, registerApplicationShutdownHandler } from '#copilot/boot/process-runtime';
import { getAgentRuntimeControlStateForTarget } from '#copilot/runtime';
import { configureDefaultUserInputContext } from '#copilot/sdk/session';
import { setHub, setModelGatewayRuntimeControl, setPermissionAgent } from '#copilot/tools';
import { setBridgeAgent } from './channel/client.js';
import { conversationHub } from './conversation-hub/hub.js';
import { setFallbackAgent } from './conversation-hub/orchestrator.js';
import { log } from './observability/logger.js';
import { readRuntimeCapabilitiesProjection } from './presentation/runtime/capabilities.js';
import {
    readRuntimeModelStatsProjection,
    switchRuntimeModelProjection,
    switchRuntimeRouteProjection,
} from './presentation/runtime/models.js';

/** @type {boolean} */
let _runtimeWired = false;

/**
 * Aplica as capabilities explícitas de composição necessárias ao runtime Agent/Tools/Channel/Hub.
 *
 * @param {{ broadcastSse: (event: string, payload?: unknown) => void }} deps
 * @returns {void}
 */
export function wireCopilotRuntime({ broadcastSse }) {
    if (_runtimeWired) return;

    // P2-2: unificar estado de user-input com o ToolSessionContext do agente principal.
    // `alwaysAliveAgent` é um Proxy lazy — acessar getToolSessionContext() aqui cria
    // a instância singleton do AlwaysAliveAgent se ainda não existe (comportamento intencional).
    const toolSessionContext = alwaysAliveAgent.getToolSessionContext?.() ?? undefined;
    configureHookTools({ broadcastSse, toolSessionContext });
    if (toolSessionContext) {
        configureDefaultUserInputContext(toolSessionContext);
    }

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

    registerApplicationShutdownHandler(
        'copilot.agent.stop',
        async () => {
            const agent = getAgent();
            if (getAgentRuntimeControlStateForTarget(agent).status === 'stopped') return;
            await agent.stop({ preserveDialogLoopIntent: true });
            log('INFO', '[runtime-wiring] AlwaysAliveAgent parado com intenção de dialog loop preservada.');
        },
        PROCESS_SHUTDOWN_PHASE.RUNTIME_CRITICAL,
        { timeoutMs: 30_000 },
    );

    _runtimeWired = true;
}
