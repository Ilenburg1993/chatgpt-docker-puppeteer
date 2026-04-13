// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — Standalone entry point para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../bootstrap.js';

bootCopilot().catch((/** @type {any} */ err) => {
    console.error('[terminal/bootstrap] Falha fatal no boot:', err);
    process.exitCode = 1;
});
