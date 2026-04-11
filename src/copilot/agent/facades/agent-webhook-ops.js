// @ts-check
/**
 * src/copilot/agent/facades/agent-webhook-ops.js
 *
 * Facade para operações de webhook do agent: register, unregister, list. Extraído de always-alive.js (O3 — PARTE-22).
 *
 * @module copilot/agent/facades/agent-webhook-ops
 * @see EventBus
 */

/**
 * Registra uma URL de webhook para notificações de sessão.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
 * @returns {{ id: string; url: string }}
 */
export function registerWebhook(ctx, url) {
    return ctx.webhooks.register(url);
}

/**
 * Remove um webhook previamente registrado.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} id - ID do webhook a remover
 * @returns {boolean} true se removido, false se não encontrado
 */
export function unregisterWebhook(ctx, id) {
    return ctx.webhooks.unregister(id);
}

/**
 * Lista todos os webhooks registrados.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {{ id: string; url: string }[]}
 */
export function listWebhooks(ctx) {
    return ctx.webhooks.list();
}
