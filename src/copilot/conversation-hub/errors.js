// @ts-check
/** Semantic errors owned by Conversation Hub. */
export class ConversationHubError extends Error {
    /** @param {string} message @param {string} [code='CONVERSATION_HUB_ERROR'] */
    constructor(message, code = 'CONVERSATION_HUB_ERROR') {
        super(message);
        this.name = 'ConversationHubError';
        this.code = code;
    }
}
