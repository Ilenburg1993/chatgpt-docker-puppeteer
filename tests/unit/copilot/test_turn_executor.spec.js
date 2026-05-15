// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks ── */
vi.mock('#copilot/core/errors', () => {
    class SessionError extends Error {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg);
            this.code = code;
            this.name = 'SessionError';
        }
    }
    class CopilotError extends Error {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg);
            this.code = code;
            this.name = 'CopilotError';
        }
    }
    return { SessionError, CopilotError };
});

vi.mock('#copilot/core', async (importOriginal) => {
    class SessionError extends Error {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg);
            this.code = code;
            this.name = 'SessionError';
        }
    }
    return {
        ...(await importOriginal()),
        SessionError,
        container: {
            resolve: vi.fn(() => ({ recordDialogTurn: vi.fn() })),
        },
    };
});

vi.mock('#copilot/observability', () => ({
    METRICS_STORE: Symbol('METRICS_STORE_TEST'),
    defaultMetrics: { recordDialogTurn: vi.fn() },
    log: vi.fn(),
    startSpan: vi.fn((_name, _attrs, fn) => fn()),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/observability/otel', () => ({
    startSpan: vi.fn((_name, _attrs, fn) => fn()),
}));

vi.mock('../../../src/copilot/agent/facades/agent-runtime-state.js', () => ({
    persistAgentRuntimePendingTurnState: vi.fn(async () => ({ ok: true, value: /** @type {any} */ ({}) })),
}));

/* ── SUT ── */
import {
    buildTurnResolutionListeners,
    dispatchTurnToHost,
    emitTurnStart,
    executeTurnImpl,
    waitForRestartAndReply,
} from '../../../src/copilot/agent/dialog/executors/turn-executor.js';
import { persistAgentRuntimePendingTurnState } from '../../../src/copilot/agent/facades/agent-runtime-state.js';

/* ── helpers ── */

import { EventEmitter } from 'events';

/**
 * Cria emitter mínimo compatível com TurnEmitter.
 */
function makeEmitter() {
    return new EventEmitter();
}

/**
 * Cria um host mínimo compatível com TurnHost.
 *
 * @param {Partial<import('../../../src/copilot/agent/dialog/executors/turn-executor.js').TurnHost>} [overrides]
 */
function makeTurnHost(overrides = {}) {
    return {
        hasPendingQuestion: vi.fn(() => false),
        answerPendingQuestion: vi.fn(() => false),
        ...overrides,
    };
}

/**
 * Espera micro-task (garante que listeners foram processados).
 */
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ─────────────────────────── Tests ─────────────────────────── */

