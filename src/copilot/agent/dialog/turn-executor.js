// @ts-check
/**
 * @module copilot/agent/dialog/turn-executor
 * @file Executor de turno individual: envia mensagem ao SDK, processa resposta, emite eventos de início/fim e trata
 *   erros de sessão por turno.
 *
 *   src/copilot/agent/dialog/turn-executor.js
 * @see EventBus
 */

import { container, SessionError } from '#copilot/core';
import {
    EMITTER_LOOP_READY,
    EMITTER_LOOP_REPLY,
    EMITTER_LOOP_STOPPED,
    EMITTER_QUESTION_PENDING,
    EMITTER_READY,
    EMITTER_TURN_END,
    EMITTER_TURN_START,
} from '#copilot/events';
import { log, METRICS_STORE, startSpan } from '#copilot/observability';
import { writeStateAsync } from '../lifecycle/state-io.js';

/**
 * Subconjunto do EventEmitter necessário para os executores de turno.
 *
 * @typedef {{
 *     on: (event: string, listener: (...args: any[]) => void) => void;
 *     once: (event: string, listener: (...args: any[]) => void) => void;
 *     off: (event: string, listener: (...args: any[]) => void) => void;
 *     emit: (event: string, ...args: any[]) => void;
 * }} TurnEmitter
 */

/**
 * Subconjunto do host necessário pelos executores de turno.
 *
 * @typedef {{
 *     getPendingQuestion: () => unknown;
 *     answerPendingQuestion: (message: string) => boolean;
 *     getSessionId?: () => string | null;
 *     getModel?: () => string;
 * }} TurnHost
 */

/**
 * Cria um listener que aceita `unknown` e faz cast para o tipo esperado.
 *
 * @template T
 * @param {(evt: T) => void} fn
 * @returns {(evt: unknown) => void}
 */
function castListener(fn) {
    return (evt) => fn(/** @type {T} */ (evt));
}

/**
 * Emite `turn_start`, incrementa o contador e persiste estado pendente.
 *
 * @param {TurnEmitter} emitter
 * @param {string} message
 * @param {{ sendCount: number }} counter - Objeto mutável com o contador de envios do DLM.
 * @returns {{ turnStart: number }}
 */
export function emitTurnStart(emitter, message, counter) {
    const turnStart = Date.now();
    counter.sendCount++;
    emitter.emit(EMITTER_TURN_START, { message: message.slice(0, 120), ts: turnStart });
    void writeStateAsync({
        pendingTurnMessage: message,
        pendingTurnTs: turnStart,
        pendingTurnConsumedPR: false,
    });
    return { turnStart };
}

/**
 * Constrói os event handlers principais de resolução/rejeição de um turno.
 *
 * @param {TurnEmitter} emitter
 * @param {{
 *     host: TurnHost;
 *     turnStart: number;
 *     timeout: number;
 *     message: string;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     resolve: (v: string) => void;
 *     reject: (e: unknown) => void;
 *     waitForRestartAndReplyFn: (message: string, timeout: number, stopReason?: string) => Promise<string>;
 * }} opts
 * @returns {{
 *     timeoutHandle: ReturnType<typeof setTimeout>;
 *     onReplyOuter: (evt: unknown) => void;
 *     onStopOuter: (evt: unknown) => void;
 * }}
 */
export function buildTurnResolutionListeners(emitter, opts) {
    const { turnStart, timeout, pendingListenerRef, resolve, reject, waitForRestartAndReplyFn } = opts;

    /**
     * @type {{
     *     reply: (evt: unknown) => void;
     *     stop: (evt: unknown) => void;
     * }}
     */
    const handlers = {
        reply: (_) => {},
        stop: (_) => {},
    };

    const timeoutHandle = setTimeout(() => {
        if (pendingListenerRef.current) {
            emitter.off(EMITTER_QUESTION_PENDING, pendingListenerRef.current);
            pendingListenerRef.current = null;
        }
        reject(new SessionError(`[DialogLoopManager] sendTurn timeout após ${timeout}ms`, 'DIALOG_TIMEOUT'));
    }, timeout);

    handlers.reply = castListener(
        /** @param {{ reply: string }} evt */
        (evt) => {
            clearTimeout(timeoutHandle);
            emitter.off(EMITTER_LOOP_STOPPED, handlers.stop);
            const durationMs = Date.now() - turnStart;
            emitter.emit(EMITTER_TURN_END, { reply: evt.reply.slice(0, 120), durationMs });
            container.resolve(METRICS_STORE).recordDialogTurn(durationMs, true);
            resolve(evt.reply);
        },
    );

    handlers.stop = castListener(
        /** @param {{ authorized?: boolean; reason?: string }} stopEvt */
        (stopEvt) => {
            clearTimeout(timeoutHandle);
            emitter.off(EMITTER_LOOP_REPLY, handlers.reply);
            if (stopEvt?.authorized) {
                reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
            } else {
                log(
                    'INFO',
                    `[DialogLoopManager] Dialog loop parado sem autorização (${stopEvt?.reason ?? 'unknown'}) — aguardando restart automático.`,
                );
                waitForRestartAndReplyFn(opts.message, timeout, stopEvt?.reason).then(resolve).catch(reject);
            }
        },
    );

    return { timeoutHandle, onReplyOuter: handlers.reply, onStopOuter: handlers.stop };
}

