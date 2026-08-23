// @ts-check
/**
 * Helpers de lifecycle do entrypoint `terminal/bootstrap.js`.
 *
 * Mantém a borda executável pequena e testável: registro de sinais e falha fatal de boot continuam pertencendo ao
 * entrypoint, mas a política fica isolada de efeitos colaterais no import.
 *
 * @module copilot/terminal/bootstrap-lifecycle
 * @internal
 */

import { runApplicationShutdown } from '#copilot/boot/process-runtime';
import { toError } from '#copilot/infra/public/platform/error';
import { log } from '../observability/logger.js';

/** @type {boolean} */
let terminalShutdownSignalsRegistered = false;

/**
 * @typedef {{
 *     on: (event: string, listener: (...args: unknown[]) => void) => unknown;
 *     stdin?: { isTTY?: boolean };
 *     exit: (code?: number) => never;
 * }} ProcessLike
 */

/**
 * @param {{
 *     processLike?: ProcessLike;
 *     runApplicationShutdownFn?: (reason?: string) => Promise<void>;
 *     logFn?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void;
 * }} [deps]
 * @returns {void}
 */
export function registerTerminalShutdownSignals(deps = {}) {
    if (terminalShutdownSignalsRegistered) return;
    const processLike = deps.processLike ?? process;
    const runApplicationShutdownFn = deps.runApplicationShutdownFn ?? runApplicationShutdown;
    const logFn = deps.logFn ?? log;

    /**
     * @param {string} signal
     * @returns {void}
     */
    const shutdown = (signal) => {
        logFn('INFO', `[terminal/bootstrap] ${signal} recebido — executando shutdown central.`);
        void runApplicationShutdownFn(signal).finally(() => {
            processLike.exit(0);
        });
    };

    processLike.on('SIGTERM', () => shutdown('SIGTERM'));
    if (!processLike.stdin?.isTTY) {
        processLike.on('SIGINT', () => shutdown('SIGINT'));
    }
    terminalShutdownSignalsRegistered = true;
}

/**
 * Executa cleanup central antes de encerrar uma falha fatal de boot.
 *
 * @param {unknown} error
 * @param {{
 *     runApplicationShutdownFn?: (reason?: string) => Promise<void>;
 *     errorFn?: (...args: unknown[]) => void;
 *     logFn?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void;
 *     exitFn?: (code?: number) => never;
 * }} [deps]
 * @returns {Promise<never>}
 */
export async function handleTerminalBootFailure(error, deps = {}) {
    const runApplicationShutdownFn = deps.runApplicationShutdownFn ?? runApplicationShutdown;
    const errorFn = deps.errorFn ?? console.error;
    const logFn = deps.logFn ?? log;
    const exitFn = deps.exitFn ?? ((code = 1) => process.exit(code));

    errorFn('[terminal/bootstrap] Falha fatal no boot:', error);
    try {
        await runApplicationShutdownFn('boot_failure');
    } catch (shutdownError) {
        logFn(
            'WARN',
            `[terminal/bootstrap] Shutdown central falhou após boot failure: ${toError(shutdownError).message}`,
        );
    }
    exitFn(1);
    throw new Error('[terminal/bootstrap] process.exit retornou inesperadamente após falha fatal de boot.');
}

/**
 * @returns {void}
 */
export function resetTerminalBootstrapLifecycleForTests() {
    terminalShutdownSignalsRegistered = false;
}

/**
 * @returns {boolean}
 */
export function isTerminalShutdownSignalsRegistered() {
    return terminalShutdownSignalsRegistered;
}
