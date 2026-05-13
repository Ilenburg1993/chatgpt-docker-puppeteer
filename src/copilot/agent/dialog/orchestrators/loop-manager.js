// @ts-check
/**
 * @module copilot/agent/dialog/loop-manager
 * @file Gerenciador do loop de diálogo: controla turnos, compaction, stall detection e watchdog. Coordena a execução de
 *   cada turno via TurnExecutor.
 *
 *   src/copilot/agent/dialog/orchestrators/loop-manager.js
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/dialog/protocol
 * @see module:copilot/agent/dialog/watchdog
 */

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
} from '#copilot/events';
import { EventEmitter } from 'node:events';
import { logSwallowed } from '../../../core/error-handlers.js';
import { DialogProtocol } from '../../../dialog/protocol.js';
import {
    persistAgentRuntimeDialogState,
    readAgentRuntimeDialogPersistedState,
} from '../../facades/agent-runtime-state.js';
import { log } from '../../ports/logging-port.js';
import { startSpanImmediate } from '../../ports/tracing-port.js';
import { DialogBootCircuit } from '../boot/loop-boot-circuit.js';
import { runDialogLoopBoot } from '../boot/loop-boot-runner.js';
import { createDialogLoopRuntimeKit } from '../boot/loop-runtime-kit.js';
import { executeTurnImpl } from '../executors/turn-executor.js';
import { selectDialogResumeStrategy } from '../policies/resume-policy.js';