/**
 * Despacha a mensagem ao host — responde pergunta pendente ou aguarda `question.pending`.
 *
 * @param {TurnEmitter} emitter
 * @param {{
 *     host: TurnHost;
 *     message: string;
 *     timeout: number;
 *     timeoutHandle: ReturnType<typeof setTimeout>;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     onReplyOuter: (evt: unknown) => void;
 *     onStopOuter: (evt: unknown) => void;
 *     resolve: (v: string) => void;
 *     reject: (e: unknown) => void;
 *     waitForRestartAndReplyFn: (message: string, timeout: number, stopReason?: string) => Promise<string>;
 * }} opts
 */
export function dispatchTurnToHost(emitter, opts) {
    const {
        host,
        message,
        timeout,
        timeoutHandle,
        pendingListenerRef,
        onReplyOuter,
        onStopOuter,
        resolve,
        reject,
        waitForRestartAndReplyFn,
    } = opts;

    if (host.getPendingQuestion()) {
        host.answerPendingQuestion(message);
    } else {
        const onPending = (/** @type {unknown} */ _) => {
            pendingListenerRef.current = null;
            clearTimeout(timeoutHandle);
            // F41B.3: remover os outer listeners registrados por buildTurnResolutionListeners
            // para evitar listener leak / double-fire quando novos listeners são registrados abaixo
            emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
            emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
            const newTimeout = setTimeout(() => {
                emitter.off(EMITTER_LOOP_REPLY, onReply);
                emitter.off(EMITTER_LOOP_STOPPED, onStop);
                reject(new SessionError(`[DialogLoopManager] sendTurn timeout após ${timeout}ms`, 'DIALOG_TIMEOUT'));
            }, timeout);
            const onReply = castListener(
                /** @param {{ reply: string }} evt */
                (evt) => {
                    clearTimeout(newTimeout);
                    emitter.off(EMITTER_LOOP_STOPPED, onStop);
                    resolve(evt.reply);
                },
            );
            const onStop = castListener(
                /** @param {{ authorized?: boolean; reason?: string }} stopEvt2 */
                (stopEvt2) => {
                    clearTimeout(newTimeout);
                    emitter.off(EMITTER_LOOP_REPLY, onReply);
                    if (stopEvt2?.authorized) {
                        reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
                    } else {
                        waitForRestartAndReplyFn(message, timeout, stopEvt2?.reason).then(resolve).catch(reject);
                    }
                },
            );
            emitter.once(EMITTER_LOOP_REPLY, onReply);
            emitter.once(EMITTER_LOOP_STOPPED, onStop);
            host.answerPendingQuestion(message);
        };
        pendingListenerRef.current = onPending;
        emitter.once(EMITTER_QUESTION_PENDING, onPending);
        if (host.getPendingQuestion()) {
            emitter.off(EMITTER_QUESTION_PENDING, onPending);
            pendingListenerRef.current = null;
            onPending(undefined);
        }
    }
}

/**
 * Aguarda restart (dialog.ready) e reenvia mensagem.
 *
 * @param {TurnEmitter} emitter
 * @param {TurnHost} host
 * @param {string} message
 * @param {number} timeout
 * @param {string} [stopReason]
 * @param {AbortSignal} [signal] - F41B.5: AbortSignal para cancelar o restart
 * @returns {Promise<string>}
 */
