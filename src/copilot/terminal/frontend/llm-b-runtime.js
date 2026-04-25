// @ts-check
/**
 * @file Gateway runtime do terminal como frontend principal da LLM-B.
 *
 *   Centraliza o consumo explícito das SSOTs operacionais já existentes (`agent/`, `channel/` e `conversation-hub/`) para
 *   que `repl`, `dialog/*`, `terminal-agent-wiring` e `index.js` não continuem reabrindo DI/container e integrações
 *   transversais em cada arquivo.
 */

import { llmBridgeClient } from '#copilot/channel';
import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { getSharedSessionBinding } from '#copilot/core';
import {
    abortAgentRuntimeCurrentMessage,
    answerAgentPendingQuestion,
    clearAgentPendingQuestionShadow,
    createAgentRuntimeSnapshot,
    listAgentRuntimeSnapshots,
    loadAgentRuntimeSnapshot,
    offAgentRuntimeEvent,
    onAgentRuntimeEvent,
    onceAgentRuntimeEvent,
    pauseAgentDialogLoop,
    pingDefaultAgentDialogWatchdog,
    readAgentHandoffHistory,
    readAgentRuntimeControlState,
    resumeAgentDialogLoop,
    saveAgentRuntimeSnapshot,
    startAgentRuntime,
    stopAgentRuntimeDialogLoopAuthorized,
} from '../../presentation/runtime-controls.js';
import { readAgentRuntimeOverviewProjection } from '../../presentation/runtime-overview.js';
import {
    compactAgentSdkSession,
    createAgentSdkWorkspaceFile,
    deleteAgentSdkPlan,
    getAgentSdkQuota,
    getAgentSdkSessionMode,
    listAgentSdkModels,
    listAgentSdkTools,
    listAgentSdkWorkspaceFiles,
    readAgentSdkPlan,
    readAgentSdkWorkspaceFile,
    requestAgentSdkElicitation,
    setAgentSdkSessionMode,
    updateAgentSdkPlan,
} from '../../presentation/runtime-sdk-session.js';

/**
 * Lê o estado mínimo do runtime para exibição/streaming no terminal.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     runtimeId: string;
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('../../presentation/types.js').RuntimePendingQuestion | null;
 *     pendingQuestionKind: import('../../presentation/types.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadow: import('../../presentation/types.js').RuntimePendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('../../presentation/types.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowState: import('../../presentation/types.js').RuntimePendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     contextWindow: { tokens: number; tokenLimit: number; utilization: number } | null;
 *     lastPrInfo: { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null;
 * }}
 */
