// @ts-check
/**
 * @module copilot/agent/dialog/loop-manager
 * @file Gerenciador do loop de diálogo: controla turnos, compaction, stall detection e watchdog. Coordena a execução de
 *   cada turno via TurnExecutor.
 *
 *   src/copilot/agent/dialog/loop-manager.js
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/agent/dialog/protocol
 * @see module:copilot/agent/dialog/watchdog
 */

import { getCopilotFallbackModel } from '#copilot/config';
import { SessionError } from '#copilot/core';
import {
    BaseEmitter,
    EMITTER_LOOP_CHANGED,
    EMITTER_LOOP_COMPACTION_REQUESTED,
    EMITTER_LOOP_PAUSED,
    EMITTER_LOOP_PRE_STALL_WARNING,
    EMITTER_LOOP_READY,
    EMITTER_LOOP_REPLY,
    EMITTER_LOOP_RESUMED,
    EMITTER_LOOP_STALLED,
    EMITTER_LOOP_STOPPED,
    EMITTER_LOOP_TURN_TIMEOUT,
} from '#copilot/events';
import { log, startSpanImmediate } from '#copilot/observability';
import { waitForEvent } from '#copilot/sdk';
import { logSwallowed } from '../../core/error-handlers.js';
import {
    BOOT_TIMEOUT_MS,
    DIALOG_QUEUE_MAX,
    LONG_TASK_TIMEOUT_MS,
    RESUME_QUESTION_WAIT_MS,
    WATCHDOG_INTERVAL_MS,
    WATCHDOG_STALL_MS,
} from '../config.js';
import { readState, readStateAsync, writeStateAsync } from '../lifecycle/state-io.js';
import { TurnQueue } from './backpressure.js';
import { ModelFallbackState } from './model-fallback.js';
import { DialogProtocol } from './protocol.js';
import { executeTurnImpl } from './turn-executor.js';
import { DialogWatchdog } from './watchdog.js';

/**
 * @typedef {Object} DialogLoopManagerOptions
 * @property {number} [maxQueueSize] - Máximo de turnos na fila (default: 10)
 * @property {number} [bootTimeoutMs] - Timeout para boot do dialog (default: 30s)
 * @property {number} [watchdogIntervalMs] - Intervalo do watchdog (default: 5min)
 * @property {number} [watchdogStallMs] - Limiar de stall (default: 15min)
 * @property {string | null} [fallbackModel] - Modelo de fallback a usar na próxima inicialização (agendado por
 *   `scheduleFallback()`) Interface esperada do agente host (AlwaysAliveAgent) para interação bidirecional.
 *
 * @typedef {Object} AgentHost
 * @property {(message: string, opts?: { timeoutMs?: number }) => Promise<string>} sendMessage - Envia mensagem ao SDK
 * @property {(message: string, opts?: { timeoutMs?: number }) => Promise<string>} sendMessageDialogBoot - Envia o boot
 *   prompt sem passar pelo guard do dialog loop — uso exclusivo do DialogLoopManager
 * @property {(answer: string) => void} answerPendingQuestion - Responde à pergunta pendente
 * @property {() => string | null} getSessionId - Retorna o sessionId ativo
 * @property {() => string} getModel - Retorna o modelo ativo
 * @property {(modelId: string) => void} [setModel] - Altera o modelo ativo (F41B.2)
 * @property {() => import('../types.js').PendingQuestion | null} getPendingQuestion - Retorna a pergunta pendente
 */

/**
 * Gerenciador do dialog loop — encapsula mutex, watchdog, backpressure, pause/resume e protocolo READY/REPLY.
 *
 * @extends BaseEmitter
 */
export class DialogLoopManager extends BaseEmitter {
    /** @type {boolean} */
    #active = false;

    /** @type {TurnQueue} F59: serialização e backpressure delegadas */
    #turnQueue;

    /** @type {boolean} */
    #stopping = false;

    /** @type {boolean} F42.6 (BUG-SD-007 fix): guard atômico para prevenir interleaving entre resume/start */
    #resuming = false;

