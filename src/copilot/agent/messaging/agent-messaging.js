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

import { SessionError } from '#copilot/core';
import {
    EMITTER_QUESTION_ANSWERED,
    EMITTER_STEERING_SENT,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_QUEUED,
    EMITTER_TASK_STARTED,
} from '#copilot/events';
import { TASK_TIMEOUT_MS as ADVISORY_TASK_TIMEOUT_MS, MAX_TASK_RETRIES } from '#copilot/config/agent';
import { withAgentErrorPolicy } from '../error/index.js';
import {
    onAgentSdkSessionEvent,
    onAllAgentSdkSessionEvents,
    persistAgentRuntimeStatePartial,
    sendAgentSdkSession,
    sendAgentSdkSessionAndWait,
} from '../facades/index.js';
import { log, resolveAgentUserInput, startSpan, startSpanImmediate } from '../ports/index.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').AgentTask} AgentTask
 */

/** @typedef {import('../types.js').MessagingHost} MessagingHost */

/**
 * Normaliza timeouts externos antes de repassar ao SDK.
 *
 * @param {number | null | undefined} timeoutMs
 * @returns {number | null}
 */
function normalizeTimeoutMs(timeoutMs) {
    void timeoutMs;
    return null;
}

/**
 * Preserva a causa raiz de wrappers de erro (ex.: SdkOperationError) para manter semântica de domínio no nível do
 * agente (AbortError, SESSION_FATAL etc.).
 *
 * @param {Error} error
 * @returns {Error}
 */
function unwrapTaskError(error) {
    const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error));
    const cause = raw['cause'];
    if (cause instanceof Error) {
        return cause;
    }
    return error;
}

/**
 * @param {number | null} timeoutMs
 * @param {() => void} onTimeout
 * @returns {{ ping: () => void; clear: () => void }}
 */
function createInactivityGuard(timeoutMs, onTimeout) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let handle = null;
    let disposed = false;

    const arm = () => {
        if (timeoutMs === null) return;
        if (disposed) return;
        if (handle) clearTimeout(handle);
        handle = setTimeout(() => {
            if (disposed) return;
            disposed = true;
            handle = null;
            onTimeout();
        }, timeoutMs);
    };

    arm();

    return {
        ping: () => {
            arm();
        },
        clear: () => {
            disposed = true;
            if (handle) clearTimeout(handle);
            handle = null;
        },
    };
}

/**
 * Espera a sessão terminar o processamento com timeout por inatividade observável, não por relógio absoluto.
 *
 * Enquanto o SDK continua emitindo eventos da sessão, o relógio é renovado. Isso evita falsos positivos em turnos
 * longos de reasoning/tool use.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {import('#copilot/sdk/types').MessageOptions} sendOpts
 * @param {number | null} timeoutMs
 * @returns {Promise<import('#copilot/sdk/types').AssistantMessageEvent | undefined>}
 */
async function sendAndWaitWithInactivityTimeout(session, sendOpts, timeoutMs) {
    if (typeof session.send !== 'function') {
        if (typeof session.sendAndWait === 'function') {
            return sendAgentSdkSessionAndWait(session, sendOpts);
        }
        throw new Error('session.send is not a function');
    }

    /** @type {import('#copilot/sdk/types').AssistantMessageEvent | undefined} */
    let lastAssistantMessage;

    /** @type {() => void} */
    let resolveIdle = () => {};
    /** @type {(error: Error) => void} */
    let rejectIdle = () => {};

    const waitForIdle = new Promise((resolve, reject) => {
        resolveIdle = () => resolve(undefined);
        rejectIdle = (error) => reject(error);
    });

    const inactivityGuard = createInactivityGuard(timeoutMs, () => {
        rejectIdle(new Error(`[agent-messaging] Timeout por inatividade após ${timeoutMs}ms aguardando session.idle`));
    });

    const unsubscribe = onAllAgentSdkSessionEvents(
        session,
        (/** @type {import('#copilot/sdk/types').SessionEvent} */ event) => {
            if (event.type === 'assistant.message') {
                lastAssistantMessage = event;
                inactivityGuard.ping();
                return;
            }
            if (event.type === 'session.idle') {
                inactivityGuard.clear();
                resolveIdle();
                return;
            }
            if (event.type === 'session.error') {
                inactivityGuard.clear();
                const error = new Error(event.data.message);
                const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error));
                raw['errorType'] = event.data.errorType;
                raw['code'] = event.data.errorType;
                if (typeof event.data.stack === 'string') {
                    error.stack = event.data.stack;
                }
                rejectIdle(error);
                return;
            }
            inactivityGuard.ping();
        },
    );

    try {
        inactivityGuard.ping();
        await sendAgentSdkSession(session, sendOpts);
        await waitForIdle;
        return lastAssistantMessage;
    } finally {
        inactivityGuard.clear();
        unsubscribe();
    }
}

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
 * @property {number | null} [timeoutMs]
 * @property {import('#copilot/sdk/types').MessageOptions['attachments']} [attachments]
 * @property {Record<string, string>} [requestHeaders]
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
 *     timeoutMs?: number | null;
 *     attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
 *     requestHeaders?: Record<string, string>;
 *     signal?: AbortSignal;
 *     resolve: (v: string | PromiseLike<string>) => void;
 *     reject: (r: unknown) => void;
 * }} opts
 */
