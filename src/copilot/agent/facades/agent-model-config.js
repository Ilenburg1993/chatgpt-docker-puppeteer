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

import { log } from '#copilot/observability';
import { toError } from '../../core/error-handlers.js';
import { trySetLiveSessionModel } from '../runtime-contracts.js';

/**
 * Retorna o ID do modelo atual configurado no contexto.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {string}
 */
export function getModel(ctx) {
    return ctx.model;
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
    const client = ctx.getClientSnapshot();
    if (!client) return [];
    try {
        return await client.listModels();
    } catch (e) {
        log('WARN', `[AlwaysAlive] listModels() falhou: ${toError(e).message}`);
        return [];
    }
}

/**
 * Retorna o nível de raciocínio atual.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
 */
export function getReasoningEffort(ctx) {
    return ctx.reasoningEffort;
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
