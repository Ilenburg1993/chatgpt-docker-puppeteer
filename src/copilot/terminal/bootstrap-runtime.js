// @ts-check
/**
 * Heavy runtime body for the permanent LLM-B terminal.
 *
 * Imported dynamically by bootstrap.js only after dotenv and the Node compile cache are initialized.
 *
 * @module copilot/terminal/bootstrap-runtime
 */

import { bootCopilot } from '../boot/runtime-bootstrap.js';
import { log } from '../observability/logger.js';
import { handleTerminalBootFailure, registerTerminalShutdownSignals } from './bootstrap-lifecycle.js';
import { startDevWatch } from './dev-watch.js';
import { broadcastSse } from './dialog/index.js';
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
        'ERROR'
    ).toUpperCase();
    log.setConsoleLevel(/** @type {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} */ (consoleLevel));
}

bootCopilot({ terminal, broadcastSse: broadcastBootSse })
    .then(() => {
        startDevWatch();
    })
    .catch((err) => void handleTerminalBootFailure(err));
