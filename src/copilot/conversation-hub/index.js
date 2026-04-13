// @ts-check
/**
 * src/copilot/conversation-hub/index.js
 *
 * Barrel export do módulo conversation-hub.
 *
 * @module copilot/conversation-hub
 * @see EventBus
 */

export { ConversationHub, conversationHub } from './hub.js';
export { HubOrchestrator } from './orchestrator.js';
export { broadcastGlobal, broadcastToSession, getCopilotNamespace, mountCopilotNamespace } from '../server/socket/hub-ns.js';
export { ConversationStore, conversationStore } from './store.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { CONVERSATION_STORE, HUB, SESSION_RPC, SOCKET_NAMESPACE } from './di-tokens.js';
