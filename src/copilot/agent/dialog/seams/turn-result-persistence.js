// @ts-check
/**
 * @module copilot/agent/dialog/seams/turn-result-persistence
 * @file K86.7.3: Seam de construção de listeners e despacho de turno.
 *
 *   Isola os handlers de resolução de turno (reply/ready/stop) e lógica de despacho.
 * @internal K86.7.3
 */

import { SessionError, container } from '#copilot/core';
import {
    EMITTER_LOOP_READY,
    EMITTER_LOOP_REPLY,
    EMITTER_LOOP_STOPPED,
    EMITTER_QUESTION_PENDING,
} from '#copilot/events';
import { log } from '../../ports/index.js';
import { METRICS_STORE } from '../../ports/index.js';

/**
 * Constrói os event handlers principais de resolução/rejeição de um turno.
 *
 * @param {any} emitter
 * @param {{
 *     host: any;
 *     turnStart: number;
 *     timeout: number | null;
 *     message: string;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     resolve: (v: string) => void;
 *     reject: (e: Error) => void;
 *     waitForRestartAndReplyFn: (message: string, timeout: number | null, stopReason?: string) => Promise<string>;
 *     tryUseReplyFallback?: () => boolean;
 *     traceId?: string;
 *     castListener: (fn: (evt: any) => void) => (evt: unknown) => void;
 *     createInactivityTimeout: (emitter: any, opts: any) => { timeoutHandle: any; clear: () => void };
 *     finalizeTurnReply: (turnStart: number, reply: string, input: any) => void;
 *     traceLabel: (traceId?: string) => string;
 * }} opts
 * @returns {{
 *     timeoutHandle: any;
 *     clearTurnTimeout: () => void;
 *     onReplyOuter: (evt: unknown) => void;
 *     onReadyOuter: (evt: unknown) => void;
 *     onStopOuter: (evt: unknown) => void;
 * }}
 */
export function buildTurnResolutionListenersImpl(emitter, opts) {
    const {
        turnStart,
        timeout,
        pendingListenerRef,
        resolve,
        reject,
        waitForRestartAndReplyFn,
        tryUseReplyFallback,
        traceId,
        castListener,
        createInactivityTimeout,
        finalizeTurnReply,
        traceLabel,
    } = opts;

    /** @type {{ reply: (evt: unknown) => void; ready: (evt: unknown) => void; stop: (evt: unknown) => void }} */
    const handlers = { reply: () => {}, ready: () => {}, stop: () => {} };

    const turnTimeout = createInactivityTimeout(emitter, {
        timeout,
        progressSources: [opts.host],
        ...(traceId ? { traceId } : {}),
        phase: 'outer',
        onTimeout: () => {
            if (pendingListenerRef.current) {
                emitter.off(EMITTER_QUESTION_PENDING, pendingListenerRef.current);
                pendingListenerRef.current = null;
            }
            emitter.off(EMITTER_LOOP_REPLY, handlers.reply);
            emitter.off(EMITTER_LOOP_READY, handlers.ready);
            emitter.off(EMITTER_LOOP_STOPPED, handlers.stop);
            if (tryUseReplyFallback?.()) {
                return;
            }
            log(
                'WARN',
                `[DialogLoopManager] sendTurn inactivity timeout (${traceLabel(traceId)}, timeout=${timeout}ms)`,
            );
            reject(new SessionError(`[DialogLoopManager] sendTurn sem progresso por ${timeout}ms`, 'DIALOG_TIMEOUT'));
        },
    });

    handlers.reply = castListener((evt) => {
        turnTimeout.clear();
        emitter.off(EMITTER_LOOP_READY, handlers.ready);
        emitter.off(EMITTER_LOOP_STOPPED, handlers.stop);
        log('INFO', `[DialogLoopManager] reply resolved (${traceLabel(traceId)}, source=loop.reply)`);
        finalizeTurnReply(turnStart, evt.reply, {
            emit: (/** @type {string} */ event, /** @type {object} */ payload) => emitter.emit(event, payload),
            metrics: container.resolve(METRICS_STORE),
        });
        resolve(evt.reply);
    });

    handlers.ready = castListener(() => {
        if (!tryUseReplyFallback?.()) {
            return;
        }
        turnTimeout.clear();
        emitter.off(EMITTER_LOOP_REPLY, handlers.reply);
        emitter.off(EMITTER_LOOP_STOPPED, handlers.stop);
        log('INFO', `[DialogLoopManager] reply resolved (${traceLabel(traceId)}, source=loop.ready_fallback)`);
    });

    handlers.stop = castListener((stopEvt) => {
        turnTimeout.clear();
        emitter.off(EMITTER_LOOP_REPLY, handlers.reply);
        emitter.off(EMITTER_LOOP_READY, handlers.ready);
        if (stopEvt?.authorized) {
            reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
        } else {
            log(
                'INFO',
                `[DialogLoopManager] loop stopped, waiting restart (${traceLabel(traceId)}, reason=${stopEvt?.reason ?? 'unknown'})`,
            );
            log(
                'INFO',
                `[DialogLoopManager] Dialog loop parado sem autorização (${stopEvt?.reason ?? 'unknown'}) — aguardando restart automático.`,
            );
            waitForRestartAndReplyFn(opts.message, timeout, stopEvt?.reason).then(resolve).catch(reject);
        }
    });

    return {
        timeoutHandle: turnTimeout.timeoutHandle,
        clearTurnTimeout: turnTimeout.clear,
        onReplyOuter: handlers.reply,
        onReadyOuter: handlers.ready,
        onStopOuter: handlers.stop,
    };
}