export function readTerminalRuntimeState(runtimeId) {
    const runtime = readAgentRuntimeOverviewProjection(runtimeId);
    return {
        runtimeId: runtime.runtimeId,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        status: runtime.status,
        sessionId: runtime.sessionId,
        dialogLoopActive: runtime.dialogLoopActive,
        dialogPaused: runtime.dialogPaused,
        queueSize: runtime.queueSize,
        pendingQuestion: runtime.pendingQuestion,
        pendingQuestionKind: runtime.pendingQuestionKind,
        pendingQuestionShadow: runtime.pendingQuestionShadow,
        pendingQuestionShadowKind: runtime.pendingQuestionShadowKind,
        pendingQuestionShadowState: runtime.pendingQuestionShadowState,
        pendingQuestionShadowExpired: runtime.pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs,
        contextWindow: runtime.contextWindow,
        lastPrInfo: /** @type {{
    model?: string;
    cost?: number;
    quotaSnapshots?: Record<string, unknown>;
    ts: number;
} | null} */ (runtime.lastPrInfo),
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof readAgentRuntimeControlState>}
 */
export function readTerminalRuntimeControlState(runtimeId) {
    return readAgentRuntimeControlState(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function startTerminalAgentRuntime(runtimeId) {
    await startAgentRuntime(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function abortTerminalCurrentMessage(runtimeId) {
    await abortAgentRuntimeCurrentMessage(runtimeId);
}

/**
 * @param {string} answer
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function answerTerminalPendingQuestion(answer, runtimeId) {
    return answerAgentPendingQuestion(answer, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function clearTerminalPendingQuestionShadow(runtimeId) {
    return clearAgentPendingQuestionShadow(runtimeId);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    onAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onceTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    onceAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function offTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    offAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     once: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }}
 */
export function readTerminalAgentRuntimeEventHost(runtimeId) {
    return {
        on: (event, handler) => onTerminalAgentRuntimeEvent(event, handler, runtimeId),
        once: (event, handler) => onceTerminalAgentRuntimeEvent(event, handler, runtimeId),
        off: (event, handler) => offTerminalAgentRuntimeEvent(event, handler, runtimeId),
    };
}

/**
 * Binding canônico entre runtime, sessão SDK e hub conversacional.
 *
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null }}
 */
export function readTerminalSessionBinding() {
    return getSharedSessionBinding();
}

/**
 * Metadados de streaming/renderização para o frontend local.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ model: string; reasoningEffort: string }}
 */
export function readTerminalDialogStreamMeta(runtimeId) {
    const state = readTerminalRuntimeState(runtimeId);
    return {
        model: state.model,
        reasoningEffort: state.reasoningEffort,
    };
}

/**
 * Obtém o histórico atual de handoffs do runtime.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../../presentation/types.js').RuntimeHandoffRequest[]}
 */
export function readTerminalHandoffHistory(runtimeId) {
    return readAgentHandoffHistory(runtimeId);
}

/**
 * Mantém vivo o watchdog de diálogo do runtime.
 *
 * @returns {void}
 */
export function pingTerminalDialogWatchdog() {
    pingDefaultAgentDialogWatchdog();
}

/**
 * Pausa explicitamente o dialog loop.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function pauseTerminalDialogLoop(runtimeId) {
    await pauseAgentDialogLoop(runtimeId);
}

/**
 * Retoma explicitamente o dialog loop.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function resumeTerminalDialogLoop(runtimeId) {
    await resumeAgentDialogLoop(runtimeId);
}

/**
 * Encerra o runtime do agente com autorização explícita do usuário.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function stopTerminalAgentRuntime(runtimeId) {
    await stopAgentRuntimeDialogLoopAuthorized(runtimeId);
}

/**
 * Lê o modo vanilla atual da sessão SDK.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../presentation/types.js').RuntimeSdkModeResult>}
 */
export async function getTerminalSdkSessionMode(runtimeId) {
    return getAgentSdkSessionMode(runtimeId);
}

/**
 * Altera o modo vanilla da sessão SDK.
 *
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../presentation/types.js').RuntimeSdkModeResult>}
 */
export async function setTerminalSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionMode(mode, runtimeId);
}

/**
 * Lê o plan.md vanilla da sessão SDK.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function readTerminalSdkPlan(runtimeId) {
    return readAgentSdkPlan(runtimeId);
}

/**
 * Atualiza o plan.md vanilla da sessão SDK.
 *
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateTerminalSdkPlan(content, runtimeId) {
    return updateAgentSdkPlan(content, runtimeId);
}

/**
 * Remove o plan.md vanilla da sessão SDK.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteTerminalSdkPlan(runtimeId) {
    return deleteAgentSdkPlan(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkModels(runtimeId) {
    return listAgentSdkModels(runtimeId);
}

/**
 * @param {{ model?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkTools(options, runtimeId) {
    return listAgentSdkTools(options, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getTerminalSdkQuota(runtimeId) {
    return getAgentSdkQuota(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkWorkspaceFiles(runtimeId) {
    return listAgentSdkWorkspaceFiles(runtimeId);
}

/**
 * @param {string} path
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readTerminalSdkWorkspaceFile(path, runtimeId) {
    return readAgentSdkWorkspaceFile(path, runtimeId);
}

/**
 * @param {string} path
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function createTerminalSdkWorkspaceFile(path, content, runtimeId) {
    return createAgentSdkWorkspaceFile(path, content, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function compactTerminalSdkSession(runtimeId) {
    return compactAgentSdkSession(runtimeId);
}

/**
 * @param {string} message
 * @param {object} requestedSchema
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function requestTerminalSdkElicitation(message, requestedSchema, runtimeId) {
    return requestAgentSdkElicitation(message, requestedSchema, runtimeId);
}

/**
 * Histórico em memória do transporte LLM-A ↔ LLM-B.
 *
 * @returns {{ role: string; content: string; timestamp?: number }[]}
 */
export function readTerminalHistoryFeed() {
    return /** @type {{ role: string; content: string; timestamp?: number }[]} */ (llmBridgeClient.history ?? []);
}

/**
 * Limpa o histórico em memória do transporte.
 *
 * @returns {void}
 */
export function clearTerminalHistoryFeed() {
    llmBridgeClient.clearHistory();
}

/**
 * Injeta uma seed no histórico do transporte quando a implementação suportar isso.
 *
 * @param {'assistant' | 'user'} role
 * @param {string} content
 * @returns {void}
 */
export function seedTerminalHistoryFeed(role, content) {
    if (typeof llmBridgeClient.seedHistory === 'function') {
        llmBridgeClient.seedHistory(role, content);
    }
}

/**
 * Contagem de turnos do transporte.
 *
 * @returns {number}
 */
export function readTerminalTurnCount() {
    return Number(llmBridgeClient.turnCount ?? 0);
}

/**
 * Inicia o dialog mode do bridge.
 *
 * @param {string | undefined} bootPrompt
 * @param {{ onReady?: () => void }} [opts]
 * @returns {Promise<void>}
 */
export async function startTerminalDialogMode(bootPrompt, opts = {}) {
    await llmBridgeClient.startDialogMode(bootPrompt, opts);
}

/**
 * Para o dialog mode do bridge.
 *
 * @returns {Promise<void>}
 */
export async function stopTerminalDialogMode() {
    await llmBridgeClient.stopDialogMode();
}

/**
 * Envia um turno ao bridge de diálogo.
 *
 * @param {string} enrichedMessage
 * @param {{
 *     timeout: number;
 *     onDelta: (chunk: string) => void;
 *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
 * }} opts
 * @returns {Promise<string>}
 */
export async function runTerminalDialogTurn(enrichedMessage, opts) {
    return llmBridgeClient.dialogTurn(enrichedMessage, opts);
}

/**
 * Indica se o hub conversacional está pronto.
 *
 * @returns {boolean}
 */
export function isTerminalHubReady() {
    return conversationHub.isReady;
}

/**
 * Inicializa o hub conversacional.
 *
 * @returns {Promise<void>}
 */
export async function initTerminalConversationHub() {
    await conversationHub.init();
}

/**
 * Cria uma hub session para o terminal.
 *
 * @param {{ title?: string; sdkSessionId?: string; metadata?: object }} [opts]
 * @returns {string}
 */
export function createTerminalHubSession(opts = {}) {
    return conversationStore.createHubSession(opts);
}

/**
 * Obtém o store canônico do hub.
 *
 * @returns {import('#copilot/conversation-hub').ConversationStore}
 */
export function readTerminalHubStore() {
    return conversationStore;
}

/**
 * Obtém o orchestrator canônico do hub.
 *
 * @returns {import('#copilot/conversation-hub').HubOrchestrator}
 */
export function readTerminalHubOrchestrator() {
    return conversationHub.orchestrator;
}

/**
 * Acopla Socket.IO ao hub inicializado.
 *
 * @param {import('socket.io').Server} io
 * @param {(
 *     io: import('socket.io').Server,
 *     orchestrator: import('#copilot/conversation-hub').HubOrchestrator,
 *     store: import('#copilot/conversation-hub').ConversationStore,
 * ) => void} [mountFn]
 * @returns {void}
 */
export function attachTerminalHubSocketIO(io, mountFn) {
    conversationHub.attachSocketIO(io, mountFn);
}

/**
 * Lê uma hub session pelo ID.
 *
 * @param {string} hubSessionId
 * @returns {Record<string, unknown> | null}
 */
export function readTerminalHubSession(hubSessionId) {
    return conversationStore.getHubSession(hubSessionId);
}

/**
 * Lê turnos persistidos de uma hub session.
 *
 * @param {string} hubSessionId
 * @param {{ limit?: number; offset?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubTurns(hubSessionId, opts = {}) {
    return conversationStore.readTurns(hubSessionId, {
        limit: opts.limit ?? 20,
        offset: opts.offset ?? 0,
    });
}

/**
 * Lista hub sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubSessions(opts = {}) {
    return conversationStore.listHubSessions({
        limit: opts.limit ?? 10,
        offset: opts.offset ?? 0,
    });
}

/**
 * Recupera memórias persistidas no hub.
 *
 * @param {{ tag?: string; search?: string; limit?: number }} [opts]
 * @returns {Record<string, unknown>[]}
 */
export function readTerminalHubMemories(opts = {}) {
    return conversationStore.recallMemories({
        ...(opts.tag ? { tag: opts.tag } : {}),
        ...(opts.search ? { search: opts.search } : {}),
        limit: opts.limit ?? 10,
    });
}

/**
 * Persiste uma memória no hub.
 *
 * @param {{ tag: string; content: string; hubSessionId?: string | null }} payload
 * @returns {string}
 */
export function storeTerminalHubMemory(payload) {
    return conversationStore.storeMemory({
        tag: payload.tag,
        content: payload.content,
        ...(payload.hubSessionId ? { hubSessionId: payload.hubSessionId } : {}),
    });
}

/**
 * Remove uma memória do hub pelo ID.
 *
 * @param {string} memoryId
 * @returns {boolean}
 */
export function deleteTerminalHubMemory(memoryId) {
    return conversationStore.deleteMemory(memoryId);
}

/**
 * Indica se a busca FTS do hub está disponível.
 *
 * @returns {boolean}
 */
export function canSearchTerminalHubTurns() {
    return Boolean(conversationHub.isReady && conversationHub.store);
}

/**
 * Busca full-text em turnos persistidos do hub.
 *
 * @param {{ query: string; limit: number; hubSessionId?: string }} opts
 * @returns {Record<string, unknown>[]}
 */
export function searchTerminalHubTurns(opts) {
    if (!conversationHub.isReady || !conversationHub.store) {
        return [];
    }
    return conversationHub.store.searchTurns(opts);
}

/**
 * Cria um snapshot do runtime do agente para uso do frontend do terminal.
 *
 * @param {Parameters<typeof createAgentRuntimeSnapshot>[0]} data
 * @returns {ReturnType<typeof createAgentRuntimeSnapshot>}
 */
export function createTerminalSnapshot(data) {
    return createAgentRuntimeSnapshot(data);
}

/**
 * Persiste um snapshot do terminal.
 *
 * @param {Parameters<typeof saveAgentRuntimeSnapshot>[0]} data
 * @returns {ReturnType<typeof saveAgentRuntimeSnapshot>}
 */
export function saveTerminalSnapshot(data) {
    return saveAgentRuntimeSnapshot(data);
}

/**
 * Lista snapshots persistidos do runtime/terminal.
 *
 * @returns {ReturnType<typeof listAgentRuntimeSnapshots>}
 */
export function listTerminalSnapshots() {
    return listAgentRuntimeSnapshots();
}

/**
 * Carrega um snapshot persistido do runtime/terminal.
 *
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadAgentRuntimeSnapshot>}
 */
export function loadTerminalSnapshot(snapshotId) {
    return loadAgentRuntimeSnapshot(snapshotId);
}

/**
 * Persiste uma mensagem sistêmica do terminal no hub.
 *
 * @param {string} hubSessionId
 * @param {string} content
 * @returns {Promise<number>}
 */
export async function writeTerminalHubSystemTurn(hubSessionId, content) {
    return conversationStore.writeTurn(hubSessionId, { role: 'user', content });
}

/**
 * Emite uma notificação de turno do terminal para o hub/orchestrator.
 *
 * @param {string} hubSessionId
 * @param {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number; source?: string }} userTurn
 * @param {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
 * @returns {void}
 */
export function notifyTerminalHubTurn(hubSessionId, userTurn, llmBTurn) {
    conversationHub.notifyTerminalTurn(hubSessionId, userTurn, llmBTurn);
}

/**
 * Busca um turno do hub pelo ID.
 *
 * @param {number} turnId
 * @returns {Record<string, unknown> | null}
 */
export function readTerminalHubTurn(turnId) {
    return conversationStore.getTurn(turnId);
}
