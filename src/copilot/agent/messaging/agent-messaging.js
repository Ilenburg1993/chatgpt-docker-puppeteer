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
 * @see EventBus
 */

import { SessionError, toError } from '#copilot/core';
import {
    EMITTER_QUESTION_ANSWERED,
    EMITTER_STEERING_SENT,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_QUEUED,
    EMITTER_TASK_STARTED,
} from '#copilot/events';
import { log, startSpan, startSpanImmediate } from '#copilot/observability';
import { TASK_TIMEOUT_MS as DEFAULT_TASK_TIMEOUT_MS, MAX_TASK_RETRIES } from '../../config/agent.js';
import { classifyAgentError } from '../error-policy.js';
import { writeStateAsync } from '../lifecycle/state-io.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').AgentTask} AgentTask
 */

/** @typedef {import('../types.js').MessagingHost} MessagingHost */

/**
 * @typedef {Object} QueueProcessorCallbacks
 * @property {(error: Error) => Promise<boolean>} tryReconnect - Tenta reconectar a sessão ativa
 */

/**
 * @typedef {object} TaskExecutorCallbacks
 * @property {(chunk: string, taskId: string) => void} onDelta - Emite fragmento de resposta em streaming
 * @property {(status: 'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped') => void} setStatus - Muda o
 *   status do agente
 * @property {(event: string, payload: object) => void} emit - Emite evento no agente pai
 * @property {(error: Error) => Promise<boolean>} tryReconnect - Tenta reconectar a sessão; retorna true se ok
 * @property {() => void} scheduleNext - Reagenda a fila para processar a próxima tarefa
 * @property {(task: QueuedTask) => void} requeueTask - Reinsere a tarefa no início da fila
 */

/**
 * @typedef {object} QueuedTask
 * @property {string} id
 * @property {string} message
 * @property {number} [timeoutMs]
 * @property {import('#copilot/sdk/types').MessageOptions['attachments']} [attachments]
 * @property {number} enqueuedAt
 * @property {number} [attempts] - Número de tentativas realizadas (para limitar reintentos após reconexão)
 * @property {(text: string) => void} resolve
 * @property {(err: Error) => void} reject
 */

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
        id: `task-${Date.now()}-${globalThis.crypto.randomUUID().slice(-8)}`,
        message,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
    });
    try {
        ctx.messageQueue.enqueue(task, ...(signal ? [{ signal }] : []));
    } catch (err) {
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
 * Executa uma única tarefa da fila do agente de forma assíncrona.
 *
 * Implementação canônica da execução por tarefa após a decomposição incremental da `L2.3`. O caminho legado
 * `agent/infra/task-executor.js` permanece temporariamente como compat shim, mas a lógica real vive aqui na camada de
 * `messaging`.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session - Sessão SDK ativa — deve expor `on` e `sendAndWait`.
 * @param {QueuedTask} task - Tarefa a executar.
 * @param {TaskExecutorCallbacks} callbacks - Callbacks de interação com o host pai.
 * @returns {Promise<void>}
 */
export async function executeTask(session, task, callbacks) {
    const { onDelta, setStatus, emit, tryReconnect, scheduleNext, requeueTask } = callbacks;

    const unsubDelta = session.on(
        'assistant.message_delta',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const chunk = /** @type {string} */ (event?.data?.['deltaContent'] ?? '');
            if (chunk) onDelta(chunk, task.id);
        },
    );

    const taskSpan = startSpanImmediate('copilot.task', { taskId: task.id });

    /** @type {Map<string, import('../../observability/otel.js').OtelSpan>} */
    const toolSpans = new Map();

    const unsubToolStart = session.on(
        'tool.execution_start',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const toolCallId = /** @type {string} */ (event?.data?.['toolCallId'] ?? '');
            const toolName = /** @type {string} */ (event?.data?.['toolName'] ?? '');
            const toolSpan = startSpanImmediate('copilot.tool', { toolName, toolCallId, taskId: task.id });
            if (toolSpan && toolCallId) toolSpans.set(toolCallId, toolSpan);
            emit('tool.execution_start', {
                toolCallId,
                toolName,
                args: event?.data?.['arguments'] ?? {},
                mcpServerName: /** @type {string | null} */ (event?.data?.['mcpServerName'] ?? null),
                taskId: task.id,
            });
        },
    );

    const unsubToolComplete = session.on(
        'tool.execution_complete',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const toolCallId = /** @type {string} */ (event?.data?.['toolCallId'] ?? '');
            const toolSpan = toolSpans.get(toolCallId);
            if (toolSpan) {
                toolSpan.end();
                toolSpans.delete(toolCallId);
            }
            emit('tool.execution_complete', {
                toolCallId,
                toolName: /** @type {string | null} */ (event?.data?.['toolName'] ?? null),
                success: /** @type {boolean} */ (event?.data?.['success'] ?? false),
                taskId: task.id,
            });
        },
    );

    const startTime = Date.now();
    /** @type {number | undefined} */
    let idleTime;
    const unsubIdle = session.on('session.idle', () => {
        idleTime = Date.now();
    });

    try {
        const sendOpts = /** @type {import('#copilot/sdk/types').MessageOptions} */ ({
            prompt: task.message,
            ...(task.attachments !== undefined ? { attachments: task.attachments } : {}),
        });
        const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
        const text = event?.data?.content ?? '';
        const durationMs = (idleTime ?? Date.now()) - startTime;
        setStatus('idle');
        emit('task.completed', { taskId: task.id, response: text, responseLen: text.length, durationMs });
        task.resolve(text);
    } catch (error) {
        const disposition = classifyAgentError(error);

        if (disposition === 'ignore') {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: 'AbortError' });
            task.reject(toError(error));
            return;
        }

        if (disposition === 'fatal') {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: toError(error).message });
            task.reject(toError(error));
            return;
        }

        const recovered = await tryReconnect(toError(error));
        if (recovered) {
            task.attempts = (task.attempts ?? 0) + 1;
            if (task.attempts >= MAX_TASK_RETRIES) {
                setStatus('idle');
                emit('task.error', {
                    taskId: task.id,
                    error: `Máximo de ${MAX_TASK_RETRIES} tentativas atingido após reconexão`,
                });
                task.reject(
                    new Error(`[task-executor] Máximo de ${MAX_TASK_RETRIES} tentativas atingido (taskId: ${task.id})`),
                );
            } else {
                requeueTask(task);
                setStatus('idle');
            }
        } else {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: toError(error).message });
            task.reject(toError(error));
        }
    } finally {
        unsubDelta();
        unsubToolStart();
        unsubToolComplete();
        unsubIdle();
        for (const span of Array.from(toolSpans.values())) span.end();
        toolSpans.clear();
        taskSpan?.end();
        scheduleNext();
    }
}

