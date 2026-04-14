// @ts-check
/**
 * src/copilot/conversation-hub/di-tokens.js — Tokens DI do módulo Conversation Hub.
 *
 * @module copilot/conversation-hub/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * ConversationHub singleton.
 *
 * @type {import('../core/di.js').Token<import('./hub.js').ConversationHub>}
 */
export const HUB = createToken('HUB');

/**
 * Session RPC facade.
 *
 * @type {import('../core/di.js').Token<unknown>}
 */
export const SESSION_RPC = createToken('SESSION_RPC');

/**
 * Repositório de conversas (SQLite store ou in-memory).
 *
 * @type {import('../core/di.js').Token<import('./store.js').ConversationStore>}
 */
export const CONVERSATION_STORE = createToken('CONVERSATION_STORE');
