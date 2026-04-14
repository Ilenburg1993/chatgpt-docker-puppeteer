// @ts-check
/**
 * src/copilot/agent/di-tokens.js — Tokens DI do módulo Agent.
 *
 * @module copilot/agent/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Agente AlwaysAlive (singleton gerenciado por DI).
 *
 * @type {import('../core/di.js').Token<import('./always-alive.js').AlwaysAliveAgent>}
 */
export const ALWAYS_ALIVE_AGENT = createToken('ALWAYS_ALIVE_AGENT');
