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
 * @module copilot/agent/ports/tool-port
 * @internal
 */

import { readStore } from '#copilot/tools';
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
 * @param {import('#copilot/sdk/tools-registry').ToolRegistry} registry
 * @param {import('#copilot/sdk/types').Tool[]} mcpTools
 * @returns {import('#copilot/sdk/types').Tool[]}
 */
export function bootstrapAgentTools(registry, mcpTools) {
    return bootstrapTools(registry, mcpTools);
}

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {void}
 */
export function bindAgentSessionTools(session) {
    setSessionRpc(session.rpc);
    try {
        if (typeof setExperimentalSession === 'function') {
            setExperimentalSession(session);
        }
    } catch {
        // mock parcial em testes pode omitir este export; runtime real continua cobrindo o caminho completo
    }
}

/**
 * @param {string} answer
 * @returns {boolean}
 */
export function resolveAgentUserInput(answer) {
    return resolveUserInput(answer);
}

/**
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
 * @returns {Promise<Awaited<ReturnType<typeof readStore>>>}
 */
export function readAgentTodoStore() {
    return readStore();
}

export { configureHookTools, setExperimentalSession, setHub, setPermissionAgent, setSessionRpc };
