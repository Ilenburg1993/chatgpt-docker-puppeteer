// @ts-check
/**
 * src/copilot/bridges/di-tokens.js — Tokens DI do módulo Bridges.
 *
 * @module copilot/bridges/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Agent ponte para LLM bridge client.
 *
 * @type {import('../core/di.js').Token<import('../agent/always-alive.js').AlwaysAliveAgent>}
 */
export const BRIDGE_AGENT = createToken('BRIDGE_AGENT');

/**
 * Agent fallback para orchestrator.
 *
 * @type {import('../core/di.js').Token<import('../agent/always-alive.js').AlwaysAliveAgent>}
 */
export const FALLBACK_AGENT = createToken('FALLBACK_AGENT');

/**
 * Agent de permissões.
 *
 * @type {import('../core/di.js').Token<import('../agent/always-alive.js').AlwaysAliveAgent>}
 */
export const PERMISSION_AGENT = createToken('PERMISSION_AGENT');

/**
 * Agent para NERV event bus adapter (AlwaysAliveAgent-like).
 *
 * @type {import('../core/di.js').Token<import('../agent/always-alive.js').AlwaysAliveAgent>}
 */
export const NERV_BRIDGE_AGENT = createToken('NERV_BRIDGE_AGENT');
