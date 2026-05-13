// @ts-check
/**
 * @module copilot/presentation/runtime-sdk-session
 * @file Façade compartilhada das operações vanilla/advanced de sessão SDK por runtime.
 *
 *   Esta camada resolve `runtimeId`; a semântica operacional fica no Agent, depois do SDK.
 * @typedef {import('../contracts/index.js').RuntimeSdkModeResult} RuntimeSdkModeResult
 *
 * @typedef {import('../contracts/index.js').RuntimeSdkPlanReadResult} RuntimeSdkPlanReadResult
 *
 * @typedef {import('../contracts/index.js').RuntimeSessionCapabilities} RuntimeSessionCapabilities
 *
 * @typedef {import('../contracts/index.js').RuntimeInputOptions} RuntimeInputOptions
 *
 * @typedef {import('../contracts/index.js').RuntimeElicitationResult} RuntimeElicitationResult
 */

import {
    deleteAgentSdkPlan as deleteAgentSdkPlanOnAgent,
    readAgentSdkPlan as readAgentSdkPlanFromAgent,
    readAgentSdkSessionMode,
    setAgentSdkSessionMode as setAgentSdkSessionModeOnAgent,
    updateAgentSdkPlan as updateAgentSdkPlanOnAgent,
} from '#copilot/agent/facades';
import {
    buildSystemPromptPublicProjection,
    readSessionInstructionSources,
    readSystemPromptStatus,
} from '#copilot/config';
import { requireAgentRuntimeSelection } from '../agent/runtime/index.js';
import { readAgentStatusSnapshot } from './status.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('#copilot/agent').AlwaysAliveAgent}
 */
export function getAgentSdkSessionTarget(runtimeId) {
    return requireAgentRuntimeSelection(runtimeId).runtime;
}

/**
 * Resolve a sessão SDK viva hospedada pelo runtime do agent, em formato compatível com o registry de sessões do SDK.
 *
 * Este é o fallback usado por rotas HTTP quando a sessão permanente do AlwaysAlive ainda não está registrada no
 * `session-registry`, mas o runtime possui handles SDK válidos.
 *
 * @param {string | null | undefined} runtimeId
 * @param {string} sessionId
 * @returns {{
 *     session: NonNullable<ReturnType<import('#copilot/sdk').getClientSession>>['session'];
 *     model: string;
 *     createdAt: number;
 *     messagesCount: number;
 * } | null}
 */
export function resolveAgentSdkActiveSessionEntry(runtimeId, sessionId) {
    const agent = getAgentSdkSessionTarget(runtimeId);
    const snap = readAgentStatusSnapshot(agent);
    const agentSessionId = typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null;
    const handles =
        typeof (/** @type {{ getSdkHandles?: unknown }} */ (agent).getSdkHandles) === 'function'
            ? /** @type {{ session?: NonNullable<ReturnType<import('#copilot/sdk').getClientSession>>['session'] | null }} */ (
                  /** @type {{ getSdkHandles: () => unknown }} */ (agent).getSdkHandles()
              )
            : null;
    if (agentSessionId !== sessionId || !handles?.session) return null;

    const agentWithModel = /** @type {{ getModel?: () => string }} */ (/** @type {unknown} */ (agent));
    return {
        session: handles.session,
        model:
            typeof snap['model'] === 'string'
                ? snap['model']
                : typeof agentWithModel.getModel === 'function'
                  ? agentWithModel.getModel()
                  : 'unknown',
        createdAt: Date.now(),
        messagesCount: 0,
    };
}

/**
 * Lê a projeção canônica do system prompt para o runtime alvo, incluindo o status local do prompt modular e as
 * instruction sources da sessão SDK viva quando disponíveis.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     systemPrompt: Awaited<ReturnType<typeof readSystemPromptStatus>>;
 *     binding: Record<string, unknown> | null;
 *     freshness: Record<string, unknown> | null;
 *     sessionId: string | null;
 *     sessionAvailable: boolean;
 *     instructionSources: unknown | null;
 *     instructionSourcesError: string | null;
 *     projection: Record<string, unknown>;
 * }>}
 */
