// @ts-check
/**
 * src/copilot/agent.js
 *
 * @deprecated Use `terminal/bootstrap.js` como entry point canônico.
 * Este arquivo existe apenas para backwards compat com ecosystem.config.cjs.
 * Delega para bootCopilot() que agora executa sempre modo terminal.
 *
 * @module copilot/agent
 */

import { bootCopilot } from './bootstrap.js';

bootCopilot().catch((/** @type {any} */ err) => {
    console.error('[copilot/agent] Fatal boot error:', err);
    process.exitCode = 1;
});
