// @ts-check
/**
 * src/copilot/agent.js
 *
 * PM2 entry point — referenciado por ecosystem.config.cjs. Delega para bootCopilot() que executa o modo terminal.
 *
 * @module copilot/agent
 */

import { bootCopilot } from './bootstrap.js';

bootCopilot().catch((err) => {
    console.error('[copilot/agent] Fatal boot error:', err);
    process.exitCode = 1;
});
