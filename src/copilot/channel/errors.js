// @ts-check
/** Errors of the local LLM bridge/channel protocol. */
export class ChannelError extends Error {
    /** @param {string} message @param {string} [code='CHANNEL_ERROR'] */
    constructor(message, code = 'CHANNEL_ERROR') {
        super(message);
        this.name = 'ChannelError';
        this.code = code;
    }
}