export function waitForRestartAndReply(emitter, host, message, timeout, stopReason, signal) {
    if (!host) return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
    if (signal?.aborted) {
        return Promise.reject(new DOMException('[DialogLoopManager] restart abortado.', 'AbortError'));
    }

    return new Promise((resolve, reject) => {
        /** @type {(() => void) | null} */
        let onRetryPending = null;
        let settled = false;

        // F41B.5: abort handler — limpa todos os listeners pendentes
        const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(retryTimeout);
            emitter.off(EMITTER_LOOP_READY, onRetryReady);
            if (onRetryPending) emitter.off(EMITTER_QUESTION_PENDING, onRetryPending);
            reject(new DOMException('[DialogLoopManager] restart abortado.', 'AbortError'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const retryTimeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            emitter.off(EMITTER_LOOP_READY, onRetryReady);
            if (onRetryPending) emitter.off(EMITTER_QUESTION_PENDING, onRetryPending);
            reject(
                new SessionError(
                    `[DialogLoopManager] Timeout aguardando restart após stopped (${stopReason ?? 'unknown'})`,
                    'DIALOG_RESTART_TIMEOUT',
                ),
            );
        }, timeout);

        const onRetryReady = () => {
            clearTimeout(retryTimeout);
            onRetryPending = () => {
                host.answerPendingQuestion(message);
                const onRetryStopped = (/** @type {unknown} */ rawEvt) => {
                    const stoppedEvt = /** @type {{ reason?: string }} */ (rawEvt);
                    emitter.off(EMITTER_LOOP_REPLY, onRetryReply);
                    reject(
                        new SessionError(
                            `[DialogLoopManager] stopped durante retry (${stoppedEvt?.reason ?? 'unknown'})`,
                            'DIALOG_STOPPED_DURING_RETRY',
                        ),
                    );
                };
                /** @type {(evt: unknown) => void} */
                const onRetryReply = (rawEvt) => {
                    const retryEvt = /** @type {{ reply: string }} */ (rawEvt);
                    emitter.off(EMITTER_LOOP_STOPPED, onRetryStopped);
                    resolve(retryEvt.reply);
                };
                emitter.once(EMITTER_LOOP_REPLY, onRetryReply);
                emitter.once(EMITTER_LOOP_STOPPED, onRetryStopped);
            };
            if (host.getPendingQuestion()) {
                onRetryPending();
            } else {
                emitter.once(EMITTER_QUESTION_PENDING, onRetryPending);
            }
        };
        emitter.once(EMITTER_READY, onRetryReady);
    });
}

/**
 * Executa um turno serializado. Orquestra emitTurnStart, buildTurnResolutionListeners e dispatchTurnToHost.
 *
 * @param {TurnEmitter} emitter
 * @param {string} message
 * @param {{ timeout: number; signal?: AbortSignal }} opts
 * @param {{
 *     host: TurnHost;
 *     sendCountRef: { sendCount: number };
 * }} ctx
 * @returns {Promise<string>}
 */
export function executeTurnImpl(emitter, message, { timeout, signal }, ctx) {
    const { host, sendCountRef } = ctx;

    if (!host) {
        return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
    }
    if (signal?.aborted) {
        return Promise.reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
    }

    const { turnStart } = emitTurnStart(emitter, message, sendCountRef);

    /** @param {string} msg @param {number} t @param {string} [r] */
    const waitFn = (msg, t, r) => waitForRestartAndReply(emitter, host, msg, t, r, signal);

    return startSpan(
        'copilot.dialog.send_turn',
        {
            sessionId: host.getSessionId?.() ?? '',
            actor: 'user',
            model: host.getModel?.() ?? '',
            extra: { turnNumber: sendCountRef.sendCount },
        },
        () =>
            new Promise((resolve, reject) => {
                /** @type {{ current: ((arg: unknown) => void) | null }} */
                const pendingListenerRef = { current: null };

                const { timeoutHandle, onReplyOuter, onStopOuter } = buildTurnResolutionListeners(emitter, {
                    host,
                    turnStart,
                    timeout,
                    message,
                    pendingListenerRef,
                    resolve,
                    reject,
                    waitForRestartAndReplyFn: waitFn,
                });

                if (signal) {
                    signal.addEventListener(
                        'abort',
                        () => {
                            clearTimeout(timeoutHandle);
                            emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
                            emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
                            reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
                        },
                        { once: true },
                    );
                }

                emitter.once(EMITTER_LOOP_REPLY, onReplyOuter);
                emitter.once(EMITTER_LOOP_STOPPED, onStopOuter);

                dispatchTurnToHost(emitter, {
                    host,
                    message,
                    timeout,
                    timeoutHandle,
                    pendingListenerRef,
                    onReplyOuter,
                    onStopOuter,
                    resolve,
                    reject,
                    waitForRestartAndReplyFn: waitFn,
                });
            }),
    );
}
