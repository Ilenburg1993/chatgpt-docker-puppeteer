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
 * @see EventBus
 * @internal
 */

import { SessionError } from '#copilot/core';
import { EMITTER_QUESTION_ANSWERED, EMITTER_STEERING_SENT, EMITTER_TASK_QUEUED } from '#copilot/events';
import { log, startSpan, startSpanImmediate } from '#copilot/observability';
import { writeStateAsync } from '../lifecycle/state-io.js';

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
 *     attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
 *     signal?: AbortSignal;
 *     resolve: (v: string | PromiseLike<string>) => void;
 *     reject: (r: unknown) => void;
 * }} opts
 */
export function enqueueTask(ctx, host, message, { timeoutMs, attachments, signal, resolve, reject }) {
    const task = /** @type {AgentTask} */ ({
        id: `task-${Date.now()}-${globalThis.crypto.randomUUID().slice(-8)}`,        message,
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
    host.emit(EMITTER_TASK_QUEUED, { taskId: task.id, message });
}

/**
 * Envia uma mensagem ao agente (enfileira para processamento sequencial).
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} message
 * @param {{
 *     timeoutMs?: number;
 *     attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
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
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function steerMessage(ctx, host, prompt, { signal } = {}) {
    signal?.throwIfAborted();
    if (!ctx.session) {
        throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
    }
    const session = ctx.session;
    return startSpan('copilot.agent.steer', { model: ctx.model ?? '', actor: 'agent' }, async () => {
        const messageId = await session.send({ prompt, mode: 'immediate' });
        log('INFO', `[AlwaysAlive] Steering enviado: messageId=${messageId}`);
        host.emit(EMITTER_STEERING_SENT, { messageId, prompt: prompt.slice(0, 200), ts: Date.now() });
        return messageId;
    });
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
    const span = startSpanImmediate('copilot.agent.answer', { 'had_pending': String(ctx.pendingQuestion !== null) });
    if (!ctx.pendingQuestion) {
        // F68: emite evento para que hook-tools resolva via listener (sem import cross-boundary)
        host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: false });
        log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
        span?.end();
        return false;
    }
    log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
    ctx.pendingQuestion.resolve(answer);
    ctx.pendingQuestion = null;
    void writeStateAsync({ pendingQuestion: null });
    host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: true });
    span?.end();
    return true;
}
