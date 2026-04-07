// @ts-check
/**
 * src/copilot/agent/messaging/agent-messaging.js
 *
 * F38: Lógica de envio e recebimento de mensagens — extraída de always-alive.js.
 *
 * Funções para enfileirar mensagens, responder perguntas pendentes e enviar steering messages. Opera sobre o
 * AgentContext e emite eventos via host.
 *
 * @module copilot/agent/messaging/agent-messaging
 * @internal
 */

import { SessionError } from '#copilot/core/errors';
import { log } from '#copilot/observability/logger';
import { resolveUserInput as hookToolsResolveUserInput } from '../../tools/hook-tools.js';
import { persistState } from '../lifecycle/state-io.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').AgentTask} AgentTask
 */

/** @typedef {import('../types.js').MessagingHost} MessagingHost */

/**
 * Enfileira uma task — usado por sendMessage e sendMessageDialogBoot.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} message
 * @param {{
 *     timeoutMs?: number;
 *     attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
 *     signal?: AbortSignal;
 *     resolve: (v: string | PromiseLike<string>) => void;
 *     reject: (r: unknown) => void;
 * }} opts
 */
export function enqueueTask(ctx, host, message, { timeoutMs, attachments, signal, resolve, reject }) {
    const task = /** @type {AgentTask} */ ({
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
    });
    try {
        ctx.messageQueue.enqueue(task, ...(signal ? [{ signal }] : []));
    } catch (/** @type {any} */ err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
    }
    host.emit('task.queued', { taskId: task.id, message });
}

/**
 * Envia uma mensagem ao agente (enfileira para processamento sequencial).
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} message
 * @param {{
 *     timeoutMs?: number;
 *     attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
 *     signal?: AbortSignal;
 * }} [opts]
 * @returns {Promise<string>}
 */
export function sendMessage(ctx, host, message, { timeoutMs, attachments, signal } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('AbortError: sendMessage cancelado antes de enfileirar.', 'AbortError'));
            return;
        }
        if (ctx.dialogLoop.active) {
            reject(
                new SessionError(
                    '[AlwaysAlive] sendMessage() bloqueado: dialog loop ativo. Use sendDialogTurn().',
                    'DIALOG_ACTIVE',
                ),
            );
            return;
        }
        enqueueTask(ctx, host, message, {
            resolve,
            reject,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(attachments !== undefined ? { attachments } : {}),
            ...(signal !== undefined ? { signal } : {}),
        });
    });
}

/**
 * Variante interna de sendMessage() para o DialogLoopManager (boot prompt). Bypassa o guard de dialog loop ativo.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} message
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export function sendMessageDialogBoot(ctx, host, message, opts = {}) {
    return new Promise((resolve, reject) => {
        enqueueTask(ctx, host, message, { ...opts, resolve, reject });
    });
}

/**
 * Envia uma mensagem em modo "steering" (immediate).
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function steerMessage(ctx, host, prompt) {
    if (!ctx.session) {
        throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
    }
    const messageId = await ctx.session.send({ prompt, mode: 'immediate' });
    log('INFO', `[AlwaysAlive] Steering enviado: messageId=${messageId}`);
    host.emit('steering.sent', { messageId, prompt: prompt.slice(0, 200), ts: Date.now() });
    return messageId;
}

/**
 * Responde a uma pergunta pendente do modelo.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} answer
 * @returns {boolean}
 */
export function answerPendingQuestion(ctx, host, answer) {
    if (!ctx.pendingQuestion) {
        if (!hookToolsResolveUserInput(answer)) {
            log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
        }
        return false;
    }
    log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
    ctx.pendingQuestion.resolve(answer);
    ctx.pendingQuestion = null;
    persistState({ pendingQuestion: null }, '[AlwaysAlive] writeState pendingQuestion=null');
    host.emit('question.answered', { answer });
    hookToolsResolveUserInput(answer);
    return true;
}
