// @ts-check
/**
 * @module copilot/agent/runtime/status-readers
 * @file Leitores internos canônicos de status/health do runtime do agent.
 *
 *   Módulo interno neutro para evitar acoplamento cruzado entre facades de query/projection.
 */

/**
 * Agent compatível com leitura pública de status/health.
 *
 * @typedef {import('../types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * Lê o snapshot público de status e normaliza para `Record<string, unknown>`.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {Record<string, unknown>}
 */
export function readAgentRuntimeStatusSnapshot(agent) {
    if (typeof agent.getStatusSnapshot !== 'function') {
        const compat = /** @type {Record<string, unknown>} */ (agent);
        return {
            status: typeof compat['status'] === 'string' ? compat['status'] : 'unknown',
            sessionId: typeof compat['sessionId'] === 'string' ? compat['sessionId'] : null,
            model: typeof compat['model'] === 'string' ? compat['model'] : 'unknown',
            reasoningEffort: typeof compat['reasoningEffort'] === 'string' ? compat['reasoningEffort'] : undefined,
            queueSize: typeof compat['queueSize'] === 'number' ? compat['queueSize'] : 0,
            pendingQuestion: compat['pendingQuestion'] ?? null,
            isResumed: Boolean(compat['isResumed']),
            resumeCount: Number(compat['resumeCount'] ?? 0),
            sendCount: Number(compat['sendCount'] ?? 0),
            startedAt: typeof compat['startedAt'] === 'number' ? compat['startedAt'] : null,
            contextWindow: compat['contextWindow'] ?? compat['contextState'] ?? null,
            lastCheckpointPath: typeof compat['lastCheckpointPath'] === 'string' ? compat['lastCheckpointPath'] : null,
            permissionMode: compat['permissionMode'] ?? 'approve_all',
        };
    }
    const snap = /** @type {Record<string, unknown>} */ (agent.getStatusSnapshot());
    const compat = /** @type {Record<string, unknown>} */ (agent);
    return {
        ...snap,
        ...(snap['status'] === undefined && typeof compat['status'] === 'string' ? { status: compat['status'] } : {}),
        ...(snap['sessionId'] === undefined && typeof compat['sessionId'] === 'string'
            ? { sessionId: compat['sessionId'] }
            : {}),
        ...(snap['model'] === undefined && typeof compat['model'] === 'string' ? { model: compat['model'] } : {}),
        ...(snap['reasoningEffort'] === undefined && typeof compat['reasoningEffort'] === 'string'
            ? { reasoningEffort: compat['reasoningEffort'] }
            : {}),
        ...(snap['queueSize'] === undefined && typeof compat['queueSize'] === 'number'
            ? { queueSize: compat['queueSize'] }
            : {}),
    };
}

/**
 * Lê health quando o runtime oferece essa capability.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../types.js').AgentHealthSnapshot | null}
 */
export function readAgentRuntimeHealthSnapshot(agent) {
    return typeof agent.getHealthSnapshot === 'function' ? agent.getHealthSnapshot() : null;
}

/**
 * Lê cobertura de recursos SDK acoplada ao runtime quando a capability existe.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../types.js').AgentSdkAccessSnapshot | null}
 */
export function readAgentRuntimeSdkResourceSnapshot(agent) {
    return typeof agent.getSdkResourceSnapshot === 'function' ? agent.getSdkResourceSnapshot() : null;
}

/**
 * Extrai o status textual de forma defensiva para projections e logs.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {string}
 */
export function readAgentRuntimeStatusValue(agent) {
    const snap = readAgentRuntimeStatusSnapshot(agent);
    return typeof snap['status'] === 'string' ? snap['status'] : 'unknown';
}
