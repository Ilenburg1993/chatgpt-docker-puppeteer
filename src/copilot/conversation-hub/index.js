// @ts-check
/**
 * src/copilot/conversation-hub/index.js
 *
 * Barrel export do módulo conversation-hub.
 *
 * @module copilot/conversation-hub
 */

export { ConversationHub, conversationHub } from './hub.js';
export { HubOrchestrator } from './orchestrator.js';
export { broadcastGlobal, broadcastToSession, getCopilotNamespace, mountCopilotNamespace } from './socket-ns.js';
export { ConversationStore, conversationStore } from './store.js';
