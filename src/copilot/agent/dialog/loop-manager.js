// @ts-check
/**
 * src/copilot/agent/dialog/loop-manager.js
 *
 * DialogLoopManager — gerencia o ciclo de vida completo do dialog loop do agente.
 *
 * Extraído de always-alive.js para separação de concerns:
 *
 * - Mutex de serialização de turnos
 * - Backpressure da fila de dialog turns
 * - Watchdog de inatividade
 * - Protocolo READY/REPLY/DONE/STOPPED (via DialogProtocol)
 * - Pause/Resume zero-PR
 * - Fallback de modelo automático ao atingir quota/rate_limit
 *
 * @module copilot/agent/dialog/loop-manager
 * @see module:copilot/always-alive
 * @see module:copilot/agent/dialog/protocol
 * @see module:copilot/agent/dialog/watchdog
 */

import { getCopilotFallbackModel } from '#copilot/config/env';
import { SessionError } from '#copilot/core/errors';
import { log } from '#copilot/observability/logger';
import { waitForEvent } from '#copilot/sdk/event-helpers';
import EventEmitter from 'node:events';
import {
    BOOT_TIMEOUT_MS,
    DIALOG_QUEUE_MAX,
    LONG_TASK_TIMEOUT_MS,
    RESUME_QUESTION_WAIT_MS,
    WATCHDOG_INTERVAL_MS,
    WATCHDOG_STALL_MS,
} from '../config.js';
import { persistState, readState, writeStateAsync } from '../lifecycle/state-io.js';
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
 *   `scheduleFallback()`)
 */

/**
 * Interface esperada do agente host (AlwaysAliveAgent) para interação bidirecional.
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
 * @extends EventEmitter
 */
export class DialogLoopManager extends EventEmitter {
    /** @type {boolean} */
    #active = false;

    /** @type {Promise<void>} */
    #turnMutex = Promise.resolve();

    /** @type {number} */
    #turnQueueDepth = 0;

    /** @type {number} */
    #turnMutexGen = 0;

    /** @type {boolean} */
    #stopping = false;

    /** @type {boolean} F42.6 (BUG-SD-007 fix): guard atômico para prevenir interleaving entre resume/start */
    #resuming = false;

    /** @type {DialogWatchdog | null} */
    #watchdog = null;

    /** @type {boolean} */
    #pendingModelFallback = false;

    /** @type {boolean} F31.3: flag para evitar compaction duplicada */
    #compactionRequested = false;

    /** @type {string | null} */
    #fallbackModel;

