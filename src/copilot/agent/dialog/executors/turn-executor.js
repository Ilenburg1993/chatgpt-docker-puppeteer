// @ts-check
/**
 * @module copilot/agent/dialog/turn-executor
 * @file Executor de turno individual: envia mensagem ao SDK, processa resposta, emite eventos de início/fim e trata
 *   erros de sessão por turno.
 *
 *   src/copilot/agent/dialog/executors/turn-executor.js
 */

import { container, SessionError, toError } from '#copilot/core';
import {
    EMITTER_LOOP_READY,
    EMITTER_LOOP_REPLY,
    EMITTER_LOOP_STOPPED,
    EMITTER_QUESTION_PENDING,
    EMITTER_TURN_START,
} from '#copilot/events';
import { persistAgentRuntimePendingTurnState } from '../../facades/index.js';
import { log, METRICS_STORE, startSpan } from '../../ports/index.js';
import {
    buildTurnResolutionListenersImpl,
    castListener as castListenerImpl,
    createAbortError as createAbortErrorImpl,
    createAssistantReplyFallback as createAssistantReplyFallbackImpl,
    createInactivityTimeout as createInactivityTimeoutImpl,
    detachAbortListener as detachAbortListenerImpl,
    dispatchTurnToHostImpl,
    finalizeTurnReply as finalizeTurnReplyImpl,
    normalizeAssistantMessageEvent as normalizeAssistantMessageEventImpl,
    normalizeAssistantReplyCandidate as normalizeAssistantReplyCandidateImpl,
    normalizeReplyEvent as normalizeReplyEventImpl,
    normalizeStopEvent as normalizeStopEventImpl,
    readPendingProtocolSnapshot as readPendingProtocolSnapshotImpl,
    traceLabel as traceLabelImpl,
} from '../seams/index.js';

/**
 * Subconjunto do EventEmitter necessário para os executores de turno.
 *
 * @typedef {{
 *     on: (event: string, listener: (...args: any[]) => void) => void;
 *     once: (event: string, listener: (...args: any[]) => void) => void;
 *     off: (event: string, listener: (...args: any[]) => void) => void;
 *     emit: (event: string, ...args: any[]) => void;
 * }} TurnEmitter
 *
 *
 * @typedef {{
 *     on?: ((event: string, listener: (...args: any[]) => void) => void) | undefined;
 *     off?: ((event: string, listener: (...args: any[]) => void) => void) | undefined;
 * }} ProgressEventSource
 */

/** @typedef {import('../../types.js').DialogTurnHost} TurnHost */

/**
 * Cria um listener que aceita `unknown` e faz cast para o tipo esperado.
 *
 * @template T
 * @param {(evt: T) => void} fn
 * @returns {(evt: unknown) => void}
 */
function castListener(fn) {
    return castListenerImpl(fn);
}

/**
 * @param {unknown} evt
 * @returns {{ reply: string }}
 */
function normalizeReplyEvent(evt) {
    return normalizeReplyEventImpl(evt);
}

/**
 * @param {unknown} evt
 * @returns {{ authorized?: boolean; reason?: string }}
 */
