// @ts-check
/**
 * src/copilot/tools/infra/di-tokens.js — Tokens DI do módulo Tools.
 *
 * @module copilot/tools/infra/di-tokens
 */

import { createToken } from '#copilot/core';

/**
 * Logger injetável para o módulo tools.
 *
 * @type {import('#copilot/core/di').Token<import('#copilot/core/di-tokens').CopilotLogger>}
 */
export const TOOLS_LOGGER = createToken('TOOLS_LOGGER');

/**
 * Métricas proxy injetável para o módulo tools.
 *
 * @type {import('#copilot/core/di').Token<{
 *     getSummary: () => object;
 *     getToolStats: () => object;
 *     recordToolCall: Function;
 * }>}
 */
export const TOOLS_METRICS = createToken('TOOLS_METRICS');