    /** @type {DialogWatchdog | null} */
    #watchdog = null;

    /** @type {import('#copilot/observability/otel').OtelSpan | null} F68: span do ciclo de vida do dialog loop */
    #loopSpan = null;

    /** @type {ModelFallbackState} F60: estado de fallback de modelo delegado */
    #modelFallback;

    /** @type {boolean} F31.3: flag para evitar compaction duplicada */
    #compactionRequested = false;

    /** @type {number} */
    #bootTimeoutMs;

    /** @type {number} */
    #watchdogIntervalMs;

    /** @type {number} */
    #watchdogStallMs;

    /** @type {AgentHost | null} */
    #host = null;

    /** @type {{ sendCount: number }} Ref mutável para o contador de sends — usado pelo dialog-turn-executor. */
    #sendCountRef = { sendCount: 0 };

    /** @type {{ boots: number; resumesWithPR: number; resumesZeroPR: number }} F41B.8: contadores de PR */
    #prMetrics = { boots: 0, resumesWithPR: 0, resumesZeroPR: 0 };

    /**
     * @param {DialogLoopManagerOptions} [options]
     */
    constructor(options = {}) {
        super();
        this.#turnQueue = new TurnQueue({ maxSize: options.maxQueueSize ?? DIALOG_QUEUE_MAX });
        this.#bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
        this.#watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
        this.#watchdogStallMs = options.watchdogStallMs ?? WATCHDOG_STALL_MS;
        this.#modelFallback = new ModelFallbackState({
            defaultModel: options.fallbackModel ?? getCopilotFallbackModel(),
        });

        // F42.4 (BUG-SD-003 fix): restaurar prMetrics do estado persistido para sobreviver a restarts
        const saved = readState()?.prMetrics;
        if (saved && typeof saved === 'object') {
            this.#prMetrics = {
                boots: Number(saved.boots) || 0,
                resumesWithPR: Number(saved.resumesWithPR) || 0,
                resumesZeroPR: Number(saved.resumesZeroPR) || 0,
            };
        }
    }

    /**
     * Vincula o manager ao agente host. Deve ser chamado antes de startDialogLoop().
     *
     * @param {AgentHost} host - Referência ao AlwaysAliveAgent
     */
    attach(host) {
        this.#host = host;
    }

    /** @returns {boolean} */
    get active() {
        return this.#active;
    }

    /** @returns {boolean} */
    get stopping() {
        return this.#stopping;
    }

    /** @returns {number} */
    get queueDepth() {
        return this.#turnQueue.depth;
    }

    /**
     * Sinaliza que na próxima inicialização o modelo alternativo deve ser usado.
     */
    setPendingModelFallback() {
        this.#modelFallback.setPending();
    }

    /**
     * Agenda o fallback de modelo para a próxima inicialização do loop.
     *
     * @param {string} model - Modelo de fallback a usar
     */
    scheduleFallback(model) {
        this.#modelFallback.schedule(model);
    }

    /**
     * Pinga o watchdog — sinaliza atividade para evitar disparo de stall.
     */
    pingWatchdog() {
        this.#watchdog?.ping();
    }

    /**
     * F41B.8: Retorna métricas de PR consumidos pelo dialog loop (boots e resumes).
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number }}
     */
    get prMetrics() {
        const { boots, resumesWithPR, resumesZeroPR } = this.#prMetrics;
        return { boots, resumesWithPR, resumesZeroPR, totalPR: boots + resumesWithPR };
    }

    /**
     * Notifica o DLM que houve reconexão do agente.
     *
     * Desativa o flag `active` para que o mecanismo de restart da fila detecte a reconexão e reenvie a mensagem
     * pendente após a nova sessão ser estabelecida.
     */
    notifyReconnect() {
        if (this.#active) {
            this.#active = false;
            // F41B.4: parar watchdog ao reconectar — sem loop ativo, watchdog não deve rodar
            this.#watchdog?.stop();
            this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'reconnect' });
        }
    }

    /**
     * Indica se o dialog loop está pausado (estado persistido em disco).
     *
     * @returns {boolean}
     */
    get paused() {
        return readState()?.dialogPaused ?? false;
    }

    /**
     * Inicia o dialog loop. Boot com 1 PR — resolve quando o modelo emite READY.
     *
     * @param {string} [bootPrompt] - Prompt de inicialização (default: DialogProtocol.buildBootPrompt())
     * @returns {Promise<void>}
     * @throws {SessionError} Se não vinculado a um host (NOT_ATTACHED) ou dialog loop já ativo (DIALOG_ALREADY_ACTIVE)
     */
    async start(bootPrompt) {
        if (!this.#host) {
            throw new SessionError(
                '[DialogLoopManager] Não vinculado a um host. Chame attach() primeiro.',
                'NOT_ATTACHED',
            );
        }

        // F42.6: permitir start() durante resume (Estratégia B) mas bloquear duplicatas externas
        if (this.#active) {
            throw new SessionError(
                '[DialogLoopManager] Dialog loop já está ativo. Chame stop() primeiro.',
                'DIALOG_ALREADY_ACTIVE',
            );
        }

        this.#active = true;
        this.emit(EMITTER_LOOP_CHANGED, { active: true, ts: Date.now() });
        void writeStateAsync({ dialogLoopActive: true });

        // F68.2: Span OTEL para o ciclo completo do dialog loop (start → stop)
        this.#loopSpan = startSpanImmediate('copilot.dialog.loop', {
            'session.id': this.#host?.getSessionId() ?? '',
            model: this.#host?.getModel() ?? '',
        });

        // F60: delegar aplicação de fallback ao ModelFallbackState
        this.#modelFallback.applyIfPending(this.#host, (event, payload) => this.emit(event, payload));

        const metaPrompt = bootPrompt ?? DialogProtocol.buildBootPrompt();

        const bootPromise = waitForEvent(this, 'ready', {
            timeoutMs: this.#bootTimeoutMs,
            timeoutError: `[DialogLoopManager] Boot timeout após ${this.#bootTimeoutMs}ms`,
        });

        this.#watchdog = new DialogWatchdog({
            intervalMs: this.#watchdogIntervalMs,
            stallThresholdMs: this.#watchdogStallMs,
            onStall: (stalledMs) => this.emit(EMITTER_LOOP_STALLED, { stalledMs }),
            // F41B.7: aviso pré-stall a 80% do threshold
            onPreStallWarning: (stalledMs) => this.emit(EMITTER_LOOP_PRE_STALL_WARNING, { stalledMs }),
        });
        this.#watchdog.start();

        // G2-ARCH-02: usar sendMessageDialogBoot() para evitar a heurística frágil timeoutMs===24h.
        // O boot prompt tem timeout muito longo pois o dialog loop não emite session.idle organicamente.
        const host = this.#host;
        const bootSendFn =
            typeof (/** @type {{ sendMessageDialogBoot?: Function }} */ (host).sendMessageDialogBoot) === 'function'
                ? /** @type {{ sendMessageDialogBoot: Function }} */ (host).sendMessageDialogBoot.bind(host)
                : (/** @type {string} */ msg, /** @type {{ timeoutMs?: number }} */ opts = {}) =>
                      host.sendMessage(msg, { ...opts, timeoutMs: LONG_TASK_TIMEOUT_MS });

        bootSendFn(metaPrompt, { timeoutMs: LONG_TASK_TIMEOUT_MS }).catch((/** @type {Error} */ e) => {
            if (this.#active) {
                log('WARN', `[DialogLoopManager] Dialog loop encerrado: ${e.message}`);
                this.#active = false;
                this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now() });
                this.emit(EMITTER_LOOP_STOPPED, { reason: e.message });
            }
        });

        // G2-ARCH-20: emitir dialog.turn_timeout via SSE quando o boot timeout expira, em vez de apenas rejeitar.
        bootPromise.catch((/** @type {any} */ e) => {
            if (e?.message?.includes('Boot timeout') || e?.code === 'DIALOG_TIMEOUT') {
                this.emit(EMITTER_LOOP_TURN_TIMEOUT, { phase: 'boot', timeoutMs: this.#bootTimeoutMs, ts: Date.now() });
                log(
                    'WARN',
                    `[DialogLoopManager] Boot timeout (${this.#bootTimeoutMs}ms) — evento turn_timeout emitido.`,
                );
            }
        });

        await bootPromise;
        // F41B.8: contabilizar boot como 1 PR consumido
        this.#prMetrics.boots++;
        // F42.4: persistir prMetrics após boot bem-sucedido
        void writeStateAsync({ prMetrics: { ...this.#prMetrics } });
        log('INFO', '[DialogLoopManager] Dialog loop iniciado.');
    }

    /**
     * Envia um turno de diálogo. Chamadas concorrentes são serializadas via mutex.
     *
     * @param {string} message
     * @param {{ timeout?: number; signal?: AbortSignal }} [opts]
     * @returns {Promise<string>}
     */
    sendTurn(message, { timeout = 60_000, signal } = {}) {
        if (!this.#active) {
            return Promise.reject(
                new SessionError('[DialogLoopManager] Dialog loop não está ativo.', 'DIALOG_NOT_ACTIVE'),
            );
        }

        if (signal?.aborted) {
            return Promise.reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
        }

        this.#watchdog?.ping();

        return this.#turnQueue.enqueue(() =>
            this.#executeTurn(message, { timeout, ...(signal !== undefined && { signal }) }),
        );
    }

    /**
     * Para o dialog loop. Requer `authorized: true` para efetivamente encerrar.
     *
     * G2-ARCH-11: adiciona timeout de encerramento — se o turno em andamento não terminar em `shutdownTimeoutMs`
     * (default: 30 s), força desativação via `forceDeactivate()` para evitar espera indefinida.
     *
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>}
     */
    async stop({ authorized = false, reason = 'authorized_stop', shutdownTimeoutMs = 30_000 } = {}) {
        if (!this.#active) return;
        if (!authorized) {
            log(
                'WARN',
                '[DialogLoopManager] stop() sem autorização — ignorado. Use `authorized: true` para encerrar o loop.',
            );
            return;
        }
        if (this.#stopping) return;
        this.#stopping = true;

        if (this.#host?.getPendingQuestion()) {
            this.#host.answerPendingQuestion('STOP_DIALOG');
        }

        // F41B.1: Aguardar mutex drenar dentro do timeout antes de desativar.
        // O timer de shutdown só força desativação se o turno em andamento não terminar a tempo.
        await Promise.race([
            this.#turnQueue.drain(),
            new Promise((resolve) => {
                const timer = setTimeout(() => {
                    log(
                        'WARN',
                        `[DialogLoopManager] stop() timeout após ${shutdownTimeoutMs}ms — forçando forceDeactivate().`,
                    );
                    this.forceDeactivate();
                    resolve(undefined);
                }, shutdownTimeoutMs);
                // Se o mutex resolver antes do timeout, limpar o timer
                void this.#turnQueue.drain().then(() => {
                    clearTimeout(timer);
                    resolve(undefined);
                });
            }),
        ]);

        this.#active = false;
        this.#stopping = false;
        this.#endLoopSpan(true);
        void writeStateAsync({ dialogLoopActive: false });
        this.#watchdog?.stop();
        this.emit(EMITTER_LOOP_STOPPED, { reason, authorized: true });
    }

    /**
     * Pausa o dialog loop sem encerrar o agentic turn. Zero-cost.
     *
     * @param {string | null} sessionId
     * @returns {Promise<void>}
     */
    async pause(sessionId) {
        if (!this.#active) {
            log('WARN', '[DialogLoopManager] pause() com loop inativo — ignorado.');
            return;
        }
        await writeStateAsync({ dialogPaused: true, pausedAt: Date.now(), dialogLoopActive: true }).catch(
            (/** @type {Error} */ e) => log('WARN', `[DialogLoopManager] writeState dialogPaused: ${e.message}`),
        );
        // F31: pausar watchdog durante pause para evitar falsos-positivos de stall
        this.#watchdog?.stop();
        log('INFO', `[DialogLoopManager] Dialog loop pausado. SessionId: ${sessionId}.`);
        this.emit(EMITTER_LOOP_PAUSED, { sessionId, pausedAt: Date.now() });
    }

    /**
     * Retoma o dialog loop após pause. Estratégia A (0 PR) ou B (1 PR).
     *
     * @returns {Promise<void>}
     */
    async resume() {
        // F42.6 (BUG-SD-007 fix): previne interleaving entre resume() e start() concorrentes
        if (this.#resuming) {
            log('WARN', '[DialogLoopManager] resume() já em andamento — ignorado.');
            return;
        }
        const state = await readStateAsync();
        if (!state?.dialogPaused) {
            log('WARN', '[DialogLoopManager] resume() sem dialogPaused=true — ignorado.');
            return;
        }

        this.#resuming = true;
        try {
            await writeStateAsync({ dialogPaused: false }).catch((/** @type {any} */ e) =>
                log('WARN', `[DialogLoopManager] writeState dialogPaused=false: ${e.message}`),
            );

            // Estratégia A: ask_user já disponível sincronicamente (0 PR, 0 espera)
            if (this.#host?.getPendingQuestion()) {
                log('INFO', '[DialogLoopManager] ask_user já disponível — retomada zero-PR imediata.');
                // F31: reiniciar watchdog após resume
                this.#watchdog?.start();
                // F41B.8: contabilizar resume zero-PR
                this.#prMetrics.resumesZeroPR++;
                // F42.4: persistir prMetrics após resume
                void writeStateAsync({ prMetrics: { ...this.#prMetrics } });
                this.emit(EMITTER_LOOP_RESUMED, { prConsumed: false });
                return;
            }

            // Estratégia A (async): aguardar ask_user preservado (0 PR)
            // G2-BUG-03: 'question.pending' é emitido pelo agente host (AlwaysAliveAgent),
            // não pelo DialogLoopManager — ouvir no host se ele for EventEmitter.
            const hostEmitter = /** @type {import('events').EventEmitter} */ (/** @type {unknown} */ (this.#host));
            const pendingTarget = typeof hostEmitter?.on === 'function' ? hostEmitter : this;
            const preserved = await waitForEvent(pendingTarget, 'question.pending', {
                timeoutMs: RESUME_QUESTION_WAIT_MS,
            })
                .then(() => true)
                .catch(() => false);

            if (preserved) {
                log('INFO', '[DialogLoopManager] ask_user preservado — retomada zero-PR.');
                // F31: reiniciar watchdog após resume
                this.#watchdog?.start();
                // F41B.8: contabilizar resume zero-PR
                this.#prMetrics.resumesZeroPR++;
                // F42.4: persistir prMetrics após resume zero-PR
                void writeStateAsync({ prMetrics: { ...this.#prMetrics } });
                this.emit(EMITTER_LOOP_RESUMED, { prConsumed: false });
                return;
            }

            // Estratégia B: reenviar boot prompt (1 PR)
            log('INFO', '[DialogLoopManager] ask_user não encontrado — reenviando boot prompt (1 PR).');
            // G1-BUG-07 (fix): parar watchdog atual antes de start() para evitar dois watchdogs simultâneos.
            this.#watchdog?.stop();
            this.#watchdog = null;
            this.#active = false;
            await writeStateAsync({ dialogLoopActive: false }).catch((/** @type {any} */ e) =>
                logSwallowed(e, 'agent.loopManager.writeState'),
            );
            await this.start();
            // F41B.8: contabilizar resume com PR
            this.#prMetrics.resumesWithPR++;
            // F42.4: persistir prMetrics após resume com PR
            void writeStateAsync({ prMetrics: { ...this.#prMetrics } });
            this.emit(EMITTER_LOOP_RESUMED, { prConsumed: true });
        } finally {
            this.#resuming = false;
        }
    }

    /**
     * Processa input do SDK ask_user quando o dialog loop está ativo. Classifica o protocolo READY/REPLY/STOPPED.
     *
     * @param {{ question: string }} input
     */
    handleProtocolInput({ question }) {
        const kind = DialogProtocol.classify(question);

        if (kind === 'ready') {
            this.#watchdog?.ping();
            this.emit(EMITTER_LOOP_READY, {});
        } else if (kind === 'reply') {
            this.#watchdog?.ping();
            const reply = DialogProtocol.extractReply(question);
            this.emit(EMITTER_LOOP_REPLY, { reply });
        } else if (kind === 'stopped') {
            log('WARN', '[DialogLoopManager] Modelo emitiu STOPPED — emitindo stopped para restart automático.');
            this.emit(EMITTER_LOOP_STOPPED, { reason: 'model_stopped', authorized: false });
        }
    }

    /**
     * F68.2: Encerra o span OTEL do dialog loop.
     *
     * @param {boolean} success - Se o loop encerrou com sucesso (stop) ou forçadamente.
     */
    #endLoopSpan(success) {
        if (this.#loopSpan) {
            this.#loopSpan.setAttribute('success', success);
            this.#loopSpan.end();
            this.#loopSpan = null;
        }
    }

    /**
     * Força desativação sem protocolo (usado durante shutdown do agente).
     *
     * F42.3 (BUG-SD-006 fix): reseta mutex, queue depth e generation counter para prevenir execuções fantasma de turns
     * enfileirados que continuariam executando após desativação.
     */
    forceDeactivate() {
        this.#active = false;
        this.#stopping = false;
        this.#endLoopSpan(false);
        // F42.3: reset completo do mutex pipeline — previne turns fantasma
        this.#turnQueue.reset();
        this.#watchdog?.stop();
        this.#watchdog = null;
        // G2-BUG-11: emitir 'stopped' para que o host receba notificação do encerramento forçado
        this.emit(EMITTER_LOOP_STOPPED, { reason: 'force_deactivate', authorized: false });
        this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'force_deactivate' });
    }

    /**
     * F31.3/F31.4: Compaction proativa baseada em token utilization. Emite `compaction.requested` quando ratio atinge
     * 90% (proativa) ou 95% (urgente). O AlwaysAliveAgent deve ouvir este evento e acionar compaction via SDK.
     *
     * @param {{ currentTokens: number; tokenLimit: number; ratio: number }} budget
     */
    handleTokenBudget({ currentTokens, tokenLimit, ratio }) {
        if (!this.#active) return;

        // F31.4: compaction urgente em 95%+
        if (ratio >= 95) {
            log('WARN', `[DialogLoopManager] F31.4: Token budget CRÍTICO em ${ratio}% — compaction urgente.`);
            this.#compactionRequested = false; // Permite re-emissão
            this.emit(EMITTER_LOOP_COMPACTION_REQUESTED, { ratio, currentTokens, tokenLimit, urgency: 'critical' });
            return;
        }

        // F31.3: compaction proativa em 90%+
        if (ratio >= 90 && !this.#compactionRequested) {
            log('WARN', `[DialogLoopManager] F31.3: Token budget em ${ratio}% — compaction proativa solicitada.`);
            this.#compactionRequested = true;
            this.emit(EMITTER_LOOP_COMPACTION_REQUESTED, { ratio, currentTokens, tokenLimit, urgency: 'proactive' });
        }
    }

    /**
     * Reseta o flag de compaction solicitada (chamado após compaction concluída com sucesso).
     */
    resetCompactionFlag() {
        this.#compactionRequested = false;
    }

    /**
     * Executa um turno serializado.
     *
     * @param {string} message
     * @param {{ timeout: number; signal?: AbortSignal }} opts
     * @returns {Promise<string>}
     */
    #executeTurn(message, { timeout, signal }) {
        return executeTurnImpl(
            this,
            message,
            { timeout, ...(signal !== undefined && { signal }) },
            {
                host: this.#host,
                sendCountRef: this.#sendCountRef,
            },
        );
    }
}

// F61: wireDialogLoopEvents extraído para event-wiring.js — re-exportado para compatibilidade
export { wireDialogLoopEvents } from './event-wiring.js';
