// @ts-check
/** Errors emitted by external/internal bridge adapters. */
export class BridgeError extends Error {
    /** @param {string} message @param {string} [code='BRIDGE_ERROR'] */
    constructor(message, code = 'BRIDGE_ERROR') {
        super(message);
        this.name = 'BridgeError';
        this.code = code;
    }
}
