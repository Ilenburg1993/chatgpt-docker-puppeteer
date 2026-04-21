// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-status
 * @file Façade canônica de leitura de status/health do runtime do agent.
 *
 *   Esta camada concentra o acesso às APIs públicas de snapshot do runtime (`getStatusSnapshot()` /
 *   `getHealthSnapshot()`) para que `presentation/` e outras bordas compartilhem um contrato estável sem depender do
 *   nome exato desses métodos em vários arquivos.
 */

/**
 * @typedef {import('../types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {Record<string, unknown>}
 */
export function readAgentRuntimeStatusSnapshot(agent) {
    return /** @type {Record<string, unknown>} */ (agent.getStatusSnapshot());
}

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../types.js').AgentHealthSnapshot | null}
 */
export function readAgentRuntimeHealthSnapshot(agent) {
    return typeof agent.getHealthSnapshot === 'function' ? agent.getHealthSnapshot() : null;
}

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {string}
 */
export function readAgentRuntimeStatusValue(agent) {
    const snap = readAgentRuntimeStatusSnapshot(agent);
    return typeof snap['status'] === 'string' ? snap['status'] : 'unknown';
}
