// @ts-check
/**
 * @module copilot/presentation/agent-runtime
 * @file Accessor compartilhado do runtime do agent para bordas e projections comuns.
 *
 *   Esta camada evita que `terminal/` e `server/` precisem conhecer a topologia do singleton lazy + registry ao mesmo
 *   tempo. A regra daqui para frente é: bordas compartilham este accessor; a política real de runtime continua em
 *   `agent/`.
 */

import { getAgent } from '#copilot/agent/always-alive';
import { readRuntimeControlState } from '#copilot/agent/facades';
import {
    getDefaultRegisteredAgentRuntime,
    getRegisteredAgentRuntime,
    listAgentRuntimes,
    getDefaultAgentRuntimeId as readDefaultAgentRuntimeId,
} from '#copilot/agent/runtime-registry';
import { normalizeRuntimeId } from '../../routing/targeting.js';
import { AgentRuntimeNotFoundError } from '../errors.js';

/**
 * @typedef {import('#copilot/agent/always-alive').AlwaysAliveAgent} AgentRuntime
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
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntimeNotFoundError}
 */
export function createAgentRuntimeNotFoundError(runtimeId) {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId) ?? readDefaultAgentRuntimeId();
    return new AgentRuntimeNotFoundError(`Runtime '${normalizedRuntimeId}' não encontrado.`, 'AGENT_RUNTIME_NOT_FOUND');
}

/**
 * Resolve a seleção do runtime e lança quando um runtime explícito não existir.
 *
 * Superfícies operacionais/mutáveis devem preferir esta API para evitar fallback silencioso quando o chamador pediu um
 * runtime específico.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtime: AgentRuntime;
 *     runtimeFound: true;
 *     usedDefaultRuntimeFallback: false;
 *     defaultRuntimeId: string;
 * }}
 */
export function requireAgentRuntimeSelection(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    if (selection.requestedRuntimeId !== null && !selection.runtimeFound) {
        throw createAgentRuntimeNotFoundError(selection.requestedRuntimeId);
    }
    return {
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeId: selection.runtimeId,
        runtime: selection.runtime,
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
        defaultRuntimeId: selection.defaultRuntimeId,
    };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAgentRuntimeNotFoundError(error) {
    return error instanceof AgentRuntimeNotFoundError && error.code === 'AGENT_RUNTIME_NOT_FOUND';
}

/**
 * Retorna um runtime específico e lança se ele não existir.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {AgentRuntime}
 */
export function requireAgentRuntime(runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime;
}

/**
 * Lista runtimes conhecidos em formato seguro para projections compartilhadas.
 *
 * @returns {{
 *     runtimeId: string;
 *     status: string;
 *     model: string;
 *     sessionId: string | null;
 *     isDefault: boolean;
 *     agentProfileId: string | null;
 * }[]}
 */
export function listKnownAgentRuntimes() {
    const defaultRuntimeId = readDefaultAgentRuntimeId();
    return listAgentRuntimes().map(({ runtimeId, runtime, agentProfileId = null }) => {
        const state = readRuntimeControlState(runtime);
        return {
            runtimeId,
            status: state.status,
            model: state.model,
            sessionId: state.sessionId,
            isDefault: runtimeId === defaultRuntimeId,
            agentProfileId,
        };
    });
}

/** @param {string|null|undefined} [runtimeId] */
export function readAgentSessionBinding(runtimeId) {
    return resolveAgentRuntimeSelection(runtimeId).runtime.getSessionBindingSnapshot();
}

/** @param {string|null} hubSessionId @param {string|null|undefined} [runtimeId] */
export function setAgentHubSessionId(hubSessionId, runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime.setHubSessionId(hubSessionId);
}

/** @param {string|null} sdkSessionId @param {string|null|undefined} [runtimeId] */
export function setAgentSdkSessionId(sdkSessionId, runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime.setSdkSessionId(sdkSessionId);
}

/** @param {string|null|undefined} [runtimeId] */
export function clearAgentSdkSessionId(runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime.clearSdkSessionId();
}

/** @param {string|null|undefined} [runtimeId] */
export function clearAgentSessionBinding(runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime.clearSessionBinding();
}
