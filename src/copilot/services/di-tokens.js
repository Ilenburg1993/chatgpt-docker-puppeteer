// @ts-check
/**
 * src/copilot/services/di-tokens.js — Tokens DI do módulo Services.
 *
 * @module copilot/services/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Service de gerenciamento de sessões de agente.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const SESSION_SERVICE = createToken('SESSION_SERVICE');

/**
 * Service de conversas (orquestração de criação/busca/remoção).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const CONVERSATION_SERVICE = createToken('CONVERSATION_SERVICE');

/**
 * Service de agente (operações sobre AlwaysAliveAgent via services/).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const AGENT_SERVICE = createToken('AGENT_SERVICE');

/**
 * Service de diálogo (via services/).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const DIALOG_SERVICE = createToken('DIALOG_SERVICE');
