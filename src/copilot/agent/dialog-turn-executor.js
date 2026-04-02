// @ts-check
/**
 * src/copilot/agent/dialog-turn-executor.js
 *
 * Funções puras de execução de turno extraídas do `DialogLoopManager`.
 *
 * Contém a lógica de resolução/rejeição de cada turno do dialog loop:
 *
 * - emitTurnStart
 * - buildTurnResolutionListeners
 * - dispatchTurnToHost
 * - waitForRestartAndReply
 * - executeTurn (orquestra os anteriores)
 *
 * Cada função recebe um objeto `emitter` (com `.on/.once/.off/.emit`) e os callbacks/deps necessários — sem acesso a
 * campos privados do DLM.
 *
 * @module copilot/agent/dialog-turn-executor
 */

import { SessionError } from '#copilot/core/errors';
import { recordToolCall, startSpan } from '#copilot/lib/index';
import { log } from '#core/logger';
import { writeStateAsync } from './state-io.js';

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
    emitter.emit('turn_start', { message: message.slice(0, 120), ts: turnStart });
    writeStateAsync({
        pendingTurnMessage: message,
        pendingTurnTs: turnStart,
        pendingTurnConsumedPR: false,
    }).catch((/** @type {any} */ e) => log('WARN', `[DialogLoopManager] writeState pendingTurn: ${e.message}`));
    return { turnStart };
}

/**
 * Constrói os event handlers principais de resolução/rejeição de um turno.
 *
 * @param {TurnEmitter} emitter
 * @param {{
 *     host: any;
 *     telemetry: any;
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
 *     onReplyOuter: (evt: { reply: string }) => void;
 *     onStopOuter: (evt: { authorized?: boolean; reason?: string }) => void;
 * }}
 */
export function buildTurnResolutionListeners(emitter, opts) {
    const { host, telemetry, turnStart, timeout, pendingListenerRef, resolve, reject, waitForRestartAndReplyFn } = opts;

    /** @type {{
    reply: (evt: { reply: string }) => void;
    stop: (evt: { authorized?: boolean; reason?: string }) => void;
}} */
    const handlers = {
        reply: (_) => {},
        stop: (_) => {},
    };

    const timeoutHandle = setTimeout(() => {
        if (pendingListenerRef.current) {
            emitter.off('question.pending', pendingListenerRef.current);
            pendingListenerRef.current = null;
        }
        reject(new SessionError(`[DialogLoopManager] sendTurn timeout após ${timeout}ms`, 'DIALOG_TIMEOUT'));
    }, timeout);

    handlers.reply = (/** @type {{ reply: string }} */ evt) => {
        clearTimeout(timeoutHandle);
        emitter.off('stopped', handlers.stop);
        const durationMs = Date.now() - turnStart;
        emitter.emit('turn_end', { reply: evt.reply.slice(0, 120), durationMs });
        recordToolCall(telemetry, 'dialog.turn', {
            durationMs,
            success: true,
            sessionId: host.getSessionId() ?? undefined,
        });
        resolve(evt.reply);
    };

    handlers.stop = (/** @type {{ authorized?: boolean; reason?: string }} */ stopEvt) => {
        clearTimeout(timeoutHandle);
        emitter.off('reply', handlers.reply);
        if (stopEvt?.authorized) {
            reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
        } else {
            log(
                'INFO',
                `[DialogLoopManager] Dialog loop parado sem autorização (${stopEvt?.reason ?? 'unknown'}) — aguardando restart automático.`,
            );
            waitForRestartAndReplyFn(opts.message, timeout, stopEvt?.reason).then(resolve).catch(reject);
        }
    };

    return { timeoutHandle, onReplyOuter: handlers.reply, onStopOuter: handlers.stop };
}

/**
 * Despacha a mensagem ao host — responde pergunta pendente ou aguarda `question.pending`.
 *
 * @param {TurnEmitter} emitter
 * @param {{
 *     host: any;
 *     message: string;
 *     timeout: number;
 *     timeoutHandle: ReturnType<typeof setTimeout>;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     resolve: (v: string) => void;
 *     reject: (e: unknown) => void;
 *     waitForRestartAndReplyFn: (message: string, timeout: number, stopReason?: string) => Promise<string>;
 * }} opts
 */
