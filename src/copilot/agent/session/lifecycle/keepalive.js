// @ts-check
/**
 * src/copilot/agent/session/lifecycle/keepalive.js
 *
 * F42.2 (BUG-SD-001 fix): Previne expiração de sessão SDK por idle timeout (30 min).
 *
 * Envia heartbeat periódico quando o agente está idle e dialog loop não está ativo (o dialog loop já mantém a sessão
 * viva via `ask_user` pendente).
 *
 * @module copilot/agent/session/keepalive
 * @see EventBus
 */

import { cancelApplicationTimer, registerApplicationInterval } from '#copilot/boot/process-runtime';
import { KEEPALIVE_IDLE_THRESHOLD_MS, KEEPALIVE_INTERVAL_MS } from '#copilot/config/agent';
import { withAgentErrorPolicy } from '../../error/index.js';
import { log } from '../../ports/logging/index.js';

/**
 * @typedef {Object} SessionKeepaliveOptions
 * @property {number} [intervalMs] - Intervalo entre heartbeats (default: 10 min)
 * @property {number} [idleThresholdMs] - Tempo mínimo idle antes de enviar heartbeat (default: 20 min)
 */

/**
 * Gerencia heartbeats periódicos para manter sessões SDK vivas durante períodos de idle.
 */
export class SessionKeepalive {
    /** @type {ReturnType<typeof setInterval> | null} */
    #timer = null;

    /** @type {boolean} */
    #tickInFlight = false;

    /** @type {number} */
    #intervalMs;

    /** @type {number} */
    #idleThresholdMs;

    /** @type {number} */
    #lastActivityAt = Date.now();

    /** @type {boolean} */
    #running = false;

    /** @type {string | null} */
    #timerId = null;

    /**
     * @param {SessionKeepaliveOptions} [options]
     */
    constructor(options = {}) {
        this.#intervalMs = options.intervalMs ?? KEEPALIVE_INTERVAL_MS;
        this.#idleThresholdMs = options.idleThresholdMs ?? KEEPALIVE_IDLE_THRESHOLD_MS;
    }

    /**
     * Inicia o monitor de keepalive.
     *
     * @param {{
     *     performKeepalive: () => Promise<'client.ping' | 'session.send' | null>;
     *     isIdle: () => boolean;
     *     isDialogLoopActive: () => boolean;
     *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
     * }} callbacks
     */
    start(callbacks) {
        if (this.#running) return;
        this.#running = true;
        this.#lastActivityAt = Date.now();
        this.#timerId = `agent.session.keepalive:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        this.#timer = registerApplicationInterval(
            this.#timerId,
            () => {
                void this.#tick(callbacks);
            },
            this.#intervalMs,
        );
        this.#timer.unref();

        log(
            'INFO',
            `[SessionKeepalive] Iniciado (intervalo: ${this.#intervalMs}ms, idle threshold: ${this.#idleThresholdMs}ms).`,
        );
    }

    /**
     * Para o monitor de keepalive.
     */
    stop(reason = 'manual') {
        if (!this.#running) return;
        this.#running = false;
        this.#tickInFlight = false;
        if (this.#timer) {
            if (this.#timerId) cancelApplicationTimer(this.#timerId);
            this.#timer = null;
            this.#timerId = null;
        }
        log('INFO', `[SessionKeepalive] Parado (${reason}).`);
    }

    /**
     * Registra atividade recente (reseta o timer de idle). Deve ser chamado a cada sendMessage, sendDialogTurn, etc.
     */
    ping() {
        this.#lastActivityAt = Date.now();
    }

    /** @returns {boolean} */
    get running() {
        return this.#running;
    }

    /**
     * @param {{
     *     performKeepalive: () => Promise<'client.ping' | 'session.send' | null>;
     *     isIdle: () => boolean;
     *     isDialogLoopActive: () => boolean;
     *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
     * }} callbacks
     * @returns {Promise<void>}
     */
    async #tick(callbacks) {
        if (this.#tickInFlight) {
            return;
        }

        this.#tickInFlight = true;

        try {
            const { performKeepalive, isIdle, isDialogLoopActive, onKeepalive } = callbacks;

            // Dialog loop ativo mantém a sessão viva — não precisa de heartbeat
            if (isDialogLoopActive()) return;

            // Só envia heartbeat se está idle
            if (!isIdle()) {
                this.#lastActivityAt = Date.now();
                return;
            }

            // Verifica se idle o suficiente para enviar heartbeat
            const idleMs = Date.now() - this.#lastActivityAt;
            if (idleMs < this.#idleThresholdMs) return;

            const keepaliveResult = await withAgentErrorPolicy(() => performKeepalive(), {
                label: 'session.keepalive.tick',
                phase: 'keepalive',
                onError: (error) => {
                    log('WARN', `[SessionKeepalive] Heartbeat falhou: ${error.message}`);
                },
            });
            if (keepaliveResult.ok && keepaliveResult.value) {
                const strategy = keepaliveResult.value;
                this.#lastActivityAt = Date.now();
                log('DEBUG', `[SessionKeepalive] Heartbeat ${strategy} enviado (idle: ${Math.round(idleMs / 1000)}s).`);
                onKeepalive?.({ ts: Date.now(), strategy });
            }
        } finally {
            this.#tickInFlight = false;
        }
    }
}
