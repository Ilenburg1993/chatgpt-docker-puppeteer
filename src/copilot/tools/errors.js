// @ts-check
/** Tools-runtime configuration/contract errors. */
export class ToolRuntimeError extends Error {
    /** @param {string} message @param {string} [code='TOOL_RUNTIME_ERROR'] */
    constructor(message, code = 'TOOL_RUNTIME_ERROR') {
        super(message);
        this.name = 'ToolRuntimeError';
        this.code = code;
    }
}
