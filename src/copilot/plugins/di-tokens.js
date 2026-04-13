// @ts-check
/**
 * src/copilot/plugins/di-tokens.js — Tokens DI do módulo Plugins.
 *
 * @module copilot/plugins/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Registro de plugins dinâmicos.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const PLUGIN_REGISTRY = createToken('PLUGIN_REGISTRY');

/**
 * Registro de circuit breakers ativos.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const CIRCUIT_BREAKER_REGISTRY = createToken('CIRCUIT_BREAKER_REGISTRY');
