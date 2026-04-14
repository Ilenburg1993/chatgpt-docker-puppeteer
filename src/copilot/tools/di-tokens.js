// @ts-check
/**
 * src/copilot/tools/di-tokens.js — Tokens DI do módulo Tools.
 *
 * @module copilot/tools/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Logger injetável para o módulo tools.
 *
 * @type {import('../core/di.js').Token<import('../core/di-tokens.js').CopilotLogger>}
 */
export const TOOLS_LOGGER = createToken('TOOLS_LOGGER');

/**
 * Métricas proxy injetável para o módulo tools.
 *
 * @type {import('../core/di.js').Token<{
 *     getSummary: () => object;
 *     getToolStats: () => object;
 *     recordToolCall: Function;
 * }>}
 */
export const TOOLS_METRICS = createToken('TOOLS_METRICS');