describe('turn-executor', () => {
    /** @type {EventEmitter} */
    let emitter;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        emitter = makeEmitter();
        vi.mocked(persistAgentRuntimePendingTurnState).mockResolvedValue({ ok: true, value: /** @type {any} */ ({}) });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /* ── F65.1: emitTurnStart ── */
    describe('emitTurnStart', () => {
        it('incrementa sendCount e emite turn_start', () => {
            const counter = { sendCount: 0 };
            const spy = vi.fn();
            emitter.on('turn_start', spy);

            emitTurnStart(emitter, 'hello world', counter);

            expect(counter.sendCount).toBe(1);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello world' }));
        });

        it('trunca mensagem a 120 chars no evento', () => {
            const counter = { sendCount: 0 };
            const spy = vi.fn();
            emitter.on('turn_start', spy);
            const longMsg = 'a'.repeat(200);

            emitTurnStart(emitter, longMsg, counter);

            const emitted = spy.mock.calls[0]?.[0];
            expect(emitted.message.length).toBe(120);
        });

        it('roteia a persistência assíncrona via trackBackgroundTask quando o host suporta tracker', async () => {
            vi.mocked(persistAgentRuntimePendingTurnState).mockResolvedValue({
                ok: true,
                value: /** @type {any} */ ({ pendingTurnMessage: 'hello world' }),
            });
            const counter = { sendCount: 0 };
            const trackBackgroundTask = vi.fn().mockResolvedValue(undefined);

            emitTurnStart(emitter, 'hello world', counter, makeTurnHost({ trackBackgroundTask }));

            expect(trackBackgroundTask).toHaveBeenCalledTimes(1);
            expect(trackBackgroundTask).toHaveBeenCalledWith(
                expect.any(Promise),
                expect.objectContaining({
                    label: 'dialog.turn.pending',
                    description: 'Persist pending turn marker at turn start',
                }),
            );
        });

        it('usa persistAgentRuntimePendingTurnState para marcar pending turn no início do turno', () => {
            const counter = { sendCount: 0 };

            emitTurnStart(emitter, 'hello world', counter);

            expect(persistAgentRuntimePendingTurnState).toHaveBeenCalledWith({
                message: 'hello world',
                ts: expect.any(Number),
            });
        });
    });

    /* ── F65.2: buildTurnResolutionListeners — reply path ── */
    describe('buildTurnResolutionListeners', () => {
        it('onReplyOuter resolve com reply e limpa timeout', async () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const pendingListenerRef = { current: null };

            const { onReplyOuter, timeoutHandle } = buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 5000,
                message: 'hi',
                pendingListenerRef,
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            onReplyOuter({ reply: 'world' });
            expect(resolve).toHaveBeenCalledWith('world');
            expect(reject).not.toHaveBeenCalled();
            // timeout should have been cleared — advancing should NOT reject
            await vi.advanceTimersByTimeAsync(6000);
            expect(reject).not.toHaveBeenCalled();
        });

        it('timeout rejeita com DIALOG_TIMEOUT', async () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const pendingListenerRef = { current: null };

            buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 3000,
                message: 'hi',
                pendingListenerRef,
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            await vi.advanceTimersByTimeAsync(3100);
            expect(reject).toHaveBeenCalledTimes(1);
            const err = reject.mock.calls[0]?.[0];
            expect(err.code).toBe('DIALOG_TIMEOUT');
        });

        it('timeout é de inatividade e reinicia com progresso observável', async () => {
            const resolve = vi.fn();
            const reject = vi.fn();

            buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 3000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            await vi.advanceTimersByTimeAsync(2500);
            emitter.emit('task.delta', { chunk: 'still working' });
            await vi.advanceTimersByTimeAsync(2500);

            expect(resolve).not.toHaveBeenCalled();
            expect(reject).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(600);
            expect(reject).toHaveBeenCalledTimes(1);
            expect(reject.mock.calls[0]?.[0]?.code).toBe('DIALOG_TIMEOUT');
        });

        it('timeout de inatividade também reinicia com progresso vindo do host vivo', async () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const host = Object.assign(new EventEmitter(), makeTurnHost());

            buildTurnResolutionListeners(emitter, {
                host,
                turnStart: Date.now(),
                timeout: 3000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            await vi.advanceTimersByTimeAsync(2500);
            host.emit('tool.execution_progress', { toolName: 'glob', progress: 50 });
            await vi.advanceTimersByTimeAsync(2500);

            expect(resolve).not.toHaveBeenCalled();
            expect(reject).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(600);
            expect(reject).toHaveBeenCalledTimes(1);
            expect(reject.mock.calls[0]?.[0]?.code).toBe('DIALOG_TIMEOUT');
        });

        it('limpa listeners de progresso registrados no host após resolução', async () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const host = Object.assign(new EventEmitter(), makeTurnHost());

            const { onReplyOuter } = buildTurnResolutionListeners(emitter, {
                host,
                turnStart: Date.now(),
                timeout: 3000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            expect(host.listenerCount('tool.execution_progress')).toBe(1);

            onReplyOuter({ reply: 'world' });

            expect(host.listenerCount('tool.execution_progress')).toBe(0);
            await vi.advanceTimersByTimeAsync(3100);
            expect(reject).not.toHaveBeenCalled();
        });

        it('onReadyOuter usa fallback semântico antes do timeout quando houver reply candidato', () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const tryUseReplyFallback = vi.fn(() => true);

            const { onReadyOuter } = buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 5000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
                tryUseReplyFallback,
            });

            onReadyOuter({});
            expect(tryUseReplyFallback).toHaveBeenCalled();
            expect(reject).not.toHaveBeenCalled();
        });

        it('onStopOuter authorized rejeita com DIALOG_ENDED', () => {
            const resolve = vi.fn();
            const reject = vi.fn();

            const { onStopOuter } = buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 5000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: vi.fn(),
            });

            onStopOuter({ authorized: true, reason: 'user' });
            expect(reject).toHaveBeenCalledTimes(1);
            const err = reject.mock.calls[0]?.[0];
            expect(err.code).toBe('DIALOG_ENDED');
        });

        it('onStopOuter não authorized chama waitForRestartAndReply', () => {
            const resolve = vi.fn();
            const reject = vi.fn();
            const waitFn = vi.fn().mockResolvedValue('restart-reply');

            const { onStopOuter } = buildTurnResolutionListeners(emitter, {
                host: makeTurnHost(),
                turnStart: Date.now(),
                timeout: 5000,
                message: 'hi',
                pendingListenerRef: { current: null },
                resolve,
                reject,
                waitForRestartAndReplyFn: waitFn,
            });

            onStopOuter({ authorized: false, reason: 'crash' });
            expect(waitFn).toHaveBeenCalledWith('hi', 5000, 'crash');
        });
    });

    /* ── F65.3: dispatchTurnToHost ── */
    describe('dispatchTurnToHost', () => {
        it('responde pergunta pendente diretamente se hasPendingQuestion() truthy', () => {
            const host = /** @type {any} */ ({
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
            });

            /** @type {any} */ (dispatchTurnToHost)(emitter, {
                host,
                message: 'resp',
                timeout: 5000,
                timeoutHandle: setTimeout(() => {}, 5000),
                pendingListenerRef: { current: null },
                onReplyOuter: vi.fn(),
                onReadyOuter: vi.fn(),
                onStopOuter: vi.fn(),
                resolve: vi.fn(),
                reject: vi.fn(),
                waitForRestartAndReplyFn: vi.fn(),
            });

            expect(host.answerPendingQuestion).toHaveBeenCalledWith('resp');
        });

        it('aguarda question.pending quando não há pergunta pendente', async () => {
            const host = /** @type {any} */ ({
                hasPendingQuestion: vi.fn().mockReturnValue(false),
                answerPendingQuestion: vi.fn(),
            });

            /** @type {any} */ (dispatchTurnToHost)(emitter, {
                host,
                message: 'delayed',
                timeout: 5000,
                timeoutHandle: setTimeout(() => {}, 5000),
                pendingListenerRef: { current: null },
                onReplyOuter: vi.fn(),
                onReadyOuter: vi.fn(),
                onStopOuter: vi.fn(),
                resolve: vi.fn(),
                reject: vi.fn(),
                waitForRestartAndReplyFn: vi.fn(),
            });

            expect(host.answerPendingQuestion).not.toHaveBeenCalled();

            // Simula SDK emitindo question.pending
            emitter.emit('question.pending', {});
            await tick();
            expect(host.answerPendingQuestion).toHaveBeenCalledWith('delayed');
        });

        it('resolve via pendingQuestion protocolar quando QUESTION_PENDING chega com REPLY já materializado', async () => {
            const host = /** @type {any} */ ({
                hasPendingQuestion: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
                answerPendingQuestion: vi.fn(),
                getPendingQuestionSnapshot: vi.fn(() => ({
                    question: 'REPLY: OK',
                    allowFreeform: true,
                    askedAt: Date.now(),
                    kind: 'reply',
                    protocolControlled: true,
                })),
            });
            const onReplyOuter = vi.fn();

            /** @type {any} */ (dispatchTurnToHost)(emitter, {
                host,
                message: 'delayed',
                timeout: 5000,
                timeoutHandle: setTimeout(() => {}, 5000),
                pendingListenerRef: { current: null },
                onReplyOuter,
                onReadyOuter: vi.fn(),
                onStopOuter: vi.fn(),
                resolve: vi.fn(),
                reject: vi.fn(),
                waitForRestartAndReplyFn: vi.fn(),
            });

            emitter.emit('question.pending', {});
            await tick();

            expect(onReplyOuter).toHaveBeenCalledWith({ reply: 'OK' });
            expect(host.answerPendingQuestion).not.toHaveBeenCalled();
        });
    });

    /* ── F65.4: waitForRestartAndReply ── */
    describe('waitForRestartAndReply', () => {
        it('rejeita NOT_ATTACHED se host é null', async () => {
            await expect(waitForRestartAndReply(emitter, /** @type {any} */ (null), 'msg', 5000)).rejects.toThrow(
                /Host não vinculado/,
            );
        });

        it('rejeita AbortError se signal já abortado', async () => {
            const ac = new AbortController();
            ac.abort();
            const host = { hasPendingQuestion: vi.fn(), answerPendingQuestion: vi.fn() };
            await expect(waitForRestartAndReply(emitter, host, 'msg', 5000, undefined, ac.signal)).rejects.toThrow(
                /abortado/,
            );
        });

        it('timeout rejeita com DIALOG_RESTART_TIMEOUT', async () => {
            const host = { hasPendingQuestion: vi.fn(), answerPendingQuestion: vi.fn() };
            const p = waitForRestartAndReply(emitter, host, 'msg', 2000, 'crash');
            const caught = p.catch((e) => e);
            await vi.advanceTimersByTimeAsync(2100);
            const err = await caught;
            expect(err.code).toBe('DIALOG_RESTART_TIMEOUT');
        });

        it('happy path: ready → question.pending → reply resolve', async () => {
            const host = {
                hasPendingQuestion: vi.fn().mockReturnValue(false),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn(),
                getModel: vi.fn(),
            };

            const p = waitForRestartAndReply(emitter, host, 'retry-msg', 10000);

            // Step 1: host fica ready
            emitter.emit('ready');
            await tick();

            // Step 2: question.pending é emitido
            emitter.emit('question.pending', {});
            await tick();
            expect(host.answerPendingQuestion).toHaveBeenCalledWith('retry-msg');

            // Step 3: reply chega
            emitter.emit('reply', { reply: 'ok-result' });
            await tick();

            await expect(p).resolves.toBe('ok-result');
        });

        it('abort durante espera por ready cancela', async () => {
            const ac = new AbortController();
            const host = { hasPendingQuestion: vi.fn(), answerPendingQuestion: vi.fn() };

            const p = waitForRestartAndReply(emitter, host, 'msg', 10000, undefined, ac.signal);

            // Capturar rejeição antes de abortar para evitar unhandled rejection
            const caught = p.catch((e) => e);
            ac.abort();
            await tick();

            const err = await caught;
            expect(err).toBeInstanceOf(DOMException);
            expect(err.message).toMatch(/abortado/);
        });

        it('remove listener de abort após concluir com reply', async () => {
            const ac = new AbortController();
            const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
            const host = {
                hasPendingQuestion: vi.fn().mockReturnValue(false),
                answerPendingQuestion: vi.fn(),
            };

            const p = waitForRestartAndReply(emitter, host, 'retry-msg', 10000, undefined, ac.signal);
            emitter.emit('ready');
            await tick();
            emitter.emit('question.pending', {});
            await tick();
            emitter.emit('reply', { reply: 'ok-result' });
            await tick();

            await expect(p).resolves.toBe('ok-result');
            expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
        });
    });

    /* ── F65.5: executeTurnImpl (orquestração) ── */
    describe('executeTurnImpl', () => {
        it('rejeita NOT_ATTACHED se host ausente', async () => {
            await expect(
                executeTurnImpl(
                    emitter,
                    'hi',
                    { timeout: 5000 },
                    /** @type {any} */ ({ host: null, sendCountRef: { sendCount: 0 } }),
                ),
            ).rejects.toThrow(/Host não vinculado/);
        });

        it('rejeita AbortError se signal já abortado', async () => {
            const ac = new AbortController();
            ac.abort();
            const host = {
                hasPendingQuestion: vi.fn(),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn(),
                getModel: vi.fn(),
            };

            await expect(
                executeTurnImpl(
                    emitter,
                    'hi',
                    { timeout: 5000, signal: ac.signal },
                    { host, sendCountRef: { sendCount: 0 } },
                ),
            ).rejects.toThrow(/abortado/);
        });

        it('happy path: pergunta pendente → reply resolve', async () => {
            const host = {
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-4o'),
            };
            const sendCountRef = { sendCount: 0 };

            const p = executeTurnImpl(emitter, 'question?', { timeout: 5000 }, { host, sendCountRef });

            // reply chega
            emitter.emit('reply', { reply: 'answer!' });
            await tick();

            await expect(p).resolves.toBe('answer!');
            expect(sendCountRef.sendCount).toBe(1);
        });

        it('remove listener de abort após reply no caminho principal', async () => {
            const ac = new AbortController();
            const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
            const host = {
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-4o'),
            };

            const p = executeTurnImpl(
                emitter,
                'question?',
                { timeout: 5000, signal: ac.signal },
                { host, sendCountRef: { sendCount: 0 } },
            );

            emitter.emit('reply', { reply: 'answer!' });
            await tick();

            await expect(p).resolves.toBe('answer!');
            expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
        });

        it('usa assistant.message como fallback semântico quando o protocolo REPLY deriva', async () => {
            const host = Object.assign(new EventEmitter(), {
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-5-mini'),
            });

            const p = executeTurnImpl(
                emitter,
                'question?',
                { timeout: 5000 },
                /** @type {any} */ ({ host, sendCountRef: { sendCount: 0 } }),
            );

            host.emit('assistant.message', { content: 'OK' });
            await vi.advanceTimersByTimeAsync(5100);
            await tick();

            await expect(p).resolves.toBe('OK');
        });

        it('normaliza assistant.message contendo REPLY: como fallback do turno', async () => {
            const host = Object.assign(new EventEmitter(), {
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-5-mini'),
            });

            const p = /** @type {any} */ (executeTurnImpl)(
                emitter,
                'question?',
                { timeout: 5000 },
                { host, sendCountRef: { sendCount: 0 } },
            );

            host.emit('assistant.message', { content: 'REPLY: resposta por fallback' });
            await vi.advanceTimersByTimeAsync(5100);
            await tick();

            await expect(p).resolves.toBe('resposta por fallback');
        });

        it('remove listeners externos após timeout para evitar reply tardio contabilizado', async () => {
            const host = {
                hasPendingQuestion: vi.fn().mockReturnValue(true),
                answerPendingQuestion: vi.fn(),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-5-mini'),
            };

            const p = executeTurnImpl(
                emitter,
                'question?',
                { timeout: 1000 },
                { host, sendCountRef: { sendCount: 0 } },
            );
            const caught = p.catch((err) => err);

            await vi.advanceTimersByTimeAsync(1100);
            await tick();

            expect(emitter.listenerCount('reply')).toBe(0);
            expect(emitter.listenerCount('stopped')).toBe(0);

            emitter.emit('reply', { reply: 'late reply' });
            await tick();

            const err = await caught;
            expect(err.code).toBe('DIALOG_TIMEOUT');
        });

        it('resolve pelo snapshot protocolar pendente quando o evento de reply se perde', async () => {
            const host = /** @type {any} */ ({
                hasPendingQuestion: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
                answerPendingQuestion: vi.fn(),
                getPendingQuestionSnapshot: vi.fn(() => ({
                    question: 'REPLY: OK',
                    allowFreeform: true,
                    askedAt: Date.now(),
                    kind: 'reply',
                    protocolControlled: true,
                })),
                getSessionId: vi.fn().mockReturnValue('sess-1'),
                getModel: vi.fn().mockReturnValue('gpt-5-mini'),
            });

            const p = executeTurnImpl(
                emitter,
                'question?',
                { timeout: 5000 },
                { host, sendCountRef: { sendCount: 0 } },
            );

            emitter.emit('question.pending', {});
            await tick();

            await expect(p).resolves.toBe('OK');
            expect(host.answerPendingQuestion).not.toHaveBeenCalled();
        });
    });
});
