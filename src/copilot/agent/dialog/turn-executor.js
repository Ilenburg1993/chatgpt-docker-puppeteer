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
    EMITTER_TURN_END,
    EMITTER_TURN_START,
} from '#copilot/events';
import { log, METRICS_STORE, startSpan } from '#copilot/observability';
import { persistStateWithPolicy } from '../lifecycle/state-io.js';

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
 *     trackBackgroundTask?: (task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>;
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
 * @param {unknown} evt
 * @returns {{ reply: string }}
 */
function normalizeReplyEvent(evt) {
    if (!evt || typeof evt !== 'object') {
        return { reply: '' };
    }
    const reply = Reflect.get(evt, 'reply');
    return { reply: typeof reply === 'string' ? reply : '' };
}

/**
 * @param {unknown} evt
 * @returns {{ authorized?: boolean; reason?: string }}
 */
function normalizeStopEvent(evt) {
    if (!evt || typeof evt !== 'object') {
        return {};
    }
    const authorized = Reflect.get(evt, 'authorized');
    const reason = Reflect.get(evt, 'reason');
    return {
        ...(typeof authorized === 'boolean' ? { authorized } : {}),
        ...(typeof reason === 'string' ? { reason } : {}),
    };
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {() => void} listener
 * @returns {void}
 */
function detachAbortListener(signal, listener) {
    signal?.removeEventListener?.('abort', listener);
}

/**
 * @param {string} message
 * @returns {Error}
 */
function createAbortError(message) {
    if (typeof DOMException === 'function') {
        return new DOMException(message, 'AbortError');
    }
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
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
    const persistPendingTurnTask = persistStateWithPolicy(
        {
            pendingTurnMessage: message,
            pendingTurnTs: turnStart,
            pendingTurnConsumedPR: false,
        },
        { label: 'dialog.turn.pending' },
    ).then((result) => {
        if (!result.ok) {
            const failure = /** @type {import('../error-policy.js').AgentPolicyFailure} */ (result);
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
            log(
                'WARN',
                `[DialogLoopManager] pending turn persist falhou: ${error instanceof Error ? error.message : String(error)}`,
            );
        });
    }
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
 *     reject: (e: Error) => void;
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
 *     signal?: AbortSignal;
 *     timeoutHandle: ReturnType<typeof setTimeout>;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     onReplyOuter: (evt: unknown) => void;
 *     onStopOuter: (evt: unknown) => void;
 *     resolve: (v: string) => void;
 *     reject: (e: Error) => void;
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
        const onPending = () => {
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
            /** @type {(() => void) | null} */
            let onAbortInner = null;
            const onReply = castListener(
                /** @param {{ reply: string }} evt */
                (evt) => {
                    clearTimeout(newTimeout);
                    emitter.off(EMITTER_LOOP_STOPPED, onStop);
                    if (onAbortInner) {
                        detachAbortListener(opts.signal, onAbortInner);
                        onAbortInner = null;
                    }
                    resolve(evt.reply);
                },
            );
            const onStop = castListener(
                /** @param {{ authorized?: boolean; reason?: string }} stopEvt2 */
                (stopEvt2) => {
                    clearTimeout(newTimeout);
                    emitter.off(EMITTER_LOOP_REPLY, onReply);
                    if (onAbortInner) {
                        detachAbortListener(opts.signal, onAbortInner);
                        onAbortInner = null;
                    }
                    if (stopEvt2?.authorized) {
                        reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
                    } else {
                        waitForRestartAndReplyFn(message, timeout, stopEvt2?.reason).then(resolve).catch(reject);
                    }
                },
            );
            if (opts.signal) {
                onAbortInner = () => {
                    clearTimeout(newTimeout);
                    emitter.off(EMITTER_LOOP_REPLY, onReply);
                    emitter.off(EMITTER_LOOP_STOPPED, onStop);
                    reject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
                };
                opts.signal.addEventListener('abort', onAbortInner, { once: true });
            }
            emitter.once(EMITTER_LOOP_REPLY, onReply);
            emitter.once(EMITTER_LOOP_STOPPED, onStop);
            host.answerPendingQuestion(message);
        };
        pendingListenerRef.current = onPending;
        emitter.once(EMITTER_QUESTION_PENDING, onPending);
        if (host.getPendingQuestion()) {
            emitter.off(EMITTER_QUESTION_PENDING, onPending);
            pendingListenerRef.current = null;
            onPending();
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
            clearTimeout(retryTimeout);
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
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        // F41B.5: abort handler — limpa todos os listeners pendentes
        const onAbort = () => {
            settleReject(createAbortError('[DialogLoopManager] restart abortado.'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const retryTimeout = setTimeout(() => {
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
            if (host.getPendingQuestion()) {
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
        return Promise.reject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
    }

    const { turnStart } = emitTurnStart(emitter, message, sendCountRef, host);

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
                let settled = false;

                /** @param {string} value */
                const settleResolve = (value) => {
                    if (settled) return;
                    settled = true;
                    detachAbortListener(signal, onAbort);
                    resolve(value);
                };

                /** @param {Error} error */
                const settleReject = (error) => {
                    if (settled) return;
                    settled = true;
                    detachAbortListener(signal, onAbort);
                    reject(error instanceof Error ? error : new Error(String(error)));
                };

                const { timeoutHandle, onReplyOuter, onStopOuter } = buildTurnResolutionListeners(emitter, {
                    host,
                    turnStart,
                    timeout,
                    message,
                    pendingListenerRef,
                    resolve: settleResolve,
                    reject: settleReject,
                    waitForRestartAndReplyFn: waitFn,
                });

                const onAbort = () => {
                    clearTimeout(timeoutHandle);
                    emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
                    emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
                    settleReject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
                };

                if (signal) {
                    signal.addEventListener('abort', onAbort, { once: true });
                }

                emitter.once(EMITTER_LOOP_REPLY, onReplyOuter);
                emitter.once(EMITTER_LOOP_STOPPED, onStopOuter);

                dispatchTurnToHost(emitter, {
                    host,
                    message,
                    timeout,
                    ...(signal !== undefined && { signal }),
                    timeoutHandle,
                    pendingListenerRef,
                    onReplyOuter,
                    onStopOuter,
                    resolve: settleResolve,
                    reject: settleReject,
                    waitForRestartAndReplyFn: waitFn,
                });
            }),
    );
}
