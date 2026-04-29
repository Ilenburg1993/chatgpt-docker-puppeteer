// @ts-check
/**
 * src/copilot/terminal/bootstrap.js — entry point canônico para o Terminal Permanente LLM-B.
 *
 * Invocado por `npm run terminal:llm-b` e pelo processo PM2 `llm-b-terminal`.
 *
 * @module copilot/terminal/bootstrap
 */

import { bootCopilot } from '../bootstrap.js';
import { handleTerminalBootFailure, registerTerminalShutdownSignals } from './bootstrap-lifecycle.js';

registerTerminalShutdownSignals();

bootCopilot().catch((err) => void handleTerminalBootFailure(err));
