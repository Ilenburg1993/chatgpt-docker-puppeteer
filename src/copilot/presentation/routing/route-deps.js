// @ts-check
/**
 * @module copilot/presentation/runtime-route-deps
 * @file Projeção canônica de dependências runtime para rotas do Copilot API.
 *
 *   Esta camada resolve apenas seleção de runtime. Dependências de baixo nível do SDK pertencem aos adapters
 *   `server/routes/sdk/*`, não a `presentation/`.
 */

import { resolveAgentRuntimeSelection } from '../agent/runtime/runtime-selection.js';
import { buildRuntimeRouteMetaFromSelection } from './meta.js';

/**
 * @typedef {{
 *     agent: import('#copilot/agent/always-alive').AlwaysAliveAgent;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning?: string | null;
 * }} CopilotApiRouteDeps
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {CopilotApiRouteDeps}
 */
export function buildDefaultCopilotApiRouteDeps(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        ...buildRuntimeRouteMetaFromSelection(selection),
    };
}
