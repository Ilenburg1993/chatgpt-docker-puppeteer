// @ts-check
/**
 * src/copilot/conversation-hub/index.js
 *
 * Barrel export do módulo conversation-hub.
 *
 * @module copilot/conversation-hub
 * @see EventBus
 */

// Faixa-3.1: broadcast functions vivem em conversation-hub (server injeta o namespace via setCopilotNamespace)
export { broadcastGlobal, broadcastToSession, setCopilotNamespace } from './broadcast.js';
// Nota: getCopilotNamespace e mountCopilotNamespace são concerns do server layer — importar de #copilot/server
export {
    authorizeHubSessionAction,
    createHubAccessPrincipal,
    deriveHubSessionAccessPolicy,
    parseHubSessionMetadata,
} from './access.js';
export { ConversationHub, conversationHub } from './hub.js';
export { HubOrchestrator } from './orchestrator.js';
export { ConversationStore, conversationStore } from './store.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { CONVERSATION_STORE, HUB, SESSION_RPC } from './di-tokens.js';
