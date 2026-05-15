// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — entry point canônico para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b` e pelo processo PM2 `llm-b-terminal`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../boot/runtime-bootstrap.js';
import { log } from '../observability/logger.js';
import { handleTerminalBootFailure, registerTerminalShutdownSignals } from './bootstrap-lifecycle.js';
import { broadcastSse } from './dialog/index.js';
import { startDevWatch } from './dev-watch.js';
import * as terminal from './index.js';

/**
 * Adapta a surface SSE do terminal para o contrato genérico do boot.
 *
 * @param {string} event
 * @param {unknown} [payload]
 * @returns {void}
 */
function broadcastBootSse(event, payload) {
    const data = payload && typeof payload === 'object' ? payload : { value: payload ?? null };
    broadcastSse(event, data);
}

registerTerminalShutdownSignals();

if (typeof log.setConsoleLevel === 'function') {
    const consoleLevel = (
        process.env['COPILOT_TERMINAL_CONSOLE_LOG_LEVEL'] ??
        process.env['COPILOT_CONSOLE_LOG_LEVEL'] ??
        'WARN'
    ).toUpperCase();
    log.setConsoleLevel(/** @type {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} */ (consoleLevel));
}

bootCopilot({ terminal, broadcastSse: broadcastBootSse })
    .then(() => { startDevWatch(); })
    .catch((err) => void handleTerminalBootFailure(err));
