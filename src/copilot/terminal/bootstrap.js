// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — entry point canônico para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b` e pelo processo PM2 `llm-b-terminal`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../bootstrap.js';
import { log } from '../observability/logger.js';
import { handleTerminalBootFailure, registerTerminalShutdownSignals } from './bootstrap-lifecycle.js';

registerTerminalShutdownSignals();

if (typeof log.setConsoleLevel === 'function') {
    const consoleLevel = (
        process.env['COPILOT_TERMINAL_CONSOLE_LOG_LEVEL'] ??
        process.env['COPILOT_CONSOLE_LOG_LEVEL'] ??
        'WARN'
    ).toUpperCase();
    log.setConsoleLevel(/** @type {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} */ (consoleLevel));
}

bootCopilot().catch((err) => void handleTerminalBootFailure(err));