export function dispatchTurnToHost(emitter, opts) {
    const { host, message, timeout, timeoutHandle, pendingListenerRef, resolve, reject, waitForRestartAndReplyFn } =
        opts;

    if (host.getPendingQuestion()) {
        host.answerPendingQuestion(message);
    } else {
        const onPending = (/** @type {unknown} */ _) => {
            pendingListenerRef.current = null;
            clearTimeout(timeoutHandle);
            const newTimeout = setTimeout(() => {
                emitter.off('reply', onReply);
                emitter.off('stopped', onStop);
                reject(new SessionError(`[DialogLoopManager] sendTurn timeout após ${timeout}ms`, 'DIALOG_TIMEOUT'));
            }, timeout);
            const onReply = (/** @type {{ reply: string }} */ evt) => {
                clearTimeout(newTimeout);
                emitter.off('stopped', onStop);
                resolve(evt.reply);
            };
            const onStop = (/** @type {{ authorized?: boolean; reason?: string }} */ stopEvt2) => {
                clearTimeout(newTimeout);
                emitter.off('reply', onReply);
                if (stopEvt2?.authorized) {
                    reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
                } else {
                    waitForRestartAndReplyFn(message, timeout, stopEvt2?.reason).then(resolve).catch(reject);
                }
            };
            emitter.once('reply', onReply);
            emitter.once('stopped', onStop);
            host.answerPendingQuestion(message);
        };
        pendingListenerRef.current = onPending;
        emitter.once('question.pending', onPending);
        if (host.getPendingQuestion()) {
            emitter.off('question.pending', onPending);
            pendingListenerRef.current = null;
            onPending(undefined);
        }
    }
}

/**
 * Aguarda restart (dialog.ready) e reenvia mensagem.
 *
 * @param {TurnEmitter} emitter
 * @param {any} host
 * @param {string} message
 * @param {number} timeout
 * @param {string} [stopReason]
 * @returns {Promise<string>}
 */
export function waitForRestartAndReply(emitter, host, message, timeout, stopReason) {
    if (!host) return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));

    return new Promise((resolve, reject) => {
        // G2-ARCH-04: declarar onRetryPending no escopo da Promise para poder removê-la no timeout
        /** @type {(() => void) | null} */
        let onRetryPending = null;

        const retryTimeout = setTimeout(() => {
            emitter.off('ready', onRetryReady);
            // G2-ARCH-04: limpar listener 'question.pending' se ainda pendente
            if (onRetryPending) emitter.off('question.pending', onRetryPending);
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
                const onRetryStopped = (/** @type {{ reason?: string }} */ stoppedEvt) => {
                    emitter.off('reply', onRetryReply);
                    reject(
                        new SessionError(
                            `[DialogLoopManager] stopped durante retry (${stoppedEvt?.reason ?? 'unknown'})`,
                            'DIALOG_STOPPED_DURING_RETRY',
                        ),
                    );
                };
                /** @type {(evt: { reply: string }) => void} */
                const onRetryReply = (retryEvt) => {
                    emitter.off('stopped', onRetryStopped);
                    resolve(retryEvt.reply);
                };
                emitter.once('reply', onRetryReply);
                emitter.once('stopped', onRetryStopped);
            };
            if (host.getPendingQuestion()) {
                onRetryPending();
            } else {
                emitter.once('question.pending', onRetryPending);
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
 *     host: any;
 *     telemetry: any;
 *     sendCountRef: { sendCount: number };
 * }} ctx
 * @returns {Promise<string>}
 */
export function executeTurnImpl(emitter, message, { timeout, signal }, ctx) {
    const { host, telemetry, sendCountRef } = ctx;

    if (!host || !telemetry) {
        return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
    }
    if (signal?.aborted) {
        return Promise.reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
    }

    const { turnStart } = emitTurnStart(emitter, message, sendCountRef);

    /** @param {string} msg @param {number} t @param {string} [r] */
    const waitFn = (msg, t, r) => waitForRestartAndReply(emitter, host, msg, t, r);

    return startSpan(
        'dialog.send_turn',
        {
            sessionId: host.getSessionId() ?? '',
            actor: 'user',
            model: host.getModel(),
            extra: { turnNumber: sendCountRef.sendCount },
        },
        () =>
            new Promise((resolve, reject) => {
                /** @type {{ current: ((arg: unknown) => void) | null }} */
                const pendingListenerRef = { current: null };

                const { timeoutHandle, onReplyOuter, onStopOuter } = buildTurnResolutionListeners(emitter, {
                    host,
                    telemetry,
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
                            emitter.off('reply', onReplyOuter);
                            emitter.off('stopped', onStopOuter);
                            reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
                        },
                        { once: true },
                    );
                }

                emitter.once('reply', onReplyOuter);
                emitter.once('stopped', onStopOuter);

                dispatchTurnToHost(emitter, {
                    host,
                    message,
                    timeout,
                    timeoutHandle,
                    pendingListenerRef,
                    resolve,
                    reject,
                    waitForRestartAndReplyFn: waitFn,
                });
            }),
    );
}