export async function readAgentSdkSystemPromptProjection(runtimeId) {
    const agent = getAgentSdkSessionTarget(runtimeId);
    const snap = readAgentStatusSnapshot(agent);
    const sessionId = typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null;
    const binding =
        snap['systemPromptBinding'] && typeof snap['systemPromptBinding'] === 'object'
            ? /** @type {Record<string, unknown>} */ (snap['systemPromptBinding'])
            : null;
    const freshness =
        snap['systemPromptFreshness'] && typeof snap['systemPromptFreshness'] === 'object'
            ? /** @type {Record<string, unknown>} */ (snap['systemPromptFreshness'])
            : null;
    const handles =
        typeof (/** @type {{ getSdkHandles?: unknown }} */ (agent).getSdkHandles) === 'function'
            ? /** @type {{ session?: import('#copilot/sdk/types').CopilotSession | null }} */ (
                  /** @type {{ getSdkHandles: () => unknown }} */ (agent).getSdkHandles()
              )
            : null;
    const session = handles?.session ?? null;
    const systemPrompt = await readSystemPromptStatus();

    if (!session) {
        const projection = buildSystemPromptPublicProjection({
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: false,
            instructionSources: null,
            instructionSourcesError: null,
        });
        return {
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: false,
            instructionSources: null,
            instructionSourcesError: null,
            projection,
        };
    }

    try {
        const instructionSources = await readSessionInstructionSources(session);
        const projection = buildSystemPromptPublicProjection({
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: true,
            instructionSources,
            instructionSourcesError: null,
        });
        return {
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: true,
            instructionSources,
            instructionSourcesError: null,
            projection,
        };
    } catch (error) {
        const instructionSourcesError = error instanceof Error ? error.message : String(error);
        const projection = buildSystemPromptPublicProjection({
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: true,
            instructionSources: null,
            instructionSourcesError,
        });
        return {
            systemPrompt,
            binding,
            freshness,
            sessionId,
            sessionAvailable: true,
            instructionSources: null,
            instructionSourcesError,
            projection,
        };
    }
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {RuntimeSessionCapabilities}
 */
export function getAgentSdkSessionCapabilities(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).getSdkSessionCapabilities();
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function isAgentSdkSessionUiElicitationAvailable(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).isSdkSessionUiElicitationAvailable();
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkModeResult>}
 */
export async function getAgentSdkSessionMode(runtimeId) {
    return readAgentSdkSessionMode(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkModeResult>}
 */
export async function setAgentSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionModeOnAgent(getAgentSdkSessionTarget(runtimeId), mode);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<RuntimeSdkPlanReadResult>}
 */
export async function readAgentSdkPlan(runtimeId) {
    return readAgentSdkPlanFromAgent(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateAgentSdkPlan(content, runtimeId) {
    return updateAgentSdkPlanOnAgent(getAgentSdkSessionTarget(runtimeId), content);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteAgentSdkPlan(runtimeId) {
    return deleteAgentSdkPlanOnAgent(getAgentSdkSessionTarget(runtimeId));
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkModels(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkModels();
}

/**
 * @param {{ model?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkTools(options, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkBuiltInTools(options);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getAgentSdkQuota(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).getSdkQuota();
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkWorkspaceFiles(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkWorkspaceFiles();
}

/**
 * @param {string} path
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readAgentSdkWorkspaceFile(path, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).readSdkWorkspaceFile(path);
}

/**
 * @param {string} path
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function createAgentSdkWorkspaceFile(path, content, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).createSdkWorkspaceFile(path, content);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function compactAgentSdkSession(runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).compactSdkSession();
}

/**
 * @param {string} message
 * @param {object} requestedSchema
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function requestAgentSdkElicitation(message, requestedSchema, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).requestSdkElicitation(message, requestedSchema);
}

/**
 * @param {string} message
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<boolean>}
 */
export async function confirmAgentSdkSessionUi(message, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).confirmSdkSessionUi(message);
}

/**
 * @param {string} message
 * @param {string[]} options
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function selectAgentSdkSessionUi(message, options, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).selectSdkSessionUi(message, options);
}

/**
 * @param {string} message
 * @param {RuntimeInputOptions | undefined} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function inputAgentSdkSessionUi(message, options, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).inputSdkSessionUi(message, options);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @param {{ sessionId?: string }} [options]
 * @returns {ReturnType<import('#copilot/agent').AlwaysAliveAgent['listPendingSdkElicitations']>}
 */
export function listAgentSdkPendingElicitations(runtimeId, options = {}) {
    return getAgentSdkSessionTarget(runtimeId).listPendingSdkElicitations(options);
}

/**
 * @param {string} id
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<import('#copilot/agent').AlwaysAliveAgent['getPendingSdkElicitation']>}
 */
export function getAgentSdkPendingElicitation(id, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).getPendingSdkElicitation(id);
}

/**
 * @param {string} id
 * @param {RuntimeElicitationResult} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function resolveAgentSdkPendingElicitation(id, result, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).resolvePendingSdkElicitation(id, result);
}

/**
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function handleAgentSdkPendingPermission(requestId, result, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).handleSdkPendingPermission(requestId, result);
}

/**
 * Lista permissões pendentes via RPC quando a sessão suporta listagem ativa.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
 */
export async function listAgentSdkPendingPermissions(runtimeId) {
    const target = getAgentSdkSessionTarget(runtimeId);
    if (typeof target.listPendingSdkPermissions !== 'function') {
        return { available: false, source: null, requests: [] };
    }
    return target.listPendingSdkPermissions();
}