/**
 * Despacha a mensagem ao host — responde pergunta pendente ou aguarda `question.pending`.
 *
 * @param {any} emitter
 * @param {{
 *     host: any;
 *     message: string;
 *     turnStart: number;
 *     timeout: number | null;
 *     signal?: AbortSignal;
 *     timeoutHandle: any;
 *     clearTurnTimeout?: () => void;
 *     pendingListenerRef: { current: ((arg: unknown) => void) | null };
 *     onReplyOuter: (evt: unknown) => void;
 *     onReadyOuter: (evt: unknown) => void;
 *     onStopOuter: (evt: unknown) => void;
 *     resolve: (v: string) => void;
 *     reject: (e: Error) => void;
 *     waitForRestartAndReplyFn: (message: string, timeout: number | null, stopReason?: string) => Promise<string>;
 *     allowDirectDispatch?: boolean;
 *     onDispatch?: () => void;
 *     tryUseReplyFallback?: () => boolean;
 *     traceId?: string;
 *     castListener: (fn: (evt: any) => void) => (evt: unknown) => void;
 *     createInactivityTimeout: (emitter: any, opts: any) => { timeoutHandle: any; clear: () => void };
 *     readPendingProtocolSnapshot: (host: any) => any;
 *     traceLabel: (traceId?: string) => string;
 *     createAbortError: (message: string) => Error;
 *     detachAbortListener: (signal?: AbortSignal, listener?: () => void) => void;
 *     finalizeTurnReply?: (turnStart: number, reply: string, input: any) => void;
 * }} opts
 * @returns {void}
 */
