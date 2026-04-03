// @ts-check
/**
 * src/copilot/agent/dialog-loop-manager.js
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
 * @module copilot/agent/dialog-loop-manager
 * @see module:copilot/always-alive
 * @see module:copilot/agent/dialog-protocol
 * @see module:copilot/agent/dialog-watchdog
 */

import { getCopilotFallbackModel } from '#copilot/core/constants';
import { SessionError } from '#copilot/core/errors';
import { waitForEvent } from '#copilot/lib/event-helpers';
import { log } from '#copilot/observability/logger';
import EventEmitter from 'node:events';
import { DialogProtocol } from './dialog-protocol.js';
import { executeTurnImpl } from './dialog-turn-executor.js';
import { DialogWatchdog } from './dialog-watchdog.js';
import { readState, writeStateAsync } from './state-io.js';

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
 * @property {() => import('./always-alive.js').PendingQuestion | null} getPendingQuestion - Retorna a pergunta pendente
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

    /** @type {DialogWatchdog | null} */
    #watchdog = null;

    /** @type {boolean} */
    #pendingModelFallback = false;

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

    /**
     * @param {DialogLoopManagerOptions} [options]
     */
    constructor(options = {}) {
        super();
        this.#maxQueueSize = options.maxQueueSize ?? Number(process.env['LLM_B_DIALOG_QUEUE_MAX'] ?? 10);
        this.#bootTimeoutMs = options.bootTimeoutMs ?? Number(process.env['LLM_B_BOOT_TIMEOUT_MS'] ?? 30_000);
        this.#watchdogIntervalMs =
            options.watchdogIntervalMs ?? Number(process.env['LLM_B_WATCHDOG_MS'] ?? 5 * 60 * 1_000);
        this.#watchdogStallMs =
            options.watchdogStallMs ?? Number(process.env['LLM_B_WATCHDOG_STALL_MS'] ?? 15 * 60 * 1_000);
        this.#fallbackModel = options.fallbackModel ?? getCopilotFallbackModel();
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
     * Notifica o DLM que houve reconexão do agente.
     *
     * Desativa o flag `active` para que o mecanismo de restart da fila detecte a reconexão e reenvie a mensagem
     * pendente após a nova sessão ser estabelecida.
     */
    notifyReconnect() {
        if (this.#active) {
            this.#active = false;
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

        if (this.#active) {
            throw new SessionError(
                '[DialogLoopManager] Dialog loop já está ativo. Chame stop() primeiro.',
                'DIALOG_ALREADY_ACTIVE',
            );
        }

        this.#active = true;
        this.emit('changed', { active: true, ts: Date.now() });
        writeStateAsync({ dialogLoopActive: true }).catch((/** @type {any} */ e) =>
            log('WARN', `[DialogLoopManager] writeState dialogLoopActive=true: ${e.message}`),
        );

        // Aplica fallback de modelo se previamente agendado por `scheduleFallback()`.
        if (this.#pendingModelFallback && this.#fallbackModel) {
            const prev = this.#host.getModel();
            this.#pendingModelFallback = false;
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
        });
        this.#watchdog.start();

        // G2-ARCH-02: usar sendMessageDialogBoot() para evitar a heurística frágil timeoutMs===24h.
        // O boot prompt tem timeout muito longo pois o dialog loop não emite session.idle organicamente.
        const host = this.#host;
        const bootSendFn =
            typeof (/** @type {{ sendMessageDialogBoot?: Function }} */ (host).sendMessageDialogBoot) === 'function'
                ? /** @type {{ sendMessageDialogBoot: Function }} */ (host).sendMessageDialogBoot.bind(host)
                : (/** @type {string} */ msg, /** @type {{ timeoutMs?: number }} */ opts = {}) =>
                      host.sendMessage(msg, { ...opts, timeoutMs: 24 * 60 * 60 * 1000 });

        bootSendFn(metaPrompt, { timeoutMs: 24 * 60 * 60 * 1000 }).catch((/** @type {Error} */ e) => {
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

        // G2-ARCH-11: timeout de encerramento para o caso de um turno em andamento não terminar.
        const shutdownTimer = setTimeout(() => {
            if (this.#active) {
                log(
                    'WARN',
                    `[DialogLoopManager] stop() timeout após ${shutdownTimeoutMs}ms — forçando forceDeactivate().`,
                );
                this.forceDeactivate();
            }
        }, shutdownTimeoutMs);

        this.#active = false;
        this.#stopping = false;
        clearTimeout(shutdownTimer);
        writeStateAsync({ dialogLoopActive: false }).catch((/** @type {any} */ e) =>
            log('WARN', `[DialogLoopManager] writeState dialogLoopActive=false: ${e.message}`),
        );
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
        log('INFO', `[DialogLoopManager] Dialog loop pausado. SessionId: ${sessionId}.`);
        this.emit('paused', { sessionId, pausedAt: Date.now() });
    }

    /**
     * Retoma o dialog loop após pause. Estratégia A (0 PR) ou B (1 PR).
     *
     * @returns {Promise<void>}
     */
    async resume() {
        const state = readState();
        if (!state?.dialogPaused) {
            log('WARN', '[DialogLoopManager] resume() sem dialogPaused=true — ignorado.');
            return;
        }

        await writeStateAsync({ dialogPaused: false }).catch((/** @type {any} */ e) =>
            log('WARN', `[DialogLoopManager] writeState dialogPaused=false: ${e.message}`),
        );

        // Estratégia A: ask_user já disponível sincronicamente (0 PR, 0 espera)
        if (this.#host?.getPendingQuestion()) {
            log('INFO', '[DialogLoopManager] ask_user já disponível — retomada zero-PR imediata.');
            this.emit('resumed', { prConsumed: false });
            return;
        }

        // Estratégia A (async): aguardar ask_user preservado (0 PR)
        // G2-BUG-03: 'question.pending' é emitido pelo agente host (AlwaysAliveAgent),
        // não pelo DialogLoopManager — ouvir no host se ele for EventEmitter.
        const hostEmitter = /** @type {import('events').EventEmitter} */ (/** @type {unknown} */ (this.#host));
        const pendingTarget = typeof hostEmitter?.on === 'function' ? hostEmitter : this;
        const preserved = await waitForEvent(pendingTarget, 'question.pending', { timeoutMs: 5_000 })
            .then(() => true)
            .catch(() => false);

        if (preserved) {
            log('INFO', '[DialogLoopManager] ask_user preservado — retomada zero-PR.');
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
        this.emit('resumed', { prConsumed: true });
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
     */
    forceDeactivate() {
        this.#active = false;
        this.#watchdog?.stop();
        this.#watchdog = null;
        // G2-BUG-11: emitir 'stopped' para que o host receba notificação do encerramento forçado
        this.emit('stopped', { reason: 'force_deactivate', authorized: false });
        this.emit('changed', { active: false, ts: Date.now(), reason: 'force_deactivate' });
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
