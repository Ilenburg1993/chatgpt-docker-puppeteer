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
import { readRuntimeControlState } from '../agent/facades/agent-runtime-controls.js';
import { normalizeRuntimeId } from './runtime-targeting.js';

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
 * Resolve o `runtimeId` explícito ou cai para o default atual.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {string}
 */
export function resolveAgentRuntimeId(runtimeId) {
    return normalizeRuntimeId(runtimeId) ?? readDefaultAgentRuntimeId();
}

/**
 * Retorna um runtime específico quando registrado, ou o runtime default quando nenhum id é informado.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime | null}
 */
export function getAgentRuntime(runtimeId) {
    const resolvedRuntimeId = normalizeRuntimeId(runtimeId);
    if (!resolvedRuntimeId || resolvedRuntimeId === readDefaultAgentRuntimeId()) {
        return getDefaultAgentRuntime();
    }
    return getRegisteredAgentRuntime(resolvedRuntimeId);
}

/**
 * Retorna um runtime específico quando registrado ou o runtime default quando o id não existir/for omitido.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime}
 */
export function getAgentRuntimeOrDefault(runtimeId) {
    return getAgentRuntime(runtimeId) ?? getDefaultAgentRuntime();
}

/**
 * Resolve a seleção efetiva do runtime, tornando explícito quando um `runtimeId` pedido caiu em fallback.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtime: AgentRuntime;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     defaultRuntimeId: string;
 * }}
 */
export function resolveAgentRuntimeSelection(runtimeId) {
    const defaultRuntimeId = readDefaultAgentRuntimeId();
    const requestedRuntimeId = normalizeRuntimeId(runtimeId);
    const explicitRuntime = requestedRuntimeId ? getRegisteredAgentRuntime(requestedRuntimeId) : null;
    const runtimeFound = requestedRuntimeId ? explicitRuntime !== null : true;
    const usedDefaultRuntimeFallback = requestedRuntimeId !== null && explicitRuntime === null;
    return {
        requestedRuntimeId,
        runtimeId: runtimeFound ? (requestedRuntimeId ?? defaultRuntimeId) : defaultRuntimeId,
        runtime: explicitRuntime ?? getDefaultAgentRuntime(),
        runtimeFound,
        usedDefaultRuntimeFallback,
        defaultRuntimeId,
    };
}

/**
 * Retorna um runtime específico e lança se ele não existir.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime}
 */
export function requireAgentRuntime(runtimeId) {
    const runtime = getAgentRuntime(runtimeId);
    const resolvedRuntimeId = resolveAgentRuntimeId(runtimeId);
    if (!runtime) {
        throw new Error(`AGENT_RUNTIME_NOT_FOUND:${resolvedRuntimeId}`);
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
    return listAgentRuntimes().map(({ runtimeId, runtime }) => {
        const state = readRuntimeControlState(runtime);
        return {
            runtimeId,
            status: state.status,
            model: state.model,
            sessionId: state.sessionId,
            isDefault: runtimeId === defaultRuntimeId,
        };
    });
}
