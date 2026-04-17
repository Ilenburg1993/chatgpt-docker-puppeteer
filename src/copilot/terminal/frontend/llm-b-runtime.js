// @ts-check
/**
 * @file Gateway runtime do terminal como frontend principal da LLM-B.
 *
 *   Centraliza o consumo explícito das SSOTs operacionais já existentes (`agent/`, `channel/` e `conversation-hub/`) para
 *   que `repl`, `dialog/*`, `terminal-agent-wiring` e `index.js` não continuem reabrindo DI/container e integrações
 *   transversais em cada arquivo.
 */

import { getAgent } from '#copilot/agent';
import { llmBridgeClient } from '#copilot/channel';
import { conversationHub, conversationStore } from '#copilot/conversation-hub';

/**
 * Retorna a instância singleton canônica do runtime do agente.
 *
 * @returns {import('#copilot/agent').AlwaysAliveAgent}
 */
export function getTerminalAgentRuntime() {
    return getAgent();
}

/**
 * Lê o estado mínimo do runtime para exibição/streaming no terminal.
 *
 * @returns {{
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('#copilot/agent/types').PendingQuestion | null;
 * }}
 */
export function readTerminalRuntimeState() {
    const agent = getAgent();
    return {
        model: String(agent.model ?? 'unknown'),
        reasoningEffort: String(agent.reasoningEffort ?? 'high'),
        status: String(agent.status ?? 'unknown'),
        sessionId: agent.sessionId ?? null,
        dialogLoopActive: agent.dialogLoopActive,
        dialogPaused: Boolean(agent.dialogPaused),
        queueSize: Number(agent.queueSize ?? 0),
        pendingQuestion: agent.pendingQuestion ?? null,
    };
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
    return getAgent().getHandoffManager?.()?.getHistory?.() ?? [];
}

/**
 * Mantém vivo o watchdog de diálogo do runtime.
 *
 * @returns {void}
 */
export function pingTerminalDialogWatchdog() {
    getAgent().pingDialogWatchdog();
}

/**
 * Pausa explicitamente o dialog loop.
 *
 * @returns {Promise<void>}
 */
export async function pauseTerminalDialogLoop() {
    await getAgent().pauseDialogLoop();
}

/**
 * Retoma explicitamente o dialog loop.
 *
 * @returns {Promise<void>}
 */
export async function resumeTerminalDialogLoop() {
    await getAgent().resumeDialogLoop();
}

/**
 * Encerra o runtime do agente com autorização explícita do usuário.
 *
 * @returns {Promise<void>}
 */
export async function stopTerminalAgentRuntime() {
    await getAgent().stopDialogLoop({ authorized: true, reason: 'authorized_stop' });
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
