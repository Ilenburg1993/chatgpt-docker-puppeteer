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
 * @type {import('../core/di.js').Token<object>}
 */
export const HUB = createToken('HUB');

/**
 * Namespace Socket.IO para comunicação real-time.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const SOCKET_NAMESPACE = createToken('SOCKET_NAMESPACE');

/**
 * Session RPC facade.
 *
 * @type {import('../core/di.js').Token<unknown>}
 */
export const SESSION_RPC = createToken('SESSION_RPC');

/**
 * Repositório de conversas (SQLite store ou in-memory).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const CONVERSATION_STORE = createToken('CONVERSATION_STORE');
