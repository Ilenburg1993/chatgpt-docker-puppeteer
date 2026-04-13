// @ts-check
/**
 * src/copilot/channel/di-tokens.js — Tokens DI do módulo Channel.
 *
 * @module copilot/channel/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * InjectServer — servidor de injeção de prompts.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const INJECT_SERVER = createToken('INJECT_SERVER');
