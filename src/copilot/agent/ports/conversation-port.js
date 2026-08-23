// @ts-check
/** Explicit Agent → Conversation Hub store capability boundary. @module copilot/agent/ports/conversation-port */
import { conversationStore } from '../../conversation-hub/store.js';
/** @returns {import('../../conversation-hub/store.js').ConversationStore} */
export function resolveConversationStore() {
    return conversationStore;
}