/**
 * Processa a próxima tarefa da fila (se idle e sessão ativa).
 *
 * Implementação canônica da L2.3. Substitui a lógica antes isolada em `queue-processor.js`, preservando a mesma
 * semântica de execução, requeue e reagendamento.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {QueueProcessorCallbacks} callbacks
 * @returns {void}
 */
export function processQueue(ctx, host, callbacks) {
    // G1-ARCH-03: bloqueia processamento durante reconexão ativa
    if (
        ctx.sessionState.isReconnecting ||
        ctx.runtimeState.status !== 'idle' ||
        ctx.messageQueue.size === 0 ||
        !ctx.sessionState.session
    ) {
        return;
    }
    const session = ctx.sessionState.session;
    const statusHost = /** @type {import('node:events').EventEmitter} */ (/** @type {unknown} */ (host));

    const task = ctx.messageQueue.shift();
    if (!task) {
        return;
    }

    ctx.setStatus('processing', statusHost);
    host.emit(EMITTER_TASK_STARTED, { taskId: task.id });

    log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
    ctx.metricsState.sendCount++;
    // F42.2: registrar atividade para reset do timer de idle do keepalive
    ctx.keepalive.ping();

    void executeTask(session, task, {
        onDelta: (chunk, taskId) => host.emit(EMITTER_TASK_DELTA, { taskId, chunk }),
        setStatus: (status) => ctx.setStatus(status, statusHost),
        emit: (event, payload) => host.emit(event, payload),
        tryReconnect: (error) => callbacks.tryReconnect(error),
        requeueTask: (queuedTask) => ctx.messageQueue.unshift(queuedTask),
        scheduleNext: () => processQueue(ctx, host, callbacks),
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
    if (!ctx.sessionState.session) {
        throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
    }
    const session = ctx.sessionState.session;
    return startSpan('copilot.agent.steer', { model: ctx.configState.model ?? '', actor: 'agent' }, async () => {
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
    const span = startSpanImmediate('copilot.agent.answer', {
        had_pending: String(ctx.dialogState.pendingQuestion !== null),
    });
    if (!ctx.dialogState.pendingQuestion) {
        // F68: emite evento para que hook-tools resolva via listener (sem import cross-boundary)
        host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: false });
        log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
        span?.end();
        return false;
    }
    log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
    ctx.dialogState.pendingQuestion.resolve(answer);
    ctx.dialogState.pendingQuestion = null;
    void ctx.backgroundTasks.track(writeStateAsync({ pendingQuestion: null }), {
        label: 'question.clear.pending',
        description: 'Clear persisted pendingQuestion',
    });
    host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: true });
    span?.end();
    return true;
}
