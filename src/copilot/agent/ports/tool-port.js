// @ts-check
/**
 * src/copilot/agent/ports/tool-port.js
 *
 * Porta compatível entre o runtime do agent e `tools/`.
 *
 * Este módulo concentra o acoplamento inevitável com tools enquanto a arquitetura migra para ports explícitos. Módulos
 * quentes de lifecycle/session devem depender desta porta, não de `tools/bootstrap.js` ou `tools/hook-tools.js`
 * diretamente.
 *
 * Responsabilidades desta porta:
 *
 * - montar o registry de tools do agent;
 * - vincular/desvincular a sessão SDK ativa aos helpers legados de tools;
 * - resolver respostas de `ask_user` que vieram por tools/hook-tools;
 * - concentrar compatibilidade de tools até `tools/` também falar em capabilities explícitas.
 *
 * @module copilot/agent/ports/tool-port
 * @internal
 */

import { createSessionRpcFacade } from '#copilot/sdk';
import { isToolDisabled, readStore } from '#copilot/tools';
import {
    bootstrapTools,
    configureHookTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
} from '../../tools/bootstrap.js';
import { resolveUserInput } from '../../tools/hook-tools.js';

/**
 * Registra tools do runtime e tools vindas do MCP no registry recebido.
 *
 * O caller continua dono do lifecycle do registry; esta porta só executa o bootstrap concreto para que `session-setup`
 * não precise importar `tools/bootstrap.js`.
 *
 * @param {import('#copilot/sdk/tools-registry').ToolRegistry} registry
 * @param {import('#copilot/sdk/types').Tool[]} mcpTools
 * @returns {import('#copilot/sdk/types').Tool[]}
 */
export function bootstrapAgentTools(registry, mcpTools) {
    return bootstrapTools(registry, mcpTools);
}

/**
 * Propaga a sessão SDK ativa para helpers de tools que ainda dependem de estado global legado.
 *
 * Quando essa compatibilidade desaparecer, este método deve virar no-op ou ser removido junto com o estado global
 * correspondente em `tools/`.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {void}
 */
export function bindAgentSessionTools(session) {
    setSessionRpc(createSessionRpcFacade(session));
    try {
        if (typeof setExperimentalSession === 'function') {
            setExperimentalSession(session);
        }
    } catch {
        // mock parcial em testes pode omitir este export; runtime real continua cobrindo o caminho completo
    }
}

/**
 * Resolve uma resposta pendente de input do usuário através do canal legado de hook-tools.
 *
 * @param {string} answer
 * @param {string | undefined} [requestId]
 * @returns {boolean}
 */
export function resolveAgentUserInput(answer, requestId) {
    return resolveUserInput(answer, requestId);
}

/**
 * Remove referências da sessão SDK ativa nos helpers legados de tools durante shutdown.
 *
 * @returns {void}
 */
export function unbindAgentSessionTools() {
    setSessionRpc(null);
    try {
        if (typeof setExperimentalSession === 'function') {
            setExperimentalSession(null);
        }
    } catch {
        // mock parcial em testes pode omitir este export; runtime real continua cobrindo o caminho completo
    }
}

/**
 * Lê o TODO store exposto por `tools/` através da porta do agent.
 *
 * @returns {Promise<Awaited<ReturnType<typeof readStore>>>}
 */
export function readAgentTodoStore() {
    return readStore();
}

/**
 * Verifica se uma tool foi desabilitada dinamicamente em runtime (ex.: via `toggle_tool`).
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isAgentToolDisabled(toolName) {
    return isToolDisabled(toolName);
}

export { configureHookTools, setExperimentalSession, setHub, setPermissionAgent, setSessionRpc };
