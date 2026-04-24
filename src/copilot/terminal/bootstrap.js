// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — entry point canônico para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b` e pelo processo PM2 `llm-b-terminal`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../bootstrap.js';

bootCopilot().catch((err) => {
    console.error('[terminal/bootstrap] Falha fatal no boot:', err);
    process.exit(1);
});