export function dispatchTurnToHostImpl(emitter, opts) {
    const {
        host,
        message,
        turnStart,
        timeout,
        timeoutHandle,
        clearTurnTimeout,
        pendingListenerRef,
        onReplyOuter,
        onReadyOuter = () => {},
        onStopOuter,
        resolve,
        reject,
        waitForRestartAndReplyFn,
        allowDirectDispatch = false,
        onDispatch,
        tryUseReplyFallback,
        traceId,
        castListener,
        createInactivityTimeout,
        readPendingProtocolSnapshot,
        traceLabel,
        createAbortError,
        detachAbortListener,
        finalizeTurnReply,
    } = opts;

    if (host.hasPendingQuestion()) {
        const pendingProtocol = readPendingProtocolSnapshot(host);
        if (pendingProtocol?.kind === 'reply' && pendingProtocol.reply) {
            log(
                'INFO',
                `[DialogLoopManager] pending protocol shortcut (${traceLabel(traceId)}, kind=reply, source=pending-question)`,
            );
            onReplyOuter({ reply: pendingProtocol.reply });
            return;
        }
        if (pendingProtocol?.kind === 'stopped') {
            log(
                'WARN',
                `[DialogLoopManager] pending protocol shortcut (${traceLabel(traceId)}, kind=stopped, source=pending-question)`,
            );
            // FIX P0-1: emitir authorized=true para 'pending_protocol_stopped' para evitar hang indefinido
            // 'pending_protocol_stopped' é um encerramento deliberado do loop, não um erro/falha
            onStopOuter({ authorized: true, reason: 'pending_protocol_stopped' });
            return;
        }
        log('INFO', `[DialogLoopManager] dispatching turn to pending question (${traceLabel(traceId)})`);
        onDispatch?.();
        host.answerPendingQuestion(message);
    } else if (allowDirectDispatch && typeof host.sendMessageDialogBoot === 'function') {
        log('INFO', `[DialogLoopManager] dispatching direct resumed turn (${traceLabel(traceId)})`);
        onDispatch?.();
        Promise.resolve(host.sendMessageDialogBoot(message, { timeoutMs: timeout })).then(
            (reply) => {
                if (typeof reply === 'string') {
                    if (clearTurnTimeout) {
                        clearTurnTimeout();
                    } else {
                        clearTimeout(timeoutHandle ?? undefined);
                    }
                    emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
                    if (onReadyOuter) {
                        emitter.off(EMITTER_LOOP_READY, onReadyOuter);
                    }
                    emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
                    finalizeTurnReply?.(turnStart, reply, {
                        emit: (/** @type {string} */ event, /** @type {object} */ payload) =>
                            emitter.emit(event, payload),
                        metrics: container.resolve(METRICS_STORE),
                    });
                    resolve(reply);
                }
            },
            (error) => {
                if (tryUseReplyFallback?.()) {
                    return;
                }
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    } else {
        const onPending = () => {
            pendingListenerRef.current = null;
            const pendingProtocol = readPendingProtocolSnapshot(host);
            if (pendingProtocol?.kind === 'reply' && pendingProtocol.reply) {
                log(
                    'INFO',
                    `[DialogLoopManager] pending protocol shortcut after question.pending (${traceLabel(traceId)}, kind=reply)`,
                );
                onReplyOuter({ reply: pendingProtocol.reply });
                return;
            }
            if (pendingProtocol?.kind === 'stopped') {
                log(
                    'WARN',
                    `[DialogLoopManager] pending protocol shortcut after question.pending (${traceLabel(traceId)}, kind=stopped)`,
                );
                // FIX P0-1: emitir authorized=true para 'pending_protocol_stopped' para evitar hang indefinido
                onStopOuter({ authorized: true, reason: 'pending_protocol_stopped' });
                return;
            }
            if (clearTurnTimeout) {
                clearTurnTimeout();
            } else {
                clearTimeout(timeoutHandle ?? undefined);
            }
            emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
            if (onReadyOuter) {
                emitter.off(EMITTER_LOOP_READY, onReadyOuter);
            }
            emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
            const innerTimeout = createInactivityTimeout(emitter, {
                timeout,
                progressSources: [host],
                ...(traceId ? { traceId } : {}),
                phase: 'pending',
                onTimeout: () => {
                    emitter.off(EMITTER_LOOP_REPLY, onReply);
                    emitter.off(EMITTER_LOOP_READY, onReady);
                    emitter.off(EMITTER_LOOP_STOPPED, onStop);
                    if (tryUseReplyFallback?.()) {
                        return;
                    }
                    log(
                        'WARN',
                        `[DialogLoopManager] sendTurn inactivity timeout after question.pending (${traceLabel(traceId)}, timeout=${timeout}ms)`,
                    );
                    reject(
                        new SessionError(
                            `[DialogLoopManager] sendTurn sem progresso por ${timeout}ms`,
                            'DIALOG_TIMEOUT',
                        ),
                    );
                },
            });
            /** @type {(() => void) | null} */
            let onAbortInner = null;
            const onReply = castListener((evt) => {
                innerTimeout.clear();
                emitter.off(EMITTER_LOOP_READY, onReady);
                emitter.off(EMITTER_LOOP_STOPPED, onStop);
                if (onAbortInner) {
                    detachAbortListener(opts.signal, onAbortInner);
                    onAbortInner = null;
                }
                finalizeTurnReply?.(turnStart, evt.reply, {
                    emit: (/** @type {string} */ event, /** @type {object} */ payload) => emitter.emit(event, payload),
                    metrics: container.resolve(METRICS_STORE),
                });
                resolve(evt.reply);
            });
            const onReady = castListener(() => {
                if (!tryUseReplyFallback?.()) {
                    return;
                }
                innerTimeout.clear();
                emitter.off(EMITTER_LOOP_REPLY, onReply);
                emitter.off(EMITTER_LOOP_STOPPED, onStop);
                if (onAbortInner) {
                    detachAbortListener(opts.signal, onAbortInner);
                    onAbortInner = null;
                }
            });
            const onStop = castListener((stopEvt2) => {
                innerTimeout.clear();
                emitter.off(EMITTER_LOOP_REPLY, onReply);
                emitter.off(EMITTER_LOOP_READY, onReady);
                if (onAbortInner) {
                    detachAbortListener(opts.signal, onAbortInner);
                    onAbortInner = null;
                }
                if (stopEvt2?.authorized) {
                    reject(new SessionError('[DialogLoopManager] Diálogo encerrado.', 'DIALOG_ENDED'));
                } else {
                    waitForRestartAndReplyFn(message, timeout, stopEvt2?.reason).then(resolve).catch(reject);
                }
            });
            if (opts.signal) {
                onAbortInner = () => {
                    innerTimeout.clear();
                    emitter.off(EMITTER_LOOP_REPLY, onReply);
                    emitter.off(EMITTER_LOOP_READY, onReady);
                    emitter.off(EMITTER_LOOP_STOPPED, onStop);
                    reject(createAbortError('[DialogLoopManager] sendTurn abortado.'));
                };
                opts.signal.addEventListener('abort', onAbortInner, { once: true });
            }
            emitter.once(EMITTER_LOOP_REPLY, onReply);
            emitter.once(EMITTER_LOOP_READY, onReady);
            emitter.once(EMITTER_LOOP_STOPPED, onStop);
            log('INFO', `[DialogLoopManager] dispatching turn after question.pending (${traceLabel(traceId)})`);
            onDispatch?.();
            host.answerPendingQuestion(message);
        };
        pendingListenerRef.current = onPending;
        emitter.once(EMITTER_QUESTION_PENDING, onPending);
        if (host.hasPendingQuestion()) {
            emitter.off(EMITTER_QUESTION_PENDING, onPending);
            pendingListenerRef.current = null;
            onPending();
        }
    }
}
