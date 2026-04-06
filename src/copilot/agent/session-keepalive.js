// @ts-check
/**
 * src/copilot/agent/session-keepalive.js
 *
 * F42.2 (BUG-SD-001 fix): Previne expiração de sessão SDK por idle timeout (30 min).
 *
 * Envia heartbeat periódico quando o agente está idle e dialog loop não está ativo (o dialog loop já mantém a sessão
 * viva via `ask_user` pendente).
 *
 * @module copilot/agent/session-keepalive
 */

import { log } from '#copilot/observability/logger';

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

    /** @type {number} */
    #intervalMs;

    /** @type {number} */
    #idleThresholdMs;

    /** @type {number} */
    #lastActivityAt = Date.now();

    /** @type {boolean} */
    #running = false;

    /**
     * @param {SessionKeepaliveOptions} [options]
     */
    constructor(options = {}) {
        this.#intervalMs = options.intervalMs ?? Number(process.env['AGENT_KEEPALIVE_MS'] || 10 * 60_000);
        this.#idleThresholdMs =
            options.idleThresholdMs ?? Number(process.env['AGENT_KEEPALIVE_IDLE_MS'] || 20 * 60_000);
    }

    /**
     * Inicia o monitor de keepalive.
     *
     * @param {{
     *     getSession: () => { send?: (opts: { prompt: string }) => Promise<unknown> } | null;
     *     isIdle: () => boolean;
     *     isDialogLoopActive: () => boolean;
     *     onKeepalive?: (ts: number) => void;
     * }} callbacks
     */
    start(callbacks) {
        if (this.#running) return;
        this.#running = true;
        this.#lastActivityAt = Date.now();

        this.#timer = setInterval(() => {
            void this.#tick(callbacks);
        }, this.#intervalMs);
        this.#timer.unref();

        log(
            'INFO',
            `[SessionKeepalive] Iniciado (intervalo: ${this.#intervalMs}ms, idle threshold: ${this.#idleThresholdMs}ms).`,
        );
    }

    /**
     * Para o monitor de keepalive.
     */
    stop() {
        if (!this.#running) return;
        this.#running = false;
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
        log('INFO', '[SessionKeepalive] Parado.');
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
     *     getSession: () => { send?: (opts: { prompt: string }) => Promise<unknown> } | null;
     *     isIdle: () => boolean;
     *     isDialogLoopActive: () => boolean;
     *     onKeepalive?: (ts: number) => void;
     * }} callbacks
     * @returns {Promise<void>}
     */
    async #tick(callbacks) {
        const { getSession, isIdle, isDialogLoopActive, onKeepalive } = callbacks;

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

        const session = getSession();
        if (!session || typeof session.send !== 'function') return;

        try {
            // Heartbeat mínimo para resetar o idle timeout do SDK
            await session.send({ prompt: '[keepalive]' });
            this.#lastActivityAt = Date.now();
            log('DEBUG', `[SessionKeepalive] Heartbeat enviado (idle: ${Math.round(idleMs / 1000)}s).`);
            onKeepalive?.(Date.now());
        } catch (/** @type {any} */ e) {
            log('WARN', `[SessionKeepalive] Heartbeat falhou: ${e.message}`);
        }
    }
}
