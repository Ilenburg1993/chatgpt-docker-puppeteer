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
import { persistAgentRuntimePendingTurnState } from '../../facades/agent-runtime-state.js';
import { log } from '../../ports/logging/index.js';
import { METRICS_STORE } from '../../ports/metrics-port.js';
import { startSpan } from '../../ports/tracing-port.js';
import {
    buildTurnResolutionListenersImpl,
    castListener as castListenerImpl,
    createAbortError as createAbortErrorImpl,
    createDialogTurnOutputCollector as createDialogTurnOutputCollectorImpl,
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
 * Resultado semântico canônico de um turno explícito do dialog loop.
 *
 * APIs legadas ainda podem projetar apenas `reply`; consumidores que precisam explicar o turno devem usar este
 * contrato, sem reconstituir semântica a partir de eventos concorrentes.
 *
 * @typedef {{
 *     reply: string;
 *     outcome: 'public_reply' | 'pending_human_input' | 'tool_only' | 'protocol_transition' | 'empty';
 *     replySource:
 *         | 'loop.reply'
 *         | 'assistant.message'
 *         | 'delta'
 *         | 'pending_protocol'
 *         | 'direct_dispatch'
 *         | 'unknown';
 *     diagnostics: {
 *         dispatched: boolean;
 *         assistantMessageCount: number;
 *         deltaChars: number;
 *         deltaEligible: boolean;
 *         pendingProtocolKind: 'reply' | 'ready' | 'stopped' | null;
 *         pendingHumanInput: boolean;
 *         toolSignalCount: number;
 *         lastDeltaSeq: number;
 *         lastToolSignalSeq: number;
 *     };
 * }} DialogTurnSemanticResult
 */

/**
 * @param {string} reply
 * @param {string | null | undefined} replySource
 * @param {ReturnType<typeof createDialogTurnOutputCollector>} collector
 * @param {TurnHost} host
 * @returns {DialogTurnSemanticResult}
 */
function buildDialogTurnSemanticResult(reply, replySource, collector, host) {
    const snapshot = collector.snapshot();
    const publicReply = typeof reply === 'string' && reply.trim().length > 0;
    const pendingQuestion = host.getPendingQuestionSnapshot?.() ?? null;
    const pendingHumanInput = pendingQuestion?.kind === 'question' && pendingQuestion.protocolControlled !== true;
    const outcome = publicReply
        ? 'public_reply'
        : pendingHumanInput
          ? 'pending_human_input'
          : snapshot.toolSignalCount > 0
            ? 'tool_only'
            : snapshot.pendingProtocolKind === 'ready' || snapshot.pendingProtocolKind === 'stopped'
              ? 'protocol_transition'
              : 'empty';
    const semanticSource =
        replySource === 'loop.reply' ||
        replySource === 'assistant.message' ||
        replySource === 'delta' ||
        replySource === 'pending_protocol' ||
        replySource === 'direct_dispatch'
            ? replySource
            : 'unknown';
    return {
        reply,
        outcome,
        replySource: semanticSource,
        diagnostics: {
            dispatched: snapshot.dispatched,
            assistantMessageCount: snapshot.assistantMessageCount,
            deltaChars: snapshot.deltaChars,
            deltaEligible: snapshot.deltaEligible,
            pendingProtocolKind: snapshot.pendingProtocolKind,
            pendingHumanInput,
            toolSignalCount: snapshot.toolSignalCount,
            lastDeltaSeq: snapshot.lastDeltaSeq,
            lastToolSignalSeq: snapshot.lastToolSignalSeq,
        },
    };
}

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
 * Collector canônico do output semântico do turno explícito.
 *
 * Este collector é o owner único da resolução semântica do reply do turno explícito no runtime. `channel/` e
 * `terminal/` não devem reinterpretar `assistant.message`/deltas para decidir o reply final.
 *
 * @param {TurnHost} host
 * @returns {ReturnType<typeof createDialogTurnOutputCollectorImpl>}
 */
function createDialogTurnOutputCollector(host) {
    return createDialogTurnOutputCollectorImpl(host, {
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
 * @returns {Promise<DialogTurnSemanticResult>}
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
    const turnOutputCollector = createDialogTurnOutputCollector(host);

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
                /** @type {(() => void) | null} */
                let removeTurnEndAutoResolve = null;
                /** @type {(() => void) | null} */
                let removeAssistantMessageAutoResolve = null;

                /**
                 * @param {string} value
                 * @param {string | null | undefined} [replySource]
                 */
                const settleResolve = (value, replySource) => {
                    if (settled) return;
                    settled = true;
                    const result = buildDialogTurnSemanticResult(value, replySource, turnOutputCollector, host);
                    detachAbortListener(signal, onAbort);
                    removeTurnEndAutoResolve?.();
                    removeAssistantMessageAutoResolve?.();
                    turnOutputCollector.cleanup();
                    resolve(result);
                };

                /** @param {Error} error */
                const settleReject = (error) => {
                    if (settled) return;
                    settled = true;
                    detachAbortListener(signal, onAbort);
                    removeTurnEndAutoResolve?.();
                    removeAssistantMessageAutoResolve?.();
                    turnOutputCollector.cleanup();
                    reject(error instanceof Error ? error : new Error(String(error)));
                };

                const { timeoutHandle, clearTurnTimeout, onReplyOuter, onReadyOuter, onStopOuter } =
                    buildTurnResolutionListeners(emitter, {
                        host,
                        turnStart,
                        timeout,
                        message,
                        pendingListenerRef,
                        resolve: (/** @type {string} */ reply) => settleResolve(reply, 'loop.reply'),
                        reject: settleReject,
                        waitForRestartAndReplyFn: waitFn,
                        ...(traceId ? { traceId } : {}),
                        tryUseReplyFallback: tryResolveReplyFallback,
                    });

                const clearOuterLoopListeners = () => {
                    emitter.off(EMITTER_LOOP_REPLY, onReplyOuter);
                    emitter.off(EMITTER_LOOP_READY, onReadyOuter);
                    emitter.off(EMITTER_LOOP_STOPPED, onStopOuter);
                };

                function tryResolveReplyFallback() {
                    return turnOutputCollector.tryResolve(
                        turnStart,
                        (reply) => {
                            clearTurnTimeout();
                            clearOuterLoopListeners();
                            settleResolve(reply, turnOutputCollector.snapshot().lastResolutionSource);
                        },
                        (replyTurnStart, reply) =>
                            finalizeTurnReply(replyTurnStart, reply, {
                                emit: (event, payload) => emitter.emit(event, payload),
                                metrics: container.resolve(METRICS_STORE),
                            }),
                    );
                }

                removeAssistantMessageAutoResolve = turnOutputCollector.onAssistantMessageCandidate(() => {
                    if (settled) return;
                    void turnOutputCollector.tryResolve(
                        turnStart,
                        (reply) => {
                            clearTurnTimeout();
                            clearOuterLoopListeners();
                            settleResolve(reply, turnOutputCollector.snapshot().lastResolutionSource);
                        },
                        (replyTurnStart, reply) =>
                            finalizeTurnReply(replyTurnStart, reply, {
                                emit: (event, payload) => emitter.emit(event, payload),
                                metrics: container.resolve(METRICS_STORE),
                            }),
                        { allowDeltaFallback: false },
                    );
                });

                removeTurnEndAutoResolve = turnOutputCollector.onTurnEnd(() => {
                    if (settled) return;
                    void tryResolveReplyFallback();
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
                    resolve: (/** @type {string} */ reply) => settleResolve(reply, 'direct_dispatch'),
                    reject: settleReject,
                    waitForRestartAndReplyFn: waitFn,
                    allowDirectDispatch,
                    onDispatch: () => turnOutputCollector.markDispatched(),
                    ...(traceId ? { traceId } : {}),
                    tryUseReplyFallback: tryResolveReplyFallback,
                });
            }),
    );
}
