// @ts-check
/** Semantic errors owned by the Agent runtime. */
export class AgentSessionError extends Error {
    /** @param {string} message @param {string} [code='AGENT_SESSION_ERROR'] */
    constructor(message, code = 'AGENT_SESSION_ERROR') {
        super(message);
        this.name = 'AgentSessionError';
        this.code = code;
    }
}
