// @ts-check
/**
 * @file Gateway runtime do terminal como frontend principal da LLM-B.
 *
 *   Centraliza o consumo explícito das SSOTs operacionais já existentes (`agent/`, `channel/` e `conversation-hub/`) para
 *   que `repl`, `dialog/*`, `terminal-agent-wiring` e `index.js` não continuem reabrindo DI/container e integrações
 *   transversais em cada arquivo.
 */

import { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from '#copilot/agent';
import { llmBridgeClient } from '#copilot/channel';
import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { getSharedSessionBinding } from '#copilot/core';
import { getDefaultAgentRuntime, getDefaultAgentRuntimeId } from '../../presentation/agent-runtime.js';

/**
 * Retorna a instância singleton canônica do runtime do agente.
 *
 * @returns {import('#copilot/agent').AlwaysAliveAgent}
 */
export function getTerminalAgentRuntime() {
    return getDefaultAgentRuntime();
}

/**
 * Lê o estado mínimo do runtime para exibição/streaming no terminal.
 *
 * @returns {{
 *     runtimeId: string;
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('#copilot/agent/types').PendingQuestion | null;
 *     pendingQuestionKind: import('#copilot/agent/types').PendingQuestionKind | null;
 *     pendingQuestionShadow: import('#copilot/agent/types').PendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('#copilot/agent/types').PendingQuestionKind | null;
 *     pendingQuestionShadowState: import('#copilot/agent/types').PendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 * }}
 */
export function readTerminalRuntimeState() {
    const agent = getTerminalAgentRuntime();
    const pendingQuestion = agent.pendingQuestion ?? null;
    const pendingQuestionShadow = agent.pendingQuestionShadow ?? null;
    const pendingQuestionKind =
        agent.pendingQuestionKind ??
        (pendingQuestion && typeof pendingQuestion === 'object' && typeof pendingQuestion.kind === 'string'
            ? pendingQuestion.kind
            : null);
    const pendingQuestionShadowKind =
        agent.pendingQuestionShadowKind ??
        (pendingQuestionShadow &&
        typeof pendingQuestionShadow === 'object' &&
        pendingQuestionShadow.meta &&
        typeof pendingQuestionShadow.meta === 'object' &&
        typeof pendingQuestionShadow.meta.kind === 'string'
            ? pendingQuestionShadow.meta.kind
            : null);
    const pendingQuestionShadowState =
        agent.pendingQuestionShadowState ??
        (pendingQuestionShadow !== null ? (agent.pendingQuestionShadowExpired ? 'expired' : 'active') : null);
    return {
        runtimeId: getDefaultAgentRuntimeId(),
        model: String(agent.model ?? 'unknown'),
        reasoningEffort: String(agent.reasoningEffort ?? 'off'),
        status: String(agent.status ?? 'unknown'),
        sessionId: agent.sessionId ?? null,
        dialogLoopActive: agent.dialogLoopActive,
        dialogPaused: Boolean(agent.dialogPaused),
        queueSize: Number(agent.queueSize ?? 0),
        pendingQuestion,
        pendingQuestionKind,
        pendingQuestionShadow,
        pendingQuestionShadowKind,
        pendingQuestionShadowState,
        pendingQuestionShadowExpired: Boolean(agent.pendingQuestionShadowExpired),
        pendingQuestionShadowAgeMs: agent.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: agent.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs: agent.pendingQuestionShadowRemainingMs ?? null,
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
 * @returns {{ model: string; reasoningEffort: string }}
 */
export function readTerminalDialogStreamMeta() {
    const state = readTerminalRuntimeState();
    return {
        model: state.model,
        reasoningEffort: state.reasoningEffort,
    };
}

/**
 * Obtém o histórico atual de handoffs do runtime.
 *
 * @returns {import('../../agent/infra/handoff-manager.js').HandoffRequest[]}
 */
export function readTerminalHandoffHistory() {
    return getTerminalAgentRuntime().getHandoffManager?.()?.getHistory?.() ?? [];
}

/**
 * Mantém vivo o watchdog de diálogo do runtime.
 *
 * @returns {void}
 */
export function pingTerminalDialogWatchdog() {
    getTerminalAgentRuntime().pingDialogWatchdog();
}

/**
 * Pausa explicitamente o dialog loop.
 *
 * @returns {Promise<void>}
 */
export async function pauseTerminalDialogLoop() {
    await getTerminalAgentRuntime().pauseDialogLoop();
}

/**
 * Retoma explicitamente o dialog loop.
 *
 * @returns {Promise<void>}
 */
export async function resumeTerminalDialogLoop() {
    await getTerminalAgentRuntime().resumeDialogLoop();
}

/**
 * Encerra o runtime do agente com autorização explícita do usuário.
 *
 * @returns {Promise<void>}
 */
export async function stopTerminalAgentRuntime() {
    await getTerminalAgentRuntime().stopDialogLoop({ authorized: true, reason: 'authorized_stop' });
}

/**
 * Lê o modo vanilla atual da sessão SDK.
 *
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function getTerminalSdkSessionMode() {
    return getTerminalAgentRuntime().getSdkSessionMode();
}

/**
 * Altera o modo vanilla da sessão SDK.
 *
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
 */
export async function setTerminalSdkSessionMode(mode) {
    return getTerminalAgentRuntime().setSdkSessionMode(mode);
}

/**
 * Lê o plan.md vanilla da sessão SDK.
 *
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function readTerminalSdkPlan() {
    return getTerminalAgentRuntime().readSdkPlan();
}

/**
 * Atualiza o plan.md vanilla da sessão SDK.
 *
 * @param {string} content
 * @returns {Promise<object>}
 */
export async function updateTerminalSdkPlan(content) {
    return getTerminalAgentRuntime().updateSdkPlan(content);
}

/**
 * Remove o plan.md vanilla da sessão SDK.
 *
 * @returns {Promise<object>}
 */
export async function deleteTerminalSdkPlan() {
    return getTerminalAgentRuntime().deleteSdkPlan();
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
 * @param {Parameters<typeof createSnapshot>[0]} data
 * @returns {ReturnType<typeof createSnapshot>}
 */
export function createTerminalSnapshot(data) {
    return createSnapshot(data);
}

/**
 * Persiste um snapshot do terminal.
 *
 * @param {Parameters<typeof saveSnapshotAsync>[0]} data
 * @returns {ReturnType<typeof saveSnapshotAsync>}
 */
export function saveTerminalSnapshot(data) {
    return saveSnapshotAsync(data);
}

/**
 * Lista snapshots persistidos do runtime/terminal.
 *
 * @returns {ReturnType<typeof listSnapshotsAsync>}
 */
export function listTerminalSnapshots() {
    return listSnapshotsAsync();
}

/**
 * Carrega um snapshot persistido do runtime/terminal.
 *
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadSnapshotAsync>}
 */
export function loadTerminalSnapshot(snapshotId) {
    return loadSnapshotAsync(snapshotId);
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
