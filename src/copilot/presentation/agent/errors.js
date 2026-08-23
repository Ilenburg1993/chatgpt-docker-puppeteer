// @ts-check
/** Presentation errors for agent runtime selection. */
export class AgentRuntimeNotFoundError extends Error {
    /** @param {string} message @param {string} [code='AGENT_RUNTIME_NOT_FOUND'] */
    constructor(message, code = 'AGENT_RUNTIME_NOT_FOUND') {
        super(message);
        this.name = 'AgentRuntimeNotFoundError';
        this.code = code;
        this.status = 404;
    }
}
