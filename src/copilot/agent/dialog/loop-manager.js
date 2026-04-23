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
    EMITTER_LOOP_CHANGED,
    EMITTER_LOOP_COMPACTION_REQUESTED,
    EMITTER_LOOP_PAUSED,
    EMITTER_LOOP_PRE_STALL_WARNING,
    EMITTER_LOOP_READY,
    EMITTER_LOOP_REPLY,
    EMITTER_LOOP_RESUMED,
    EMITTER_LOOP_STALLED,
    EMITTER_LOOP_TURN_TIMEOUT,
} from '#copilot/events';
import { waitForEvent } from '#copilot/sdk';
import { EventEmitter } from 'node:events';
import {
    BOOT_TIMEOUT_MS,
    DIALOG_QUEUE_MAX,
    LONG_TASK_TIMEOUT_MS,
    WATCHDOG_INTERVAL_MS,
    WATCHDOG_STALL_MS,
} from '../../config/agent.js';
import { logSwallowed } from '../../core/error-handlers.js';
import { persistStateWithPolicy, readState, readStateAsync } from '../lifecycle/state-io.js';
import { log, startSpanImmediate } from '../ports/observability-port.js';
import { TurnQueue } from './backpressure.js';
import { DialogCompactionPolicy } from './compaction-policy.js';
import { DialogCostLedger } from './cost-ledger.js';
import { ModelFallbackState } from './model-fallback.js';
import { DialogProtocol } from './protocol.js';
import { selectDialogResumeStrategy } from './resume-policy.js';
import { DialogLoopStateMachine } from './state-machine.js';
import { executeTurnImpl } from './turn-executor.js';
import { DialogWatchdogSupervisor } from './watchdog-supervisor.js';

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
 * @property {(answer: string) => boolean} answerPendingQuestion - Responde à pergunta pendente
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} [on] - Interface mínima de
 *   EventEmitter para aguardar `question.pending` no host real.
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} [once]
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} [off]
 * @property {() => string | null} getSessionId - Retorna o sessionId ativo
 * @property {() => string} getModel - Retorna o modelo ativo
 * @property {(modelId: string) => void} [setModel] - Altera o modelo ativo (F41B.2)
 * @property {() => boolean} hasPendingQuestion - Indica se há pergunta pendente ativa
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} [trackBackgroundTask]
 *   - Tracker de tarefas fire-and-forget do host
 */

/**
 * Gerenciador do dialog loop — encapsula mutex, watchdog, backpressure, pause/resume e protocolo READY/REPLY.
 *
 * @extends EventEmitter
 */
export class DialogLoopManager extends EventEmitter {
    /** @type {DialogLoopStateMachine} */
    #state;

    /** @type {TurnQueue} F59: serialização e backpressure delegadas */
    #turnQueue;

    /** @type {DialogWatchdogSupervisor} */
    #watchdogSupervisor;

    /** @type {import('#copilot/observability/otel').OtelSpan | null} F68: span do ciclo de vida do dialog loop */
    #loopSpan = null;

    /** @type {ModelFallbackState} F60: estado de fallback de modelo delegado */
    #modelFallback;

    /** @type {DialogCompactionPolicy} F5: policy de compaction extraída do orquestrador */
    #compactionPolicy;

    /** @type {number} */
    #bootTimeoutMs;

    /** @type {AgentHost | null} */
    #host = null;

    /** @type {{ sendCount: number }} Ref mutável para o contador de sends — usado pelo dialog-turn-executor. */
    #sendCountRef = { sendCount: 0 };

    /** @type {DialogCostLedger} F5: ledger de PR consumido por boot/resume */
    #costLedger;

