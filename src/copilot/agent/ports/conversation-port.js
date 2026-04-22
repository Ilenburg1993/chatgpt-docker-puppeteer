// @ts-check
/**
 * src/copilot/agent/ports/conversation-port.js
 *
 * Porta compatível entre o runtime do agent e `conversation-hub/`.
 *
 * @module copilot/agent/ports/conversation-port
 * @internal
 */

import { CONVERSATION_STORE } from '#copilot/conversation-hub';

/**
 * @param {import('../../core/di.js').Container} container
 * @returns {import('../../conversation-hub/store.js').ConversationStore | null}
 */
export function resolveConversationStore(container) {
    return /** @type {import('../../conversation-hub/store.js').ConversationStore | null} */ (
        container.resolve(CONVERSATION_STORE) ?? null
    );
}
