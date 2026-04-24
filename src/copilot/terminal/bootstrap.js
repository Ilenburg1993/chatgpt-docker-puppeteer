// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — entry point canônico para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b` e pelo processo PM2 `llm-b-terminal`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../bootstrap.js';
import { runShutdown } from '../core/shutdown.js';
import { log } from '../observability/logger.js';

/** @type {boolean} */
let _terminalShutdownSignalsRegistered = false;

function registerTerminalShutdownSignals() {
    if (_terminalShutdownSignalsRegistered) return;
    /**
     * @param {string} signal
     * @returns {void}
     */
    const shutdown = (signal) => {
        log('INFO', `[terminal/bootstrap] ${signal} recebido — executando shutdown central.`);
        void runShutdown(signal).finally(() => {
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    if (!process.stdin.isTTY) {
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
    _terminalShutdownSignalsRegistered = true;
}

registerTerminalShutdownSignals();

bootCopilot().catch((err) => {
    console.error('[terminal/bootstrap] Falha fatal no boot:', err);
    process.exit(1);
});
