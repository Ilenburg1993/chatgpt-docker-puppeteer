// @ts-check
/**
 * src/copilot/agent/session/keepalive.js
 *
 * F42.2 (BUG-SD-001 fix): Previne expiração de sessão SDK por idle timeout (30 min).
 *
 * Envia heartbeat periódico quando o agente está idle e dialog loop não está ativo (o dialog loop já mantém a sessão
 * viva via `ask_user` pendente).
 *
 * @module copilot/agent/session/keepalive
 * @see EventBus
 */

import { KEEPALIVE_IDLE_THRESHOLD_MS, KEEPALIVE_INTERVAL_MS } from '../../config/agent.js';
import { withAgentErrorPolicy } from '../error-policy.js';
import { log } from '../ports/observability-port.js';

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
     *     getSession: () => { send?: (opts: { prompt: string }) => Promise<unknown> } | null;
     *     getClient?: () => { ping?: () => Promise<unknown> } | null;
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
    stop(reason = 'manual') {
        if (!this.#running) return;
        this.#running = false;
        this.#tickInFlight = false;
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
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
     *     getSession: () => { send?: (opts: { prompt: string }) => Promise<unknown> } | null;
     *     getClient?: () => { ping?: () => Promise<unknown> } | null;
     *     isIdle: () => boolean;
     *     isDialogLoopActive: () => boolean;
     *     onKeepalive?: (ts: number) => void;
     * }} callbacks
     * @returns {Promise<void>}
     */
    async #tick(callbacks) {
        if (this.#tickInFlight) {
            return;
        }

        this.#tickInFlight = true;

        try {
            const { getSession, getClient, isIdle, isDialogLoopActive, onKeepalive } = callbacks;

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

            // M-02 (PARTE-8): usar client.ping() (0 PR) como primeiro recurso de keepalive.
            // Apenas faz fallback para session.send() se ping() não estiver disponível.
            const client = getClient?.();
            const clientPing = client?.ping;
            if (typeof clientPing === 'function') {
                const pingResult = await withAgentErrorPolicy(() => clientPing.call(client), {
                    label: 'session.keepalive.ping',
                    phase: 'keepalive',
                    onError: (error) => {
                        log(
                            'WARN',
                            `[SessionKeepalive] Ping keepalive falhou: ${error.message} — tentando session.send()`,
                        );
                    },
                });
                if (pingResult.ok) {
                    this.#lastActivityAt = Date.now();
                    log(
                        'DEBUG',
                        `[SessionKeepalive] Ping keepalive (0 PR) enviado (idle: ${Math.round(idleMs / 1000)}s).`,
                    );
                    onKeepalive?.(Date.now());
                    return;
                }
            }

            // Fallback: session.send() consome 1 PR, mas garante que a sessão não expire
            const session = getSession();
            const sessionSend = session?.send;
            if (typeof sessionSend !== 'function') return;

            const sendResult = await withAgentErrorPolicy(() => sessionSend.call(session, { prompt: '[keepalive]' }), {
                label: 'session.keepalive.send',
                phase: 'keepalive',
                onError: (error) => {
                    log('WARN', `[SessionKeepalive] Heartbeat falhou: ${error.message}`);
                },
            });
            if (sendResult.ok) {
                this.#lastActivityAt = Date.now();
                log('DEBUG', `[SessionKeepalive] Heartbeat send (1 PR) enviado (idle: ${Math.round(idleMs / 1000)}s).`);
                onKeepalive?.(Date.now());
            }
        } finally {
            this.#tickInFlight = false;
        }
    }
}
