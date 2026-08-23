// @ts-check
/** UI-state projection errors. */
export class UiStateError extends Error {
    /** @param {string} message @param {string} [code='UI_STATE_ERROR'] */
    constructor(message, code = 'UI_STATE_ERROR') {
        super(message);
        this.name = 'UiStateError';
        this.code = code;
    }
}
