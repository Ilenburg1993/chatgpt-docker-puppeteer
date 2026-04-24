// @ts-check
/**
 * src/copilot/agent.js
 *
 * Entry point operacional de compatibilidade. Delega para bootCopilot(), que executa o modo terminal-runtime canônico.
 * Novas automações devem iniciar `src/copilot/terminal/bootstrap.js` diretamente.
 *
 * @module copilot/agent
 */

import { COPILOT_CANONICAL_BOOT_ENTRYPOINT, COPILOT_COMPAT_PM2_ENV_FLAG } from '#copilot/boot';
import { bootCopilot } from './bootstrap.js';

console.warn(
    `[copilot/agent] Entry point compatível. Use ${COPILOT_CANONICAL_BOOT_ENTRYPOINT}; ` +
        `PM2 compat deve ser opt-in via ${COPILOT_COMPAT_PM2_ENV_FLAG}=true.`,
);

bootCopilot().catch((err) => {
    console.error('[copilot/agent] Fatal boot error:', err);
    process.exitCode = 1;
});
