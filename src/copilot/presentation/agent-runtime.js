// @ts-check
/**
 * @module copilot/presentation/agent-runtime
 * @file Accessor compartilhado do runtime do agent para bordas e projections comuns.
 *
 *   Esta camada evita que `terminal/` e `server/` precisem conhecer a topologia do singleton lazy + registry ao mesmo
 *   tempo. A regra daqui para frente é: bordas compartilham este accessor; a política real de runtime continua em
 *   `agent/`.
 */

import {
    getAgent,
    getDefaultRegisteredAgentRuntime,
    getRegisteredAgentRuntime,
    listAgentRuntimes,
    getDefaultAgentRuntimeId as readDefaultAgentRuntimeId,
} from '#copilot/agent';

/**
 * @typedef {import('../agent/always-alive.js').AlwaysAliveAgent} AgentRuntime
 */

/**
 * Retorna o runtime default do agent, inicializando-o lazy quando ainda não houver registro explícito.
 *
 * @returns {AgentRuntime}
 */
export function getDefaultAgentRuntime() {
    return getDefaultRegisteredAgentRuntime() ?? getAgent();
}

/**
 * Retorna o id do runtime default atualmente configurado.
 *
 * @returns {string}
 */
export function getDefaultAgentRuntimeId() {
    return readDefaultAgentRuntimeId();
}

/**
 * Retorna um runtime específico quando registrado, ou o runtime default quando nenhum id é informado.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime | null}
 */
export function getAgentRuntime(runtimeId) {
    if (!runtimeId || runtimeId === readDefaultAgentRuntimeId()) {
        return getDefaultAgentRuntime();
    }
    return getRegisteredAgentRuntime(runtimeId);
}

/**
 * Retorna um runtime específico e lança se ele não existir.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime}
 */
export function requireAgentRuntime(runtimeId) {
    const runtime = getAgentRuntime(runtimeId);
    if (!runtime) {
        throw new Error(`AGENT_RUNTIME_NOT_FOUND:${runtimeId ?? readDefaultAgentRuntimeId()}`);
    }
    return runtime;
}

/**
 * Lista runtimes conhecidos em formato seguro para projections compartilhadas.
 *
 * @returns {{ runtimeId: string; status: string; model: string; sessionId: string | null; isDefault: boolean }[]}
 */
export function listKnownAgentRuntimes() {
    const defaultRuntimeId = readDefaultAgentRuntimeId();
    return listAgentRuntimes().map(({ runtimeId, runtime }) => ({
        runtimeId,
        status: String(runtime.status ?? 'unknown'),
        model: String(runtime.model ?? 'unknown'),
        sessionId: runtime.sessionId ?? null,
        isDefault: runtimeId === defaultRuntimeId,
    }));
}
