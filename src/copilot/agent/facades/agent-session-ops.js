// @ts-check
/**
 * src/copilot/agent/facades/agent-session-ops.js
 *
 * Facade para operações diretas na sessão SDK do agent: abort, log, watchdog, histórico. Extraído de always-alive.js
 * (O3 — PARTE-22).
 *
 * @module copilot/agent/facades/agent-session-ops
 * @see EventBus
 */

import { logSwallowed, toError } from '#copilot/core';
import { log } from '#copilot/observability';

/**
 * Aborta a mensagem SDK em processamento na sessão atual.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {Promise<void>}
 */
export async function abortCurrentMessage(ctx) {
    const session = ctx.getSessionSnapshot();
    if (!session || typeof session.abort !== 'function') {
        log('DEBUG', '[AlwaysAlive] abortCurrentMessage(): sem sessão ativa ou abort indisponível.');
        return;
    }
    try {
        await session.abort();
        log('INFO', '[AlwaysAlive] Mensagem SDK abortada via session.abort().');
    } catch (e) {
        log('WARN', `[AlwaysAlive] session.abort() falhou: ${toError(e).message}`);
    }
}

/**
 * Pinga o watchdog do dialog loop para sinalizar atividade.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {void}
 */
export function pingDialogWatchdog(ctx) {
    ctx.dialogLoop.pingWatchdog();
}

/**
 * Registra mensagem no timeline da sessão SDK via session.log().
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} message - Mensagem para registrar no timeline
 * @param {{ level?: 'info' | 'warning' | 'error' }} [options]
 * @returns {Promise<void>}
 */
export async function sessionLog(ctx, message, options) {
    const session = ctx.getSessionSnapshot();
    if (!session || typeof session.log !== 'function') return;
    try {
        await session.log(message, options);
    } catch (e) {
        logSwallowed(e, 'agent.sessionLog');
    }
}

/**
 * Retorna o histórico de mensagens da sessão SDK ativa.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {Promise<unknown[]>}
 */
export async function getSessionMessages(ctx) {
    const session = ctx.getSessionSnapshot();
    return ctx.messagesCache.get(session);
}
