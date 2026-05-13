// @ts-check
/**
 * @module copilot/agent/dialog/boot/loop-boot-circuit
 * @file Governança de circuit breaker do boot do dialog loop.
 */

import { SessionError } from '#copilot/core';
import { log } from '../../ports/index.js';

const BOOT_FAILURE_CIRCUIT_WINDOW_MS = 120_000;
const BOOT_FAILURE_CIRCUIT_COOLDOWN_MS = 60_000;
const BOOT_FAILURE_CIRCUIT_MAX_FAILURES = 3;

/**
 * Circuit breaker local do boot do dialog loop.
 *
 * A responsabilidade aqui é somente governar storms de boot/retry. Efeitos operacionais como persistência, watchdog e
 * eventos continuam no boot runner/manager.
 */
export class DialogBootCircuit {
    /** @type {number[]} */
    #failureTimestamps = [];

    /** @type {number} */
    #openUntil = 0;

    /**
     * @returns {void}
     * @throws {SessionError}
     */
    assertClosed() {
        const now = Date.now();
        if (this.#openUntil > now) {
            const waitMs = this.#openUntil - now;
            throw new SessionError(
                `[DialogLoopManager] Circuit breaker de boot aberto por ${waitMs}ms após ${BOOT_FAILURE_CIRCUIT_MAX_FAILURES} falhas recentes.`,
                'DIALOG_BOOT_CIRCUIT_OPEN',
            );
        }
        if (this.#openUntil > 0) {
            this.#openUntil = 0;
            this.#failureTimestamps = [];
        }
    }

    /**
     * Registra uma falha de boot dentro da janela móvel.
     *
     * @returns {void}
     */
    recordFailure() {
        const now = Date.now();
        const windowStart = now - BOOT_FAILURE_CIRCUIT_WINDOW_MS;
        this.#failureTimestamps = [...this.#failureTimestamps.filter((ts) => ts >= windowStart), now];
        if (this.#failureTimestamps.length >= BOOT_FAILURE_CIRCUIT_MAX_FAILURES) {
            this.#openUntil = now + BOOT_FAILURE_CIRCUIT_COOLDOWN_MS;
            log(
                'WARN',
                `[DialogLoopManager] Circuit breaker de boot aberto por ${BOOT_FAILURE_CIRCUIT_COOLDOWN_MS}ms após ${this.#failureTimestamps.length} falhas.`,
            );
        }
    }

    /**
     * Limpa a janela de falhas após boot bem-sucedido.
     *
     * @returns {void}
     */
    recordSuccess() {
        this.#failureTimestamps = [];
        this.#openUntil = 0;
    }
}