export function enqueueTask(ctx, host, message, { timeoutMs, attachments, requestHeaders, signal, resolve, reject }) {
    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);
    const task = /** @type {AgentTask} */ ({
        id: `task-${Date.now()}-${globalThis.crypto.randomUUID().slice(-8)}`,
        message,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timeoutMs: safeTimeoutMs,
        ...(attachments !== undefined ? { attachments } : {}),
        ...(requestHeaders !== undefined ? { requestHeaders } : {}),
    });
    try {
        ctx.enqueueMessageTask(task, ...(signal ? [{ signal }] : []));
    } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
    }
    host.emit(EMITTER_TASK_QUEUED, { taskId: task.id, message });
}

/**
 * Envia uma mensagem ao agente (enfileira para processamento sequencial).
 *
 * Esta é a fila de tarefas do agente/SDK. Ela não é o mailbox zero-PR de intervenção do produto: ao processar a task, o
 * executor chama `session.send()` e pode gerar `assistant.usage` / `pr.consumed`.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} message
 * @param {{
 *     timeoutMs?: number | null;
 *     attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
 *     requestHeaders?: Record<string, string>;
 *     signal?: AbortSignal;
 * }} [opts]
 * @returns {Promise<string>}
 */
export function sendMessage(ctx, host, message, { timeoutMs, attachments, requestHeaders, signal } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('AbortError: sendMessage cancelado antes de enfileirar.', 'AbortError'));
            return;
        }
        if (ctx.isDialogLoopActive()) {
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
            ...(requestHeaders !== undefined ? { requestHeaders } : {}),
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
 * @param {{ timeoutMs?: number | null; requestHeaders?: Record<string, string> }} [opts]
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
 * Implementação canônica da execução por tarefa após a decomposição incremental da `L2.3`. A lógica real vive aqui na
 * camada de `messaging`.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session - Sessão SDK ativa — deve expor `on` e `sendAndWait`.
 * @param {QueuedTask} task - Tarefa a executar.
 * @param {TaskExecutorCallbacks} callbacks - Callbacks de interação com o host pai.
 * @returns {Promise<void>}
 */
export async function executeTask(session, task, callbacks) {
    const { onDelta, setStatus, emit, tryReconnect, scheduleNext, requeueTask } = callbacks;

    const unsubDelta = onAgentSdkSessionEvent(session, 'assistant.message_delta', (event) => {
        const payload = /** @type {{ deltaContent?: string } | undefined} */ (event?.data);
        const chunk = payload?.deltaContent ?? '';
        if (chunk) onDelta(chunk, task.id);
    });

    const taskSpan = startSpanImmediate('copilot.task', { taskId: task.id });

    /** @type {Map<string, import('../../observability/otel.js').OtelSpan>} */
    const toolSpans = new Map();

    const unsubToolStart = onAgentSdkSessionEvent(session, 'tool.execution_start', (event) => {
        const payload = /** @type {Record<string, unknown> | undefined} */ (/** @type {unknown} */ (event?.data));
        const toolCallId = /** @type {string} */ (payload?.['toolCallId'] ?? '');
        const toolName = /** @type {string} */ (payload?.['toolName'] ?? '');
        const toolSpan = startSpanImmediate('copilot.tool', { toolName, toolCallId, taskId: task.id });
        if (toolSpan && toolCallId) toolSpans.set(toolCallId, toolSpan);
    });

    const unsubToolComplete = onAgentSdkSessionEvent(session, 'tool.execution_complete', (event) => {
        const payload = /** @type {Record<string, unknown> | undefined} */ (/** @type {unknown} */ (event?.data));
        const toolCallId = /** @type {string} */ (payload?.['toolCallId'] ?? '');
        const toolSpan = toolSpans.get(toolCallId);
        if (toolSpan) {
            toolSpan.end();
            toolSpans.delete(toolCallId);
        }
    });

    const startTime = Date.now();
    /** @type {number | undefined} */
    let idleTime;
    const unsubIdle = onAgentSdkSessionEvent(session, 'session.idle', () => {
        idleTime = Date.now();
    });

    try {
        const sendOpts = /** @type {import('#copilot/sdk/types').MessageOptions} */ ({
            prompt: task.message,
            ...(task.attachments !== undefined ? { attachments: task.attachments } : {}),
            ...(task.requestHeaders !== undefined ? { requestHeaders: task.requestHeaders } : {}),
        });
        const effectiveTimeoutMs = task.timeoutMs ?? null;
        log(
            'DEBUG',
            `[agent-messaging] task timeout disabled; advisory=${ADVISORY_TASK_TIMEOUT_MS}ms taskId=${task.id}`,
        );
        const execution = await withAgentErrorPolicy(
            () => sendAndWaitWithInactivityTimeout(session, sendOpts, effectiveTimeoutMs),
            {
                label: 'messaging.sendAndWait',
                phase: 'messaging',
                taskId: task.id,
                sessionId: session.sessionId,
            },
        );

        if (!execution.ok) {
            const { disposition, error } = execution;
            const taskError = unwrapTaskError(error);

            if (disposition === 'ignore') {
                setStatus('idle');
                emit('task.error', { taskId: task.id, error: 'AbortError' });
                task.reject(taskError);
                return;
            }

            if (disposition === 'fatal') {
                setStatus('idle');
                emit('task.error', { taskId: task.id, error: taskError.message });
                task.reject(taskError);
                return;
            }

            const recovered = await tryReconnect(taskError);
            if (recovered) {
                task.attempts = (task.attempts ?? 0) + 1;
                if (task.attempts >= MAX_TASK_RETRIES) {
                    setStatus('idle');
                    emit('task.error', {
                        taskId: task.id,
                        error: `Máximo de ${MAX_TASK_RETRIES} tentativas atingido após reconexão`,
                    });
                    task.reject(
                        new Error(
                            `[task-executor] Máximo de ${MAX_TASK_RETRIES} tentativas atingido (taskId: ${task.id})`,
                        ),
                    );
                } else {
                    requeueTask(task);
                    setStatus('idle');
                }
            } else {
                setStatus('idle');
                emit('task.error', { taskId: task.id, error: taskError.message });
                task.reject(taskError);
            }
            return;
        }

        const event = execution.value;
        const text = event?.data?.content ?? '';
        const durationMs = (idleTime ?? Date.now()) - startTime;
        setStatus('idle');
        emit('task.completed', { taskId: task.id, response: text, responseLen: text.length, durationMs });
        task.resolve(text);
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
    const session = ctx.getSessionSnapshot();
    if (ctx.isReconnectActive() || !ctx.isIdle() || !ctx.hasQueuedMessages() || !session) {
        return;
    }

    const task = ctx.shiftMessageTask();
    if (!task) {
        return;
    }

    ctx.setStatus('processing', host);
    host.emit(EMITTER_TASK_STARTED, { taskId: task.id });

    log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
    ctx.incrementSendCount();
    // F42.2: registrar atividade para reset do timer de idle do keepalive
    ctx.pingKeepalive();

    void executeTask(session, task, {
        onDelta: (chunk, taskId) => host.emit(EMITTER_TASK_DELTA, { taskId, chunk }),
        setStatus: (status) => ctx.setStatus(status, host),
        emit: (event, payload) => host.emit(event, payload),
        tryReconnect: (error) => callbacks.tryReconnect(error),
        requeueTask: (queuedTask) => ctx.unshiftMessageTask(queuedTask),
        scheduleNext: () => processQueue(ctx, host, callbacks),
    });
}

/**
 * Envia uma mensagem em modo "steering" (immediate).
 *
 * Caminho SDK direto: usa `session.send({ mode: 'immediate' })` e, portanto, não é zero-PR garantido. As rotas de
 * controle bloqueiam esse caminho por default para origens operacionais e preservam a intenção no mailbox.
 *
 * @param {AgentContext} ctx
 * @param {MessagingHost} host
 * @param {string} prompt
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function steerMessage(ctx, host, prompt, { signal } = {}) {
    signal?.throwIfAborted();
    const session = ctx.getSessionSnapshot();
    if (!session) {
        throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
    }
    return startSpan('copilot.agent.steer', { model: ctx.getModelSnapshot(), actor: 'agent' }, async () => {
        const messageId = await sendAgentSdkSession(session, { prompt, mode: 'immediate' });
        log('INFO', `[AlwaysAlive] Steering enviado: messageId=${messageId}`);
        host.emit(EMITTER_STEERING_SENT, { messageId, prompt: prompt.slice(0, 200), ts: Date.now() });
        return messageId ?? '';
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
        had_pending: String(ctx.hasPendingQuestion()),
    });
    if (!ctx.hasPendingQuestion()) {
        const resolvedViaTool = resolveAgentUserInput(answer);
        // Mantemos o evento para observabilidade/metricas, incluindo o resultado do fallback tool-side.
        host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: false, resolvedViaTool });
        if (resolvedViaTool) {
            log('INFO', '[AlwaysAlive] answerPendingQuestion() roteou resposta para request_user_input pendente.');
            span?.end();
            return true;
        }
        log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
        span?.end();
        return false;
    }
    log('DEBUG', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
    ctx.resolvePendingQuestion(answer);
    void ctx.trackBackgroundTask(
        persistAgentRuntimeStatePartial(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'question.clear.pending' },
        ).then((result) => {
            if (!result.ok) {
                throw result.error;
            }
            return undefined;
        }),
        {
            label: 'question.clear.pending',
            description: 'Clear persisted pendingQuestion',
        },
    );
    host.emit(EMITTER_QUESTION_ANSWERED, { answer, hadPending: true });
    span?.end();
    return true;
}