    /**
     * @param {DialogLoopManagerOptions} [options]
     */
    constructor(options = {}) {
        super();
        this.#turnQueue = new TurnQueue({ maxSize: options.maxQueueSize ?? DIALOG_QUEUE_MAX });
        this.#bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
        this.#watchdogSupervisor = new DialogWatchdogSupervisor({
            intervalMs: options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS,
            stallThresholdMs: options.watchdogStallMs ?? WATCHDOG_STALL_MS,
            onStall: (stalledMs) => this.emit(EMITTER_LOOP_STALLED, { stalledMs }),
            onPreStallWarning: (stalledMs) => this.emit(EMITTER_LOOP_PRE_STALL_WARNING, { stalledMs }),
        });
        this.#modelFallback = new ModelFallbackState({
            defaultModel: options.fallbackModel ?? getCopilotFallbackModel(),
        });
        this.#compactionPolicy = new DialogCompactionPolicy();

        // F42.4 (BUG-SD-003 fix): restaurar prMetrics do estado persistido para sobreviver a restarts
        const persistedState = readState();
        this.#state = new DialogLoopStateMachine({ paused: Boolean(persistedState?.dialogPaused) });
        const saved = persistedState?.prMetrics;
        this.#costLedger = new DialogCostLedger(saved && typeof saved === 'object' ? saved : null);
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
        return this.#state.active;
    }

    /** @returns {boolean} */
    get stopping() {
        return this.#state.stopping;
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
        this.#watchdogSupervisor.ping();
    }

    /**
     * F41B.8: Retorna métricas de PR consumidos pelo dialog loop (boots e resumes).
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number }}
     */
    get prMetrics() {
        return this.#costLedger.snapshot();
    }

    /**
     * Notifica o DLM que houve reconexão do agente.
     *
     * Desativa o flag `active` para que o mecanismo de restart da fila detecte a reconexão e reenvie a mensagem
     * pendente após a nova sessão ser estabelecida.
     */
    notifyReconnect() {
        if (this.#state.active) {
            this.#state.deactivate();
            // F41B.4: parar watchdog ao reconectar — sem loop ativo, watchdog não deve rodar
            this.#watchdogSupervisor.stop();
            this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'reconnect' });
        }
    }

    /**
     * Indica se o dialog loop está pausado (estado persistido em disco).
     *
     * @returns {boolean}
     */
    get paused() {
        return this.#state.paused;
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
        if (this.#state.active) {
            throw new SessionError(
                '[DialogLoopManager] Dialog loop já está ativo. Chame stop() primeiro.',
                'DIALOG_ALREADY_ACTIVE',
            );
        }

        this.#state.activate();
        this.emit(EMITTER_LOOP_CHANGED, { active: true, ts: Date.now() });
        void this.#trackPersistedState(
            { dialogLoopActive: true, dialogPaused: false },
            {
                label: 'dialog.state.active',
                description: 'Persist dialogLoopActive=true',
            },
        );

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

        this.#watchdogSupervisor.start();

        // G2-ARCH-02: usar sendMessageDialogBoot() para evitar a heurística frágil timeoutMs===24h.
        // O boot prompt tem timeout muito longo pois o dialog loop não emite session.idle organicamente.
        const host = this.#host;
        const bootSendFn =
            typeof (/** @type {{ sendMessageDialogBoot?: Function }} */ (host).sendMessageDialogBoot) === 'function'
                ? /** @type {{ sendMessageDialogBoot: Function }} */ (host).sendMessageDialogBoot.bind(host)
                : (/** @type {string} */ msg, /** @type {{ timeoutMs?: number }} */ opts = {}) =>
                      host.sendMessage(msg, { ...opts, timeoutMs: LONG_TASK_TIMEOUT_MS });

        Promise.resolve(bootSendFn(metaPrompt, { timeoutMs: LONG_TASK_TIMEOUT_MS })).catch((/** @type {Error} */ e) => {
            if (this.#state.active) {
                log('WARN', `[DialogLoopManager] Dialog loop encerrado: ${e.message}`);
                this.#state.deactivate();
                this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now() });
                this.emit('stopped', { reason: e.message });
            }
        });

        // G2-ARCH-20: emitir dialog.turn_timeout via SSE quando o boot timeout expira, em vez de apenas rejeitar.
        bootPromise.catch((e) => {
            if (e?.message?.includes('Boot timeout') || e?.code === 'DIALOG_TIMEOUT') {
                this.emit(EMITTER_LOOP_TURN_TIMEOUT, { phase: 'boot', timeoutMs: this.#bootTimeoutMs, ts: Date.now() });
                log(
                    'WARN',
                    `[DialogLoopManager] Boot timeout (${this.#bootTimeoutMs}ms) — evento turn_timeout emitido.`,
                );
            }
        });

        try {
            await bootPromise;
        } catch (bootErr) {
            const reason = bootErr instanceof Error ? bootErr.message : String(bootErr);
            this.#state.deactivate();
            this.#watchdogSupervisor.clear();
            this.#endLoopSpan(false);
            this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now() });
            this.emit('stopped', { reason });
            void this.#trackPersistedState(
                { dialogLoopActive: false },
                {
                    label: 'dialog.state.boot_failed',
                    description: 'Persist dialogLoopActive=false after boot failure',
                },
            );
            throw bootErr;
        }
        // F41B.8: contabilizar boot como 1 PR consumido
        this.#costLedger.recordBoot();
        // F42.4: persistir prMetrics após boot bem-sucedido
        void this.#persistPrMetrics('dialog.prMetrics.boot', 'Persist dialog loop PR metrics after boot');
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
        if (!this.#state.canSendTurn) {
            return Promise.reject(
                new SessionError('[DialogLoopManager] Dialog loop não está ativo.', 'DIALOG_NOT_ACTIVE'),
            );
        }

        if (signal?.aborted) {
            return Promise.reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
        }

        this.#watchdogSupervisor.ping();

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
        if (!this.#state.active) return;
        if (!authorized) {
            log(
                'WARN',
                '[DialogLoopManager] stop() sem autorização — ignorado. Use `authorized: true` para encerrar o loop.',
            );
            return;
        }
        const transition = this.#state.beginStop();
        if (transition === 'already-stopping') return;

        if (this.#host?.hasPendingQuestion()) {
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

        this.#state.finishStop();
        this.#endLoopSpan(true);
        void this.#trackPersistedState(
            { dialogLoopActive: false },
            {
                label: 'dialog.state.inactive',
                description: 'Persist dialogLoopActive=false',
            },
        );
        this.#watchdogSupervisor.stop();
        this.emit('stopped', { reason, authorized: true });
    }

    /**
     * Pausa o dialog loop sem encerrar o agentic turn. Zero-cost.
     *
     * @param {string | null} sessionId
     * @returns {Promise<void>}
     */
    async pause(sessionId) {
        if (!this.#state.active) {
            log('WARN', '[DialogLoopManager] pause() com loop inativo — ignorado.');
            return;
        }
        await this.#persistStateNow(
            { dialogPaused: true, pausedAt: Date.now(), dialogLoopActive: true },
            'dialog.state.pause',
        );
        this.#state.pause();
        // F31: pausar watchdog durante pause para evitar falsos-positivos de stall
        this.#watchdogSupervisor.stop();
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
        if (!this.#state.beginResume()) {
            log('WARN', '[DialogLoopManager] resume() já em andamento — ignorado.');
            return;
        }
        const state = await readStateAsync();
        if (!this.#state.paused && !state?.dialogPaused) {
            log('WARN', '[DialogLoopManager] resume() sem dialogPaused=true — ignorado.');
            this.#state.finishResume();
            return;
        }

        try {
            await this.#persistStateNow({ dialogPaused: false }, 'dialog.state.resume');
            this.#state.resume();

            const strategy = await selectDialogResumeStrategy({ host: this.#host, fallbackTarget: this });
            log('INFO', strategy.logMessage);

            if (strategy.kind !== 'restart-with-pr') {
                this.#watchdogSupervisor.start();
                this.#costLedger.recordZeroPrResume();
                if (strategy.persistenceLabel && strategy.persistenceDescription) {
                    void this.#persistPrMetrics(strategy.persistenceLabel, strategy.persistenceDescription);
                }
                this.emit(EMITTER_LOOP_RESUMED, { prConsumed: strategy.prConsumed });
                return;
            }

            // Estratégia B: reenviar boot prompt (1 PR)
            // G1-BUG-07 (fix): parar watchdog atual antes de start() para evitar dois watchdogs simultâneos.
            this.#watchdogSupervisor.clear();
            this.#state.prepareResumeRestart();
            const deactivated = await persistStateWithPolicy(
                { dialogLoopActive: false },
                { label: 'dialog.state.resume_restart' },
            );
            if (!deactivated.ok) {
                logSwallowed(deactivated.error, 'agent.loopManager.writeState');
            }
            await this.start();
            // F41B.8: contabilizar resume com PR
            this.#costLedger.recordPrResume();
            // F42.4: persistir prMetrics após resume com PR
            if (strategy.persistenceLabel && strategy.persistenceDescription) {
                void this.#persistPrMetrics(strategy.persistenceLabel, strategy.persistenceDescription);
            }
            this.emit(EMITTER_LOOP_RESUMED, { prConsumed: strategy.prConsumed });
        } finally {
            this.#state.finishResume();
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
            this.#watchdogSupervisor.ping();
            this.emit(EMITTER_LOOP_READY, {});
        } else if (kind === 'reply') {
            this.#watchdogSupervisor.ping();
            const reply = DialogProtocol.extractReply(question);
            this.emit(EMITTER_LOOP_REPLY, { reply });
        } else if (kind === 'stopped') {
            log('WARN', '[DialogLoopManager] Modelo emitiu STOPPED — emitindo stopped para restart automático.');
            this.emit('stopped', { reason: 'model_stopped', authorized: false });
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
        this.#state.deactivate();
        this.#endLoopSpan(false);
        // F42.3: reset completo do mutex pipeline — previne turns fantasma
        this.#turnQueue.reset();
        this.#watchdogSupervisor.clear();
        // G2-BUG-11: emitir 'stopped' para que o host receba notificação do encerramento forçado
        this.emit('stopped', { reason: 'force_deactivate', authorized: false });
        this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'force_deactivate' });
    }

    /**
     * F31.3/F31.4: Compaction proativa baseada em token utilization. Emite `compaction.requested` quando ratio atinge
     * 90% (proativa) ou 95% (urgente). O AlwaysAliveAgent deve ouvir este evento e acionar compaction via SDK.
     *
     * @param {{ currentTokens: number; tokenLimit: number; ratio: number }} budget
     */
    handleTokenBudget({ currentTokens, tokenLimit, ratio }) {
        if (!this.#state.active) return;

        const request = this.#compactionPolicy.evaluate({ currentTokens, tokenLimit, ratio });
        if (!request) return;

        if (request.urgency === 'critical') {
            log('WARN', `[DialogLoopManager] F31.4: Token budget CRÍTICO em ${ratio}% — compaction urgente.`);
        } else {
            log('WARN', `[DialogLoopManager] F31.3: Token budget em ${ratio}% — compaction proativa solicitada.`);
        }
        this.emit(EMITTER_LOOP_COMPACTION_REQUESTED, request);
    }

    /**
     * Reseta o flag de compaction solicitada (chamado após compaction concluída com sucesso).
     */
    resetCompactionFlag() {
        this.#compactionPolicy.reset();
    }

    /**
     * Executa um turno serializado.
     *
     * @param {string} message
     * @param {{ timeout: number; signal?: AbortSignal }} opts
     * @returns {Promise<string>}
     */
    #executeTurn(message, { timeout, signal }) {
        const host = this.#host;
        if (!host) {
            return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
        }
        return executeTurnImpl(
            this,
            message,
            { timeout, ...(signal !== undefined && { signal }) },
            {
                host,
                sendCountRef: this.#sendCountRef,
            },
        );
    }

    /**
     * @param {Promise<unknown>} task
     * @param {{ label?: string; description?: string }} meta
     * @returns {Promise<void>}
     */
    #trackBackgroundTask(task, meta) {
        if (typeof this.#host?.trackBackgroundTask === 'function') {
            return this.#host.trackBackgroundTask(task, meta);
        }
        return Promise.resolve(task).then(
            () => undefined,
            (error) => logSwallowed(error, `agent.loopManager.${meta.label ?? 'background'}`),
        );
    }

    /**
     * Persiste snapshot parcial do dialog loop como tarefa de background, usando a policy canônica do agent.
     *
     * @param {Record<string, unknown>} data
     * @param {{ label?: string; description?: string }} meta
     * @returns {Promise<void>}
     */
    #trackPersistedState(data, meta) {
        const policyOpts = meta.label !== undefined ? { label: meta.label } : {};
        return this.#trackBackgroundTask(
            persistStateWithPolicy(data, policyOpts).then((result) => {
                if (!result.ok) {
                    const failure = /** @type {import('../error-policy.js').AgentPolicyFailure} */ (result);
                    throw failure.error;
                }
                return undefined;
            }),
            meta,
        );
    }

    /**
     * Persiste o ledger de PR do dialog loop.
     *
     * @param {string} label
     * @param {string} description
     * @returns {Promise<void>}
     */
    #persistPrMetrics(label, description) {
        return this.#trackPersistedState({ prMetrics: this.#costLedger.snapshot() }, { label, description });
    }

    /**
     * Persiste estado imediatamente sem derrubar o runtime do dialog loop se houver falha de I/O.
     *
     * @param {Record<string, unknown>} data
     * @param {string} label
     * @returns {Promise<boolean>}
     */
    async #persistStateNow(data, label) {
        const result = await persistStateWithPolicy(data, { label });
        if (!result.ok) {
            log('WARN', `[DialogLoopManager] ${label} falhou: ${result.error.message}`);
            return false;
        }
        return true;
    }
}

// F61: wireDialogLoopEvents extraído para event-wiring.js — re-exportado para compatibilidade
export { wireDialogLoopEvents } from './event-wiring.js';
