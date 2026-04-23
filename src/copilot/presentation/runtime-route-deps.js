// @ts-check
/**
 * @module copilot/presentation/runtime-route-deps
 * @file Projeção canônica de dependências runtime para rotas do Copilot API.
 *
 *   Esta camada resolve apenas seleção de runtime. Dependências de baixo nível do SDK pertencem aos adapters
 *   `server/routes/sdk/*`, não a `presentation/`.
 */

import { resolveAgentRuntimeSelection } from './agent-runtime.js';

/**
 * @typedef {{
 *     agent: import('../agent/always-alive.js').AlwaysAliveAgent;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }} CopilotApiRouteDeps
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {CopilotApiRouteDeps}
 */
export function buildDefaultCopilotApiRouteDeps(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
    };
}
