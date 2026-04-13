// @ts-check
/**
 * src/copilot/agent.js
 *
 * Thin entry point para o processo PM2 "copilot-sdk-agent".
 * Delega toda a inicialização para `bootstrap.js` com mode='agent'.
 *
 * Referenciado em `ecosystem.config.cjs` → `script: './src/copilot/agent.js'`.
 *
 * @module copilot/agent
 */

import { bootCopilot } from './bootstrap.js';

bootCopilot({ mode: 'agent' }).catch((/** @type {any} */ err) => {
    console.error('[copilot/agent] Fatal boot error:', err);
    process.exitCode = 1;
});
