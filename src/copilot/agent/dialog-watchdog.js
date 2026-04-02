// @ts-check
/**
 * @module copilot/agent/dialog-watchdog
 * @file DialogWatchdog — monitor de inatividade do dialog loop.
 *
 *   Detecta quando o dialog loop fica inativo por mais que o limiar configurado e dispara o callback `onStall`. Extraído
 *   de `always-alive.js` para isolar a lógica de temporização e facilitar testes.
 * @see module:copilot/agent/dialog-loop-manager
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {Object} DialogWatchdogOptions
 * @property {number} intervalMs - Intervalo de verificação em ms (padrão: `LLM_B_WATCHDOG_MS`, 5 min)
 * @property {number} stallThresholdMs - Limiar de inatividade para emitir stall em ms (padrão:
 *   `LLM_B_WATCHDOG_STALL_MS`, 15 min)
 * @property {(stalledMs: number) => void} onStall - Callback chamado quando o loop está travado
 */

/**
 * Monitor de inatividade para o dialog loop.
 *
 * Exemplo de uso:
 *
 * ```js
 * const watchdog = new DialogWatchdog({
 *     intervalMs: 5 * 60_000,
 *     stallThresholdMs: 15 * 60_000,
 *     onStall: (ms) => agent.emit('dialog.stalled', { stalledMs: ms }),
 * });
 * watchdog.start();
 * // ao receber atividade:
 * watchdog.ping();
 * // ao parar o loop:
 * watchdog.stop();
 * ```
 */
export class DialogWatchdog {
    /** @type {number} */
    #intervalMs;

    /** @type {number} */
    #stallThresholdMs;

    /** @type {(stalledMs: number) => void} */
    #onStall;

    /** @type {ReturnType<typeof setInterval> | null} */
    #timer = null;

    /** @type {number} */
    #lastActivity = 0;

    /**
     * @param {DialogWatchdogOptions} opts
     */
    constructor({ intervalMs, stallThresholdMs, onStall }) {
        this.#intervalMs = intervalMs;
        this.#stallThresholdMs = stallThresholdMs;
        this.#onStall = onStall;
    }

    /**
     * Inicia o watchdog. Registra o momento atual como lastActivity.
     *
     * @returns {void}
     */
    start() {
        // Guard: evita dois intervalos simultâneos se start() for chamado duas vezes.
        if (this.#timer !== null) {
            log('WARN', '[DialogWatchdog] start() chamado com watchdog já ativo — ignorando.');
            return;
        }
        this.#lastActivity = Date.now();
        this.#timer = setInterval(() => {
            const stalledMs = Date.now() - this.#lastActivity;
            if (stalledMs > this.#stallThresholdMs) {
                log('WARN', `[DialogWatchdog] Dialog loop inativo há ${Math.round(stalledMs / 1000)}s`);
                this.#onStall(stalledMs);
            }
        }, this.#intervalMs);
    }

    /**
     * Atualiza o timestamp de última atividade (reset do contador de inatividade).
     *
     * @returns {void}
     */
    ping() {
        this.#lastActivity = Date.now();
    }

    /**
     * Para o watchdog e limpa o timer.
     *
     * @returns {void}
     */
    stop() {
        if (this.#timer !== null) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }

    /**
     * Indica se o watchdog está em execução.
     *
     * @returns {boolean}
     */
    get running() {
        return this.#timer !== null;
    }
}