    /** @type {number} */
    #maxQueueSize;

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
        this.#maxQueueSize = options.maxQueueSize ?? DIALOG_QUEUE_MAX;
        this.#bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
        this.#watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
        this.#watchdogStallMs = options.watchdogStallMs ?? WATCHDOG_STALL_MS;
        this.#fallbackModel = options.fallbackModel ?? getCopilotFallbackModel();

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
        return this.#turnQueueDepth;
    }

    /**
     * Sinaliza que na próxima inicialização o modelo alternativo deve ser usado.
     */
    setPendingModelFallback() {
        this.#pendingModelFallback = true;
    }

    /**
     * Agenda o fallback de modelo para a próxima inicialização do loop.
     *
     * @param {string} model - Modelo de fallback a usar
     */
    scheduleFallback(model) {
        this.#fallbackModel = model;
        this.#pendingModelFallback = true;
        log('INFO', `[DialogLoopManager] scheduleFallback: ${model} agendado para próximo boot.`);
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
            this.emit('changed', { active: false, ts: Date.now(), reason: 'reconnect' });
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
        this.emit('changed', { active: true, ts: Date.now() });
        persistState({ dialogLoopActive: true }, '[DialogLoopManager] writeState dialogLoopActive=true');

        // Aplica fallback de modelo se previamente agendado por `scheduleFallback()`.
        if (this.#pendingModelFallback && this.#fallbackModel) {
            const prev = this.#host.getModel();
            this.#pendingModelFallback = false;
            // F41B.2: efetivamente aplicar o modelo no host (se setModel estiver disponível)
            if (typeof this.#host.setModel === 'function') {
                this.#host.setModel(this.#fallbackModel);
            }
            this.emit('model.fallback', { previousModel: prev, newModel: this.#fallbackModel, ts: Date.now() });
            log('WARN', `[DialogLoopManager] Aplicando modelo fallback: ${prev} → ${this.#fallbackModel}`);
        }

        const metaPrompt = bootPrompt ?? DialogProtocol.buildBootPrompt();

        const bootPromise = waitForEvent(this, 'ready', {
            timeoutMs: this.#bootTimeoutMs,
            timeoutError: `[DialogLoopManager] Boot timeout após ${this.#bootTimeoutMs}ms`,
        });

        this.#watchdog = new DialogWatchdog({
            intervalMs: this.#watchdogIntervalMs,
            stallThresholdMs: this.#watchdogStallMs,
            onStall: (stalledMs) => this.emit('stalled', { stalledMs }),
            // F41B.7: aviso pré-stall a 80% do threshold
            onPreStallWarning: (stalledMs) => this.emit('pre_stall_warning', { stalledMs }),
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
                this.emit('changed', { active: false, ts: Date.now() });
                this.emit('stopped', { reason: e.message });
            }
        });

        // G2-ARCH-20: emitir dialog.turn_timeout via SSE quando o boot timeout expira, em vez de apenas rejeitar.
        bootPromise.catch((/** @type {any} */ e) => {
            if (e?.message?.includes('Boot timeout') || e?.code === 'DIALOG_TIMEOUT') {
                this.emit('turn_timeout', { phase: 'boot', timeoutMs: this.#bootTimeoutMs, ts: Date.now() });
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
        persistState({ prMetrics: { ...this.#prMetrics } }, '[DialogLoopManager] writeState prMetrics');
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

        if (this.#turnQueueDepth >= this.#maxQueueSize) {
            return Promise.reject(
                new SessionError(
                    `[DialogLoopManager] Fila cheia (${this.#turnQueueDepth}/${this.#maxQueueSize}).`,
                    'DIALOG_QUEUE_FULL',
                ),
            );
        }

        this.#watchdog?.ping();

        this.#turnQueueDepth++;
        const prev = this.#turnMutex;
        /** @type {Promise<string>} */
        const next = prev.then(() => this.#executeTurn(message, { timeout, ...(signal !== undefined && { signal }) }));
        this.#turnMutex = next.then(() => {}).catch(() => {});
        const myGen = ++this.#turnMutexGen;
        void next.finally(() => {
            this.#turnQueueDepth--;
            if (this.#turnQueueDepth === 0 && this.#turnMutexGen === myGen) {
                this.#turnMutex = Promise.resolve();
            }
        });
        return next;
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
            this.#turnMutex,
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
                void this.#turnMutex.then(() => {
                    clearTimeout(timer);
                    resolve(undefined);
                });
            }),
        ]);

        this.#active = false;
        this.#stopping = false;
        persistState({ dialogLoopActive: false }, '[DialogLoopManager] writeState dialogLoopActive=false');
        this.#watchdog?.stop();
        this.emit('stopped', { reason, authorized: true });
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
        this.emit('paused', { sessionId, pausedAt: Date.now() });
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
        const state = readState();
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
                persistState({ prMetrics: { ...this.#prMetrics } }, '[DialogLoopManager] writeState prMetrics');
                this.emit('resumed', { prConsumed: false });
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
                persistState({ prMetrics: { ...this.#prMetrics } }, '[DialogLoopManager] writeState prMetrics');
                this.emit('resumed', { prConsumed: false });
                return;
            }

            // Estratégia B: reenviar boot prompt (1 PR)
            log('INFO', '[DialogLoopManager] ask_user não encontrado — reenviando boot prompt (1 PR).');
            // G1-BUG-07 (fix): parar watchdog atual antes de start() para evitar dois watchdogs simultâneos.
            this.#watchdog?.stop();
            this.#watchdog = null;
            this.#active = false;
            await writeStateAsync({ dialogLoopActive: false }).catch(() => {});
            await this.start();
            // F41B.8: contabilizar resume com PR
            this.#prMetrics.resumesWithPR++;
            // F42.4: persistir prMetrics após resume com PR
            persistState({ prMetrics: { ...this.#prMetrics } }, '[DialogLoopManager] writeState prMetrics');
            this.emit('resumed', { prConsumed: true });
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
            this.emit('ready', {});
        } else if (kind === 'reply') {
            this.#watchdog?.ping();
            const reply = DialogProtocol.extractReply(question);
            this.emit('reply', { reply });
        } else if (kind === 'stopped') {
            log('WARN', '[DialogLoopManager] Modelo emitiu STOPPED — emitindo stopped para restart automático.');
            this.emit('stopped', { reason: 'model_stopped', authorized: false });
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
        // F42.3: reset completo do mutex pipeline — previne turns fantasma
        this.#turnMutex = Promise.resolve();
        this.#turnQueueDepth = 0;
        this.#turnMutexGen++;
        this.#watchdog?.stop();
        this.#watchdog = null;
        // G2-BUG-11: emitir 'stopped' para que o host receba notificação do encerramento forçado
        this.emit('stopped', { reason: 'force_deactivate', authorized: false });
        this.emit('changed', { active: false, ts: Date.now(), reason: 'force_deactivate' });
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
            this.emit('compaction.requested', { ratio, currentTokens, tokenLimit, urgency: 'critical' });
            return;
        }

        // F31.3: compaction proativa em 90%+
        if (ratio >= 90 && !this.#compactionRequested) {
            log('WARN', `[DialogLoopManager] F31.3: Token budget em ${ratio}% — compaction proativa solicitada.`);
            this.#compactionRequested = true;
            this.emit('compaction.requested', { ratio, currentTokens, tokenLimit, urgency: 'proactive' });
        }
    }

    /**
     * Reseta o flag de compaction solicitada (chamado após compaction concluída com sucesso).
     */
    resetCompactionFlag() {
        this.#compactionRequested = false;
    }

    // ────────────── Privado ──────────────

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

// ─── Event Wiring (absorvido de dialog-loop-wirer.js) ─────────────────────────

/**
 * Registra todos os listeners de forwarding de eventos no DialogLoopManager.
 *
 * Esta função deve ser chamada UMA ÚNICA VEZ por instância do agente (a classe-mãe controla a idempotência via flag
 * interno). Ela:
 *
 * 1. Chama `removeAllListeners()` para os eventos conhecidos do DLM.
 * 2. Registra um listener para cada evento relevante, encaminhando-o ao agente via `emitFn`.
 *
 * @param {DialogLoopManager} dialogLoop
 * @param {(event: string, payload: Record<string, unknown>) => void} emitFn - Função de emissão do agente host.
 * @returns {void}
 */
export function wireDialogLoopEvents(dialogLoop, emitFn) {
    const DLM_EVENTS = [
        'ready',
        'reply',
        'stopped',
        'paused',
        'resumed',
        'stalled',
        'turn_start',
        'turn_end',
        'turn_timeout',
        'changed',
        'model.fallback',
        'compaction.requested',
        'pre_stall_warning',
    ];
    for (const event of DLM_EVENTS) dialogLoop.removeAllListeners(event);

    dialogLoop.on('ready', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.ready', evt));
    dialogLoop.on('reply', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.reply', evt));
    dialogLoop.on('stopped', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.stopped', evt));
    dialogLoop.on('paused', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.paused', evt));
    dialogLoop.on('resumed', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.resumed', evt));
    dialogLoop.on('stalled', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.stalled', evt));
    dialogLoop.on('turn_start', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_start', evt));
    dialogLoop.on('turn_end', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_end', evt));
    dialogLoop.on('turn_timeout', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_timeout', evt));
    dialogLoop.on('changed', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.loop.changed', evt));
    dialogLoop.on('model.fallback', (/** @type {Record<string, unknown>} */ evt) => emitFn('pr.fallback_model', evt));
    dialogLoop.on('compaction.requested', (/** @type {Record<string, unknown>} */ evt) =>
        emitFn('dialog.compaction.requested', evt),
    );
    dialogLoop.on('pre_stall_warning', (/** @type {Record<string, unknown>} */ evt) =>
        emitFn('dialog.pre_stall_warning', evt),
    );
}
