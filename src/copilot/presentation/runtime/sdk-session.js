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
 * @typedef {import('../contracts/index.js').RuntimeCopilotSession} RuntimeCopilotSession
 *
 * @typedef {import('../contracts/index.js').RuntimeInputOptions} RuntimeInputOptions
 *
 * @typedef {import('../contracts/index.js').RuntimeElicitationResult} RuntimeElicitationResult
 */

import {
    deleteAgentSdkPlan as deleteAgentSdkPlanOnAgent,
    persistAgentRuntimeStatePartial,
    readAgentConfiguredSessionFsState,
    readAgentRuntimePersistedStateAsync,
    readAgentSdkPlan as readAgentSdkPlanFromAgent,
    readAgentSdkSessionMode,
    readSdkSkillsGovernance as readSdkSkillsGovernanceOnAgent,
    setAgentSdkSessionMode as setAgentSdkSessionModeOnAgent,
    setSdkDisabledSkills as setSdkDisabledSkillsOnAgent,
    updateAgentSdkPlan as updateAgentSdkPlanOnAgent,
} from '#copilot/agent/facades';
import {
    buildSystemPromptPublicProjection,
    readSessionInstructionSources,
    readSystemPromptStatus,
} from '#copilot/config';
import { toError } from '#copilot/core';
import { requireAgentRuntimeSelection } from '#copilot/presentation/agent/runtime';
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
 *     session: RuntimeCopilotSession;
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
            ? /** @type {{ session?: RuntimeCopilotSession | null }} */ (
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
 * @param {unknown} value
 * @returns {Record<string, Record<string, unknown>>}
 */
function readSdkSessionLocalMetadataMap(value) {
    if (!value || typeof value !== 'object') return {};
    /** @type {Record<string, Record<string, unknown>>} */
    const out = {};
    for (const [sessionId, metadata] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        if (typeof sessionId !== 'string' || !metadata || typeof metadata !== 'object') continue;
        out[sessionId] = { .../** @type {Record<string, unknown>} */ (metadata) };
    }
    return out;
}

/**
 * @param {Record<string, unknown> | null} state
 * @param {string | null} currentSessionId
 * @param {Record<string, unknown> | null} persistedByokBinding
 * @param {Record<string, unknown> | null} lastBootDecision
 * @returns {Record<string, Record<string, unknown>>}
 */
function buildRuntimeSdkSessionLocalMetadata(state, currentSessionId, persistedByokBinding, lastBootDecision) {
    const map = readSdkSessionLocalMetadataMap(state ? Reflect.get(state, 'sdkSessionLocalMetadata') : null);
    if (currentSessionId && !map[currentSessionId]) {
        map[currentSessionId] = {
            sessionId: currentSessionId,
            updatedAt: Date.now(),
            ...(typeof state?.['model'] === 'string' ? { model: state['model'] } : {}),
            ...(persistedByokBinding ? { provider: { kind: 'byok', ...persistedByokBinding } } : {}),
            ...(lastBootDecision ? { boundary: { ...lastBootDecision } } : {}),
        };
    }
    return map;
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
            ? /** @type {{ session?: RuntimeCopilotSession | null }} */ (
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
        const instructionSources = await readSessionInstructionSources(
            /** @type {Parameters<typeof readSessionInstructionSources>[0]} */ (/** @type {unknown} */ (session)),
        );
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
        const instructionSourcesError = toError(error).message;
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
 * Lê projeção canônica de governança de skills do runtime alvo.
 *
 * @param {{ projectPaths?: string[]; skillDirectories?: string[] }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readAgentSdkSkillsGovernance(options, runtimeId) {
    return readSdkSkillsGovernanceOnAgent(getAgentSdkSessionTarget(runtimeId), options);
}

/**
 * Atualiza a lista server-scoped de `disabledSkills` do runtime alvo.
 *
 * @param {string[]} disabledSkills
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function setAgentSdkDisabledSkills(disabledSkills, runtimeId) {
    return setSdkDisabledSkillsOnAgent(getAgentSdkSessionTarget(runtimeId), disabledSkills);
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
 * Lê o cockpit mínimo de sessões SDK do runtime alvo.
 *
 * @param {string | null | undefined} [runtimeId]
 * @param {import('../contracts/index.js').RuntimeSessionListFilter} [filter]
 * @param {{ enrichOffset?: number; enrichLimit?: number }} [options]
 * @returns {Promise<{
 *     currentSessionId: string | null;
 *     lastSessionId: string | null;
 *     foregroundSessionId: string | null;
 *     persistedByokBinding: Record<string, unknown> | null;
 *     lastBootDecision: Record<string, unknown> | null;
 *     sessionFs: Awaited<ReturnType<typeof readAgentConfiguredSessionFsState>>;
 *     sessions: Array<
 *         import('../contracts/index.js').RuntimeSessionMetadata & {
 *             localMetadata?: Record<string, unknown> | null;
 *             sessionFs?: Awaited<ReturnType<typeof readAgentConfiguredSessionFsState>>;
 *         }
 *     >;
 * }>}
 */
export async function listAgentSdkSessionInventory(runtimeId, filter, options = {}) {
    const agent = getAgentSdkSessionTarget(runtimeId);
    const snap = readAgentStatusSnapshot(agent);
    const [lastSessionId, foregroundSessionId, sessions, state] = await Promise.all([
        agent.getLastSdkSessionId(),
        agent.getForegroundSdkSessionId(),
        agent.listSdkSessions(filter),
        readAgentRuntimePersistedStateAsync(),
    ]);
    const persistedByokBinding =
        state?.byokSessionBinding && typeof state.byokSessionBinding === 'object'
            ? /** @type {Record<string, unknown>} */ (state.byokSessionBinding)
            : null;
    const lastBootDecision =
        state?.sdkSessionBootDecision && typeof state.sdkSessionBootDecision === 'object'
            ? /** @type {Record<string, unknown>} */ (state.sdkSessionBootDecision)
            : null;
    const currentSessionId = typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null;
    const localMetadata = buildRuntimeSdkSessionLocalMetadata(
        state && typeof state === 'object' ? /** @type {Record<string, unknown>} */ (state) : null,
        currentSessionId,
        persistedByokBinding,
        lastBootDecision,
    );
    const sessionFs = await readAgentConfiguredSessionFsState(currentSessionId);
    const enrichOffset =
        typeof options.enrichOffset === 'number' && Number.isFinite(options.enrichOffset)
            ? Math.max(0, Math.trunc(options.enrichOffset))
            : 0;
    const enrichLimit =
        typeof options.enrichLimit === 'number' && Number.isFinite(options.enrichLimit)
            ? Math.max(1, Math.min(100, Math.trunc(options.enrichLimit)))
            : 25;
    const enrichedSessions = await Promise.all(
        sessions.map(async (session, index) => {
            const base = {
                ...session,
                localMetadata: localMetadata[session.sessionId] ?? null,
            };
            if (
                session.sessionId !== currentSessionId &&
                (index < enrichOffset || index >= enrichOffset + enrichLimit)
            ) {
                return base;
            }
            return {
                ...base,
                sessionFs: await readAgentConfiguredSessionFsState(session.sessionId),
            };
        }),
    );
    return {
        currentSessionId,
        lastSessionId: typeof lastSessionId === 'string' ? lastSessionId : null,
        foregroundSessionId: typeof foregroundSessionId === 'string' ? foregroundSessionId : null,
        persistedByokBinding,
        lastBootDecision,
        sessionFs,
        sessions: enrichedSessions,
    };
}

/**
 * Remove uma sessão SDK persistida por meio do runtime alvo.
 *
 * @param {string} sessionId
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function deleteAgentSdkSession(sessionId, runtimeId) {
    const target = getAgentSdkSessionTarget(runtimeId);
    if (typeof target.deleteSdkSession !== 'function') {
        throw new TypeError('AGENT_SDK_DELETE_SESSION_UNAVAILABLE');
    }
    await target.deleteSdkSession(sessionId);
}

/**
 * @returns {Promise<
 *     | { mode: 'new'; requestedAt?: number | null }
 *     | { mode: 'resume'; sessionId: string; requestedAt?: number | null }
 *     | null
 * >}
 */
export async function readAgentSdkSessionBootSelection() {
    const state = await readAgentRuntimePersistedStateAsync();
    const raw = state && typeof state === 'object' ? Reflect.get(state, 'nextSdkSessionBoot') : null;
    if (!raw || typeof raw !== 'object') return null;
    const mode = Reflect.get(raw, 'mode');
    const requestedAt = Reflect.get(raw, 'requestedAt');
    if (mode === 'new') {
        return { mode, requestedAt: typeof requestedAt === 'number' ? requestedAt : null };
    }
    const sessionId = Reflect.get(raw, 'sessionId');
    if (mode === 'resume' && typeof sessionId === 'string' && sessionId.trim()) {
        return {
            mode,
            sessionId: sessionId.trim(),
            requestedAt: typeof requestedAt === 'number' ? requestedAt : null,
        };
    }
    return null;
}

/**
 * Agenda a escolha de sessão SDK para o próximo boot do runtime permanente.
 *
 * A sessão viva atual não é trocada por este comando; a diretiva é consumida no initializer para manter attach/resume
 * com uma única autoridade.
 *
 * @param {{ mode: 'new' } | { mode: 'resume'; sessionId: string } | null} selection
 * @returns {Promise<
 *     import('../../agent/error/index.js').AgentPolicyResult<
 *         import('../../agent/lifecycle/state/index.js').AliveAgentState
 *     >
 * >}
 */
export async function scheduleAgentSdkSessionBootSelection(selection) {
    if (
        selection &&
        selection.mode === 'resume' &&
        (typeof selection.sessionId !== 'string' || selection.sessionId.trim().length === 0)
    ) {
        throw new TypeError('[runtime/sdk-session] selection.sessionId deve ser string não-vazia.');
    }
    return persistAgentRuntimeStatePartial(
        {
            nextSdkSessionBoot: selection
                ? {
                      ...selection,
                      ...(selection.mode === 'resume' ? { sessionId: selection.sessionId.trim() } : {}),
                      requestedAt: Date.now(),
                  }
                : null,
        },
        { label: 'sdk.session.next_boot_selection' },
    );
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
 * @param {{ projectPaths?: string[]; skillDirectories?: string[] }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listAgentSdkSkills(options, runtimeId) {
    return getAgentSdkSessionTarget(runtimeId).listSdkSkills(options);
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
export async function getAgentSdkUsageMetrics(runtimeId) {
    const target = getAgentSdkSessionTarget(runtimeId);
    if (typeof target.getSdkUsageMetrics !== 'function') {
        throw new TypeError('AGENT_SDK_USAGE_METRICS_UNAVAILABLE');
    }
    return target.getSdkUsageMetrics();
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

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function resetAgentSdkSessionApprovals(runtimeId) {
    const target = getAgentSdkSessionTarget(runtimeId);
    if (typeof target.resetSdkSessionApprovals !== 'function') {
        throw new TypeError('AGENT_SDK_RESET_SESSION_APPROVALS_UNAVAILABLE');
    }
    return target.resetSdkSessionApprovals();
}

/**
 * @param {string} serverName
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function loginAgentSdkMcpOauth(serverName, runtimeId) {
    const target = getAgentSdkSessionTarget(runtimeId);
    if (typeof target.loginSdkMcpOauth !== 'function') {
        throw new TypeError('AGENT_SDK_MCP_OAUTH_LOGIN_UNAVAILABLE');
    }
    return target.loginSdkMcpOauth(serverName);
}