/**
 * @typedef {Object} DialogLoopManagerOptions
 * @property {number} [maxQueueSize] - Máximo de turnos na fila (default: 10)
 * @property {number} [bootTimeoutMs] - Timeout para boot do dialog (default: 30s)
 * @property {number} [watchdogIntervalMs] - Intervalo do watchdog (default: 5min)
 * @property {number} [watchdogStallMs] - Limiar de stall (default: 15min)
 * @property {string | null} [fallbackModel] - Modelo de fallback a usar na próxima inicialização (agendado por
 *   `scheduleFallback()`) Interface esperada do agente host (AlwaysAliveAgent) para interação bidirecional.
 *
 * @typedef {import('../../types.js').DialogLoopHost} DialogLoopHost
 *
 * @typedef {import('../state/backpressure.js').TurnQueue} TurnQueue
 *
 * @typedef {import('../policies/compaction-policy.js').DialogCompactionPolicy} DialogCompactionPolicy
 *
 * @typedef {import('../state/cost-ledger.js').DialogCostLedger} DialogCostLedger
 *
 * @typedef {import('../policies/model-fallback.js').ModelFallbackState} ModelFallbackState
 *
 * @typedef {import('../state/state-machine.js').DialogLoopStateMachine} DialogLoopStateMachine
 *
 * @typedef {import('../watchdogs/watchdog-supervisor.js').DialogWatchdogSupervisor} DialogWatchdogSupervisor
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

    /** @type {DialogLoopHost | null} */
    #host = null;

    /** @type {{ sendCount: number }} Ref mutável para o contador de sends — usado pelo dialog-turn-executor. */
    #sendCountRef = { sendCount: 0 };

    /** @type {DialogCostLedger} F5: ledger de PR consumido por boot/resume */
    #costLedger;

    /** @type {DialogBootCircuit} W86.8: circuit breaker do boot extraído do manager */
    #bootCircuit = new DialogBootCircuit();

    /**
     * @param {DialogLoopManagerOptions} [options]
     */
    constructor(options = {}) {
        super();
        const runtimeKit = createDialogLoopRuntimeKit(options, {
            onStall: (stalledMs) => {
                if (this.#shouldSuppressWatchdogEscalation()) {
                    log(
                        'INFO',
                        '[DialogLoopManager] Watchdog stall suprimido: aguardando input humano legítimo (pending question kind=question).',
                    );
                    this.#watchdogSupervisor.ping();
                    return;
                }
                this.emit(EMITTER_LOOP_STALLED, { stalledMs });
            },
            onPreStallWarning: (stalledMs) => {
                if (this.#shouldSuppressWatchdogEscalation()) {
                    this.#watchdogSupervisor.ping();
                    return;
                }
                this.emit(EMITTER_LOOP_PRE_STALL_WARNING, { stalledMs });
            },
        });

        this.#turnQueue = runtimeKit.turnQueue;
        this.#bootTimeoutMs = runtimeKit.bootTimeoutMs;
        this.#watchdogSupervisor = runtimeKit.watchdogSupervisor;
        this.#modelFallback = runtimeKit.modelFallback;
        this.#compactionPolicy = runtimeKit.compactionPolicy;
        this.#state = runtimeKit.state;
        this.#costLedger = runtimeKit.costLedger;
    }

    /**
     * Vincula o manager ao host interno do dialog loop.
     *
     * O `host` aqui é um adapter de capacidades montado pelo controller do dialog. Ele não representa o
     * `AlwaysAliveAgent` inteiro; representa apenas o canal mínimo que preserva a política 0-PR do loop:
     *
     * - boot por `sendMessageDialogBoot()`;
     * - reutilização de `ask_user` via `answerPendingQuestion()`;
     * - observação de eventos auxiliares do runtime para fallback semântico.
     *
     * Deve ser chamado antes de `start()` e pode ser chamado novamente após reconexão para atualizar a capability viva.
     *
     * @param {DialogLoopHost} host
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
        this.#bootCircuit.assertClosed();

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

        // FIX P0-2: try/catch em torno do boot para evitar #active=true orphaned se boot lançar.
        try {
            await runDialogLoopBoot({
                emitter: this,
                host: this.#host,
                state: this.#state,
                bootTimeoutMs: this.#bootTimeoutMs,
                watchdogSupervisor: this.#watchdogSupervisor,
                modelFallback: this.#modelFallback,
                costLedger: this.#costLedger,
                bootCircuit: this.#bootCircuit,
                ...(bootPrompt !== undefined && { bootPrompt }),
                emit: (event, payload) => this.emit(event, payload),
                trackPersistedState: (data, meta) => this.#trackPersistedState(data, meta),
                persistPrMetrics: (label, description) => this.#persistPrMetrics(label, description),
                endLoopSpan: (success) => this.#endLoopSpan(success),
            });
        } catch (err) {
            this.#state.deactivate();
            this.#endLoopSpan(false);
            this.#watchdogSupervisor.clear();
            this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'boot_failed' });
            throw err;
        }
    }

    /**
     * Envia um turno de diálogo. Chamadas concorrentes são serializadas via mutex.
     *
     * @param {string} message
     * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [opts] `timeout: null` desabilita o
     *   inactivity guard. Este é o default para não impor limite bloqueante às operações da LLM-B.
     * @returns {Promise<string>}
     */
    sendTurn(message, { timeout = null, signal, traceId } = {}) {
        if (!this.#state.canSendTurn) {
            return Promise.reject(
                new SessionError('[DialogLoopManager] Dialog loop não está ativo.', 'DIALOG_NOT_ACTIVE'),
            );
        }

        if (signal?.aborted) {
            return Promise.reject(new DOMException('[DialogLoopManager] sendTurn abortado.', 'AbortError'));
        }

        this.#watchdogSupervisor.ping();
        log(
            'INFO',
            `[DialogLoopManager] sendTurn enqueued (trace=${traceId ?? 'none'}, timeout=${timeout === null ? 'none(watchdog-only)' : `${timeout}ms`}, queueDepth=${this.#turnQueue.depth})`,
        );

        return this.#turnQueue.enqueue(() =>
            this.#executeTurn(message, {
                timeout,
                ...(signal !== undefined && { signal }),
                ...(traceId ? { traceId } : {}),
            }),
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
     *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
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
        // FIX P0-1: drain() extraído para uma única Promise — evita dupla chamada simultânea.
        const drainPromise = this.#turnQueue.drain();
        /** @type {boolean} */
        let timedOut = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let shutdownTimer = null;
        void drainPromise.finally(() => {
            if (shutdownTimer !== null) clearTimeout(shutdownTimer);
        });
        try {
            await Promise.race([
                drainPromise,
                new Promise((resolve) => {
                    shutdownTimer = setTimeout(() => {
                        timedOut = true;
                        log(
                            'WARN',
                            `[DialogLoopManager] stop() timeout após ${shutdownTimeoutMs}ms — forçando forceDeactivate().`,
                        );
                        this.forceDeactivate();
                        resolve(undefined);
                    }, shutdownTimeoutMs);
                }),
            ]);
        } finally {
            if (shutdownTimer !== null) {
                clearTimeout(shutdownTimer);
            }
        }

        // O timeout já executou forceDeactivate(), que emite `stopped` e desativa o loop.
        // Evita dupla emissão de `stopped` com reason divergente (`force_deactivate` + `authorized_stop`).
        if (timedOut) {
            return;
        }

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
     * Indica se o watchdog deve suprimir escalonamento por stall.
     *
     * Regra: quando o loop está ativo e há pergunta pendente de tipo `question` (input humano), inatividade não deve
     * ser tratada como travamento do loop.
     *
     * @returns {boolean}
     */
    #shouldSuppressWatchdogEscalation() {
        if (!this.#state.active || this.#state.stopping) {
            return false;
        }
        const pending = this.#host?.getPendingQuestionSnapshot?.();
        if (pending?.kind === 'question' && pending.protocolControlled !== true) {
            return true;
        }
        const shadow = this.#host?.getPendingQuestionShadowSnapshot?.();
        const shadowKind =
            shadow && typeof shadow === 'object' && shadow.meta && typeof shadow.meta === 'object'
                ? shadow.meta.kind
                : null;
        const shadowExpired = Boolean(this.#host?.isPendingQuestionShadowExpired?.());
        return shadowKind === 'question' && !shadowExpired;
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
        const persisted = await readAgentRuntimeDialogPersistedState();
        if (!this.#state.paused && !persisted.dialogPaused) {
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
            const deactivated = await persistAgentRuntimeDialogState(
                { dialogLoopActive: false },
                'dialog.state.resume_restart',
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

        if ((kind === 'ready' || kind === 'reply') && !this.#state.active && !this.#state.stopping) {
            this.#recoverFromLateProtocol(kind);
        }

        if (this.#state.stopping && kind !== 'stopped') {
            log(
                'DEBUG',
                `[DialogLoopManager] Ignorando protocolo ${kind.toUpperCase()} recebido enquanto o loop está parando.`,
            );
            return;
        }

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
     * Reativa o estado interno quando um READY/REPLY chega após timeout de boot ou outro drift transitório.
     *
     * Isso evita que o runtime fique preso em `waiting_for_input` com `dialogLoopActive=false` quando o protocolo do
     * modelo já voltou a responder.
     *
     * @param {'ready' | 'reply'} kind
     * @returns {void}
     */
    #recoverFromLateProtocol(kind) {
        this.#state.activate();
        this.#watchdogSupervisor.start();
        this.emit(EMITTER_LOOP_CHANGED, {
            active: true,
            ts: Date.now(),
            reason: 'late_protocol_recovery',
            trigger: kind,
        });
        void this.#trackPersistedState(
            { dialogLoopActive: true, dialogPaused: false },
            {
                label: 'dialog.state.late_protocol_recovery',
                description: 'Persist dialogLoopActive=true after late READY/REPLY recovery',
            },
        );
        log('WARN', `[DialogLoopManager] Recuperando estado ativo após protocolo tardio (${kind.toUpperCase()}).`);
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
        this.emit('stopped', { reason: 'force_deactivate', authorized: true });
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
     * @param {{ timeout: number | null; signal?: AbortSignal; traceId?: string }} opts
     * @returns {Promise<string>}
     */
    #executeTurn(message, { timeout, signal, traceId }) {
        const host = this.#host;
        if (!host) {
            return Promise.reject(new SessionError('[DialogLoopManager] Host não vinculado.', 'NOT_ATTACHED'));
        }
        return executeTurnImpl(
            this,
            message,
            { timeout, ...(signal !== undefined && { signal }), ...(traceId ? { traceId } : {}) },
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
        const label = meta.label ?? 'dialog.state.persist';
        return this.#trackBackgroundTask(
            persistAgentRuntimeDialogState(data, label).then((result) => {
                if (!result.ok) {
                    const failure = /** @type {import('../../error-policy.js').AgentPolicyFailure} */ (result);
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
        const result = await persistAgentRuntimeDialogState(data, label);
        if (!result.ok) {
            log('WARN', `[DialogLoopManager] ${label} falhou: ${result.error.message}`);
            return false;
        }
        return true;
    }
}

// F61: wireDialogLoopEvents extraído para event-wiring.js — re-exportado para compatibilidade
export { wireDialogLoopEvents } from '../wiring/event-wiring.js';
