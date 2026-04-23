// @ts-check
/**
 * @module copilot/agent/dialog/watchdog-supervisor
 * @file Supervisor fino do watchdog do dialog loop.
 *
 *   Centraliza criação, start/stop, ping e descarte do watchdog vivo. O manager continua decidindo quando cada transição
 *   acontece; o supervisor só governa a instância operacional.
 */

import { DialogWatchdog } from './watchdog.js';

/**
 * @typedef {{
 *     intervalMs: number;
 *     stallThresholdMs: number;
 *     onStall: (stalledMs: number) => void;
 *     onPreStallWarning: (stalledMs: number) => void;
 * }} DialogWatchdogSupervisorOptions
 */

/**
 * Supervisor da instância viva de DialogWatchdog.
 */
export class DialogWatchdogSupervisor {
    /** @type {DialogWatchdog | null} */
    #watchdog = null;

    /** @type {DialogWatchdogSupervisorOptions} */
    #options;

    /**
     * @param {DialogWatchdogSupervisorOptions} options
     */
    constructor(options) {
        this.#options = options;
    }

    /**
     * Inicia o watchdog, materializando uma instância se necessário.
     */
    start() {
        if (!this.#watchdog) {
            this.#watchdog = new DialogWatchdog({
                intervalMs: this.#options.intervalMs,
                stallThresholdMs: this.#options.stallThresholdMs,
                onStall: this.#options.onStall,
                onPreStallWarning: this.#options.onPreStallWarning,
            });
        }
        this.#watchdog.start();
    }

    /**
     * Pinga o watchdog vivo, se houver.
     */
    ping() {
        this.#watchdog?.ping();
    }

    /**
     * Para o watchdog vivo sem descartar a instância.
     */
    stop() {
        this.#watchdog?.stop();
    }

    /**
     * Para e descarta o watchdog vivo.
     */
    clear() {
        this.#watchdog?.stop();
        this.#watchdog = null;
    }
}
