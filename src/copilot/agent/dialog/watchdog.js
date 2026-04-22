// @ts-check
/**
 * @module copilot/agent/dialog/watchdog
 * @file DialogWatchdog — monitor de inatividade do dialog loop.
 *
 *   Detecta quando o dialog loop fica inativo por mais que o limiar configurado e dispara o callback `onStall`. Extraído
 *   de `always-alive.js` para isolar a lógica de temporização e facilitar testes.
 * @see EventBus
 * @see module:copilot/agent/dialog/loop-manager
 */

import { WATCHDOG_THRESHOLDS } from '../../config/agent.js';
import { log } from '../ports/observability-port.js';

/**
 * @typedef {Object} DialogWatchdogOptions
 * @property {number} intervalMs - Intervalo de verificação em ms (padrão: `LLM_B_WATCHDOG_MS`, 5 min)
 * @property {number} stallThresholdMs - Limiar de inatividade para emitir stall em ms (padrão:
 *   `LLM_B_WATCHDOG_STALL_MS`, 15 min)
 * @property {(stalledMs: number) => void} onStall - Callback chamado quando o loop está travado
 */

// Re-export para backward compatibility (consumidores existentes que importam de watchdog.js)
export { WATCHDOG_THRESHOLDS };

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
 * // ao começar tarefa de análise longa:
 * watchdog.setThreshold(WATCHDOG_THRESHOLDS.analysis);
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

    /** @type {((stalledMs: number) => void) | null} F41B.7: callback de aviso pré-stall */
    #onPreStallWarning = null;

    /** @type {boolean} F41B.7: flag para evitar múltiplos avisos pré-stall no mesmo ciclo */
    #preStallEmitted = false;

    /** @type {ReturnType<typeof setInterval> | null} */
    #timer = null;

    /** @type {number} */
    #lastActivity = 0;

    /**
     * @param {DialogWatchdogOptions & { onPreStallWarning?: (stalledMs: number) => void }} opts
     */
    constructor({ intervalMs, stallThresholdMs, onStall, onPreStallWarning }) {
        this.#intervalMs = intervalMs;
        this.#stallThresholdMs = stallThresholdMs;
        this.#onStall = onStall;
        this.#onPreStallWarning = onPreStallWarning ?? null;
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
        this.#preStallEmitted = false;
        this.#timer = setInterval(() => {
            const stalledMs = Date.now() - this.#lastActivity;
            // F41B.7: aviso pré-stall a 80% do threshold
            if (!this.#preStallEmitted && this.#onPreStallWarning && stalledMs > this.#stallThresholdMs * 0.8) {
                this.#preStallEmitted = true;
                log(
                    'WARN',
                    `[DialogWatchdog] Pré-stall: loop inativo há ${Math.round(stalledMs / 1000)}s (80% do threshold)`,
                );
                this.#onPreStallWarning(stalledMs);
            }
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
        this.#preStallEmitted = false;
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

    /**
     * F8.3: Ajusta o threshold de stall em runtime sem reiniciar o watchdog. Útil para escalar o timeout conforme o
     * tipo de tarefa em andamento.
     *
     * @param {number} thresholdMs - Novo threshold em ms
     * @returns {void}
     */
    setThreshold(thresholdMs) {
        if (typeof thresholdMs === 'number' && thresholdMs > 0) {
            this.#stallThresholdMs = thresholdMs;
            log('DEBUG', `[DialogWatchdog] stallThreshold atualizado para ${thresholdMs}ms`);
        }
    }

    /**
     * F8.3: Ajusta o threshold de stall por tipo de tarefa nomeado (see WATCHDOG_THRESHOLDS). Ignora tipos
     * desconhecidos (mantém threshold atual).
     *
     * @param {string} taskType - Tipo de tarefa (ex: 'analysis', 'simple', 'codegen')
     * @returns {void}
     */
    setTaskType(taskType) {
        const threshold = /** @type {number} */ (
            WATCHDOG_THRESHOLDS[taskType] ?? WATCHDOG_THRESHOLDS['default'] ?? 15 * 60_000
        );
        this.setThreshold(threshold);
        log('INFO', `[DialogWatchdog] Tipo de tarefa="${taskType}" → threshold=${threshold}ms`);
    }

    /**
     * Retorna o threshold de stall atual em ms.
     *
     * @returns {number}
     */
    get stallThresholdMs() {
        return this.#stallThresholdMs;
    }
}
