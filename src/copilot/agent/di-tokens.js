// @ts-check
/**
 * src/copilot/agent/di-tokens.js — Tokens DI do módulo Agent.
 *
 * @module copilot/agent/di-tokens
 */

import { createToken } from '#copilot/core';

/**
 * Agente AlwaysAlive (singleton gerenciado por DI).
 *
 * @type {import('../core/di.js').Token<import('./runtime/always-alive/index.js').AlwaysAliveAgent>}
 */
export const ALWAYS_ALIVE_AGENT = createToken('ALWAYS_ALIVE_AGENT');