function normalizeStopEvent(evt) {
    return normalizeStopEventImpl(evt);
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {() => void} listener
 * @returns {void}
 */
function detachAbortListener(signal, listener) {
    return detachAbortListenerImpl(signal, listener);
}

/**
 * @param {string} message
 * @returns {Error}
 */
function createAbortError(message) {
    return createAbortErrorImpl(message);
}

/**
 * @param {unknown} evt
 * @returns {{ content: string; ts: number | null }}
 */
function normalizeAssistantMessageEvent(evt) {
    return normalizeAssistantMessageEventImpl(evt);
}

/**
 * @param {string} content
 * @returns {string | null}
 */
function normalizeAssistantReplyCandidate(content) {
    return normalizeAssistantReplyCandidateImpl(content);
}

/**
 * @param {TurnHost} host
 * @returns {{ kind: 'reply' | 'ready' | 'stopped'; question: string; reply?: string } | null}
 */
function readPendingProtocolSnapshot(host) {
    return readPendingProtocolSnapshotImpl(host);
}

/**
 * @param {number} turnStart
 * @param {string} reply
 * @param {{
 *     emit: (event: string, payload: object) => void;
 *     metrics: { recordDialogTurn: (durationMs: number, success: boolean) => void };
 * }} input
 * @returns {void}
 */
function finalizeTurnReply(turnStart, reply, input) {
    return finalizeTurnReplyImpl(turnStart, reply, input);
}

/**
 * @param {string | undefined} [traceId]
 * @returns {string}
 */
function traceLabel(traceId) {
    return traceLabelImpl(traceId);
}

/**
 * Cria um timeout de inatividade: o relógio reinicia quando o SDK/Agent demonstra progresso observável.
 *
 * Isso preserva a política 0 PR. Um turno lento mas vivo não é abortado só por ser longo; só falha quando fica mudo por
 * mais do que a janela calculada pela policy.
 *
 * @param {TurnEmitter} emitter
 * @param {{
 *     timeout: number | null;
 *     onTimeout: () => void;
 *     traceId?: string;
 *     phase: string;
 *     progressSources?: ProgressEventSource[] | undefined;
 * }} opts
 *   Quando `timeout` é `null`, nenhum timer é criado — o watchdog do dialog loop torna-se o único guardião de stall.
 * @returns {{ timeoutHandle: ReturnType<typeof setTimeout> | null; clear: () => void }}
 */
function createInactivityTimeout(emitter, opts) {
    return createInactivityTimeoutImpl(emitter, opts);
}

/**
 * Fallback semântico para o caso em que o modelo responde por `assistant.message` em vez de `ask_user("REPLY: ...")`.
 *
 * Isso preserva a política 0-PR: o turno continua sendo resolvido sobre o mesmo `ask_user`/turn em andamento, sem
 * reinicializar o loop ou abrir nova sessão. O fallback só fica elegível depois que o input foi de fato despachado ao
 * host.
 *
 * @param {TurnHost} host
 * @returns {{
 *     markDispatched: () => void;
 *     tryResolve: (
 *         turnStart: number,
 *         resolve: (reply: string) => void,
 *         finalizeReply: (turnStart: number, reply: string) => void,
 *     ) => boolean;
 *     cleanup: () => void;
 * }}
 */
function createAssistantReplyFallback(host) {
    return createAssistantReplyFallbackImpl(host, {
        normalizeAssistantMessageEvent,
        normalizeAssistantReplyCandidate,
        readPendingProtocolSnapshot,
    });
}

/**
 * Emite `turn_start`, incrementa o contador e persiste estado pendente.
 *
 * @param {TurnEmitter} emitter
 * @param {string} message
 * @param {{ sendCount: number }} counter - Objeto mutável com o contador de envios do DLM.
 * @param {TurnHost | null | undefined} [host] - Host opcional para roteamento de persistências assíncronas.
 * @returns {{ turnStart: number }}
 */
export function emitTurnStart(emitter, message, counter, host) {
    const turnStart = Date.now();
    counter.sendCount++;
    emitter.emit(EMITTER_TURN_START, { message: message.slice(0, 120), ts: turnStart });
    const persistPendingTurnTask = persistAgentRuntimePendingTurnState({ message, ts: turnStart }).then((result) => {
        if (!result.ok) {
            const failure = /** @type {import('../../error/index.js').AgentPolicyFailure} */ (result);
            throw failure.error;
        }
        return undefined;
    });
    if (typeof host?.trackBackgroundTask === 'function') {
        void host.trackBackgroundTask(persistPendingTurnTask, {
            label: 'dialog.turn.pending',
            description: 'Persist pending turn marker at turn start',
        });
    } else {
        void persistPendingTurnTask.catch((error) => {
            log('WARN', `[DialogLoopManager] pending turn persist falhou: ${toError(error).message}`);
        });
    }
    return { turnStart };
}

/**
 * Construtor de listeners de resolução de turno (reply/ready/stop).
 *
 * @param {TurnEmitter} emitter
 * @param {any} opts
 * @returns {any}
 */
export function buildTurnResolutionListeners(emitter, opts) {
    return buildTurnResolutionListenersImpl(emitter, {
        ...opts,
        castListener,
        createInactivityTimeout,
        finalizeTurnReply,
        traceLabel,
    });
}

/**
 * Despacha mensagem ao host — gerencia pergunta pendente e listeners internos.
 *
 * @param {TurnEmitter} emitter
 * @param {any} opts
 * @returns {void}
 */
export function dispatchTurnToHost(emitter, opts) {
    return dispatchTurnToHostImpl(emitter, {
        ...opts,
        castListener,
        createInactivityTimeout,
        readPendingProtocolSnapshot,
        traceLabel,
        createAbortError,
        detachAbortListener,
        finalizeTurnReply,
    });
}

/**
 * Aguarda restart (dialog.ready) e reenvia mensagem.
 *
 * @param {TurnEmitter} emitter
 * @param {TurnHost} host
 * @param {string} message
 * @param {number | null} timeout
 * @param {string} [stopReason]
 * @param {AbortSignal} [signal] - F41B.5: AbortSignal para cancelar o restart
 * @returns {Promise<string>}
 */
export function waitForRestartAndReply(emitter, host, message, timeout, stopReason, signal) {
    if (!host) return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
    if (signal?.aborted) {
        return Promise.reject(createAbortError('[DialogLoopManager] restart abortado.'));
    }

    return new Promise((resolve, reject) => {
        /** @type {(() => void) | null} */
        let onRetryPending = null;
        /** @type {((evt: unknown) => void) | null} */
        let onRetryReply = null;
        /** @type {((evt: unknown) => void) | null} */
        let onRetryStopped = null;
        let settled = false;

        const cleanup = () => {
            if (retryTimeout) clearTimeout(retryTimeout);
            emitter.off(EMITTER_LOOP_READY, onRetryReady);
            if (onRetryPending) emitter.off(EMITTER_QUESTION_PENDING, onRetryPending);
            if (onRetryReply) emitter.off(EMITTER_LOOP_REPLY, onRetryReply);
            if (onRetryStopped) emitter.off(EMITTER_LOOP_STOPPED, onRetryStopped);
            detachAbortListener(signal, onAbort);
        };

        /** @param {string} value */
        const settleResolve = (value) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };

        /** @param {Error} error */
        const settleReject = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(toError(error));
        };

        // F41B.5: abort handler — limpa todos os listeners pendentes
        const onAbort = () => {
            settleReject(createAbortError('[DialogLoopManager] restart abortado.'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const retryTimeout =
            timeout === null
                ? null
                : setTimeout(() => {
                      settleReject(
                          new SessionError(
                              `[DialogLoopManager] Timeout aguardando restart após stopped (${stopReason ?? 'unknown'})`,
                              'DIALOG_RESTART_TIMEOUT',
                          ),
                      );
                  }, timeout);

        const onRetryReady = () => {
            onRetryPending = () => {
                host.answerPendingQuestion(message);
                onRetryStopped = (rawEvt) => {
                    if (onRetryReply) {
                        emitter.off(EMITTER_LOOP_REPLY, onRetryReply);
                    }
                    const stoppedEvt = normalizeStopEvent(rawEvt);
                    settleReject(
                        new SessionError(
                            `[DialogLoopManager] stopped durante retry (${stoppedEvt?.reason ?? 'unknown'})`,
                            'DIALOG_STOPPED_DURING_RETRY',
                        ),
                    );
                };
                onRetryReply = (rawEvt) => {
                    const retryEvt = normalizeReplyEvent(rawEvt);
                    settleResolve(retryEvt.reply);
                };
                emitter.once(EMITTER_LOOP_REPLY, onRetryReply);
                emitter.once(EMITTER_LOOP_STOPPED, onRetryStopped);
            };
            if (host.hasPendingQuestion()) {
                onRetryPending();
            } else {
                emitter.once(EMITTER_QUESTION_PENDING, onRetryPending);
            }
        };
        emitter.once('ready', onRetryReady);
    });
}

/**
 * Executa um turno serializado. Orquestra emitTurnStart, buildTurnResolutionListeners e dispatchTurnToHost.
 *
 * @param {TurnEmitter} emitter
 * @param {string} message
 * @param {{ timeout: number | null; signal?: AbortSignal; traceId?: string; allowDirectDispatch?: boolean }} opts
 * @param {{
 *     host: TurnHost;
 *     sendCountRef: { sendCount: number };
 * }} ctx
 * @returns {Promise<string>}
 */
export function executeTurnImpl(emitter, message, { timeout, signal, traceId, allowDirectDispatch = false }, ctx) {
    const { host, sendCountRef } = ctx;

    if (!host) {
        return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
    }
    if (signal?.aborted) {
        return Promise.reject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
    }

    const { turnStart } = emitTurnStart(emitter, message, sendCountRef, host);
    const replyFallback = createAssistantReplyFallback(host);

    /** @param {string} msg @param {number} t @param {string} [r] */
    const waitFn = (msg, t, r) => waitForRestartAndReply(emitter, host, msg, t, r, signal);

    return startSpan(
        'copilot.dialog.send_turn',
        {
            sessionId: host.getSessionId?.() ?? '',
            actor: 'user',
            model: host.getModel?.() ?? '',
            extra: { turnNumber: sendCountRef.sendCount, ...(traceId ? { traceId } : {}) },
        },
        () =>
            new Promise((resolve, reject) => {
                /** @type {{ current: ((arg: unknown) => void) | null }} */
                const pendingListenerRef = { current: null };
                let settled = false;

                /** @param {string} value */
                const settleResolve = (value) => {
                    if (settled) return;
                    settled = true;
                    detachAbortListener(signal, onAbort);
                    replyFallback.cleanup();
                    resolve(value);
                };

                /** @param {Error} error */
                const settleReject = (error) => {
                    if (settled) return;
                    settled = true;
                    detachAbortListener(signal, onAbort);
                    replyFallback.cleanup();
                    reject(error instanceof Error ? error : new Error(String(error)));
                };

                const { timeoutHandle, clearTurnTimeout, onReplyOuter, onReadyOuter, onStopOuter } =
                    buildTurnResolutionListeners(emitter, {
                        host,
                        turnStart,
                        timeout,
                        message,
                        pendingListenerRef,
                        resolve: settleResolve,
                        reject: settleReject,
                        waitForRestartAndReplyFn: waitFn,
                        ...(traceId ? { traceId } : {}),
                        tryUseReplyFallback: () =>
                            replyFallback.tryResolve(turnStart, settleResolve, (replyTurnStart, reply) =>
                                finalizeTurnReply(replyTurnStart, reply, {
                                    emit: (event, payload) => emitter.emit(event, payload),
                                    metrics: container.resolve(METRICS_STORE),
                                }),
                            ),
                    });

                const onAbort = () => {
                    clearTurnTimeout();
                    emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
                    emitter.off(EMITTER_LOOP_READY, onReadyOuter);
                    emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
                    settleReject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
                };

                if (signal) {
                    signal.addEventListener('abort', onAbort, { once: true });
                }

                emitter.once(EMITTER_LOOP_REPLY, onReplyOuter);
                emitter.once(EMITTER_LOOP_READY, onReadyOuter);
                emitter.once(EMITTER_LOOP_STOPPED, onStopOuter);

                dispatchTurnToHost(emitter, {
                    host,
                    message,
                    turnStart,
                    timeout,
                    ...(signal !== undefined && { signal }),
                    timeoutHandle,
                    clearTurnTimeout,
                    pendingListenerRef,
                    onReplyOuter,
                    onReadyOuter,
                    onStopOuter,
                    resolve: settleResolve,
                    reject: settleReject,
                    waitForRestartAndReplyFn: waitFn,
                    allowDirectDispatch,
                    onDispatch: () => replyFallback.markDispatched(),
                    ...(traceId ? { traceId } : {}),
                    tryUseReplyFallback: () =>
                        replyFallback.tryResolve(turnStart, settleResolve, (replyTurnStart, reply) =>
                            finalizeTurnReply(replyTurnStart, reply, {
                                emit: (event, payload) => emitter.emit(event, payload),
                                metrics: container.resolve(METRICS_STORE),
                            }),
                        ),
                });
            }),
    );
}
