// @ts-check
/**
 * src/copilot/hooks/di-tokens.js — Tokens DI do módulo Hooks.
 *
 * @module copilot/hooks/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Logger injetável para o módulo hooks.
 *
 * @type {import('../core/di.js').Token<import('../core/di-tokens.js').CopilotLogger>}
 */
export const HOOKS_LOGGER = createToken('HOOKS_LOGGER');
