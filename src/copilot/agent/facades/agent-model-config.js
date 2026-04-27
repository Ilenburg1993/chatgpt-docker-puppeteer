// @ts-check
/**
 * src/copilot/agent/facades/agent-model-config.js
 *
 * Facade para configuração de modelo LLM em runtime: modelo, nível de raciocínio, modelos disponíveis. Extraído de
 * always-alive.js (O3 — PARTE-22).
 *
 * @module copilot/agent/facades/agent-model-config
 * @see EventBus
 */

import { toError } from '../../core/error-handlers.js';
import { log } from '../ports/observability-port.js';
import { trySetLiveSessionModel } from '../runtime-contracts.js';
import { readAgentRuntimeStatusSnapshot } from './agent-runtime-status.js';
import {
    listAgentSdkCatalogModels,
    readAgentSdkModelRegistryEntry,
    readAgentSdkModelStats,
} from './agent-sdk-access.js';

/**
 * Retorna o ID do modelo atual configurado no contexto.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {string}
 */
export function getModel(ctx) {
    return ctx.getModelSnapshot();
}

/**
 * Troca o modelo em uso. Aplica também na sessão SDK ativa (se suportado).
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} modelId - ID do modelo (ex. `'gpt-4.1'`, `'claude-sonnet-4-5'`)
 * @returns {void}
 */
export function setModel(ctx, modelId) {
    ctx.setModel(modelId);
    trySetLiveSessionModel(ctx.getSessionSnapshot(), modelId, 'AlwaysAlive');
}

/**
 * Lista os modelos disponíveis via SDK client.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listAvailableModels(ctx) {
    if (!ctx.getClientSnapshot()) return [];
    try {
        return await listAgentSdkCatalogModels();
    } catch (e) {
        log('WARN', `[AlwaysAlive] listModels() falhou: ${toError(e).message}`);
        return [];
    }
}

/**
 * Lista o catálogo vanilla de modelos conhecido pelo SDK.
 *
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listSdkCatalogModels() {
    return listAgentSdkCatalogModels();
}

/**
 * Lê metadata local do catálogo de modelos do SDK.
 *
 * @param {string} modelId
 * @returns {{
 *     costTier?: string;
 *     speedTier?: string;
 *     contextWindow?: number;
 *     supportsReasoning?: boolean;
 *     supportsVision?: boolean;
 * } | null}
 */
export function readSdkModelMetadata(modelId) {
    return readAgentSdkModelRegistryEntry(modelId);
}

/**
 * @returns {ReturnType<typeof readAgentSdkModelStats>}
 */
export function readSdkModelStats() {
    return readAgentSdkModelStats();
}

/**
 * Lê modelo/raciocínio atuais de um runtime vivo sem expor propriedades diretas para `presentation/`.
 *
 * @param {import('../types.js').IAlwaysAliveAgent} runtime
 * @returns {{ model: string; reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | undefined }}
 */
export function readRuntimeModelSelection(runtime) {
    const snap = readAgentRuntimeStatusSnapshot(runtime);
    const reasoning = snap['reasoningEffort'];
    return {
        model: String(snap['model'] ?? 'unknown'),
        reasoningEffort:
            reasoning === 'low' || reasoning === 'medium' || reasoning === 'high' || reasoning === 'xhigh'
                ? reasoning
                : undefined,
    };
}

/**
 * Troca o modelo de um runtime vivo por sua API pública.
 *
 * @param {{ setModel?: (modelId: string) => void }} runtime
 * @param {string} modelId
 * @returns {void}
 */
export function setRuntimeModel(runtime, modelId) {
    if (typeof runtime.setModel !== 'function') throw new Error('AGENT_RUNTIME_MODEL_SET_UNAVAILABLE');
    runtime.setModel(modelId);
}

/**
 * Troca o reasoning effort de um runtime vivo por sua API pública.
 *
 * @param {{ setReasoningEffort?: (effort: 'low' | 'medium' | 'high' | 'xhigh' | undefined) => void }} runtime
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @returns {void}
 */
export function setRuntimeReasoningEffort(runtime, effort) {
    if (typeof runtime.setReasoningEffort !== 'function') {
        throw new Error('AGENT_RUNTIME_REASONING_SET_UNAVAILABLE');
    }
    runtime.setReasoningEffort(effort);
}

/**
 * Retorna o nível de raciocínio atual.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
 */
export function getReasoningEffort(ctx) {
    return ctx.getReasoningEffortSnapshot();
}

/**
 * Troca o nível de raciocínio. Efetivo no próximo `sendMessage()`.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @returns {void}
 */
export function setReasoningEffort(ctx, effort) {
    ctx.setReasoningEffort(effort);
}
