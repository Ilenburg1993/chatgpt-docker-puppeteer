// @ts-check
/**
 * @file Fachada interna do terminal como frontend principal da LLM-B.
 *
 *   Centraliza leituras e operações de UX local que dependem de múltiplos domínios canônicos (`agent/`, `channel/`,
 *   `conversation-hub/`, `sdk/`, `observability/` e `core/`).
 *
 *   A ideia não é substituir as SSOTs do sistema, e sim impedir que cada comando do REPL reabra integrações transversais
 *   por conta própria.
 */

import { createSnapshot, getAgent, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from '#copilot/agent';
import { getMcpStatus } from '#copilot/bridges';
import { llmBridgeClient } from '#copilot/channel';
import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { getSharedSessionBinding } from '#copilot/core';
import { defaultErrorTracker, getToolStats } from '#copilot/observability';
import { listModels, modelRegistry, modelStatsTracker } from '#copilot/sdk';
import { getWorkspaceContext } from '../workspace-context.js';

/**
 * @typedef {{ tokens: number; tokenLimit: number; utilization: number }} ContextWindowProjection
 */

/**
 * @typedef {{
 *     agent: import('#copilot/agent').AlwaysAliveAgent;
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeSessionId: string | null;
 *     contextWindow: ContextWindowProjection | null;
 * }} TerminalRuntimeBase
 */

/**
 * Normaliza o snapshot de context window do runtime.
 *
 * @param {unknown} raw
 * @returns {ContextWindowProjection | null}
 */
export function normalizeContextWindowProjection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = /** @type {Record<string, unknown>} */ (raw);
    const tokens = Number(data['tokens'] ?? NaN);
    const tokenLimit = Number(data['tokenLimit'] ?? NaN);
    const utilization = Number(data['utilization'] ?? NaN);
    if (!Number.isFinite(tokens) || !Number.isFinite(tokenLimit) || !Number.isFinite(utilization)) {
        return null;
    }
    return { tokens, tokenLimit, utilization };
}

/**
 * Lê a base canônica de runtime que o terminal precisa para atuar como frontend principal da LLM-B.
 *
 * @returns {TerminalRuntimeBase}
 */
export function readTerminalRuntimeBase() {
    const agent = getAgent();
    const snap = /** @type {Record<string, unknown>} */ (agent.getStatusSnapshot());
    const health = typeof agent.getHealthSnapshot === 'function' ? agent.getHealthSnapshot() : null;
    const binding = getSharedSessionBinding();
    const runtimeSessionId =
        agent.sessionId ??
        (typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null) ??
        binding.sdkSessionId ??
        null;
    const contextWindow = normalizeContextWindowProjection(snap['contextWindow'] ?? snap['contextState'] ?? null);
    return { agent, snap, health, binding, runtimeSessionId, contextWindow };
}

/**
 * Projeção de status do terminal/LLM-B para UX local.
 *
 * @param {{ hubSessionId?: string | null; injectPort?: number }} input
 * @returns {{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     dialogLoopActive: boolean;
 *     injectPort: number | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     runtimeSessionId: string | null;
 *     workspace: ReturnType<typeof getWorkspaceContext>;
 *     turnCount: number;
 * }}
 */
export function readTerminalStatusProjection({ hubSessionId = null, injectPort } = {}) {
    const base = readTerminalRuntimeBase();
    return {
        snap: base.snap,
        health: base.health,
        dialogLoopActive: base.agent.dialogLoopActive,
        injectPort: typeof injectPort === 'number' ? injectPort : null,
        hubSessionId: hubSessionId ?? base.binding.hubSessionId ?? null,
        sdkSessionId: base.binding.sdkSessionId,
        runtimeSessionId: base.runtimeSessionId,
        workspace: getWorkspaceContext(),
        turnCount: llmBridgeClient.turnCount,
    };
}

/**
 * Retorna a projeção canônica de configuração do runtime da LLM-B para o terminal.
 *
 * @returns {{
 *     currentModel: string;
 *     currentReasoningEffort: string;
 *     modelMeta: { costTier?: string; speedTier?: string; contextWindow?: number } | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeSessionId: string | null;
 * }}
 */
export function readTerminalConfigProjection() {
    const base = readTerminalRuntimeBase();
    const currentModel = String(base.agent.model ?? base.snap['model'] ?? 'unknown');
    const currentReasoningEffort = String(base.agent.reasoningEffort ?? base.snap['reasoningEffort'] ?? 'off');
    const rawMeta = modelRegistry.get(currentModel);
    return {
        currentModel,
        currentReasoningEffort,
        modelMeta: rawMeta
            ? {
                  costTier: rawMeta.costTier,
                  speedTier: rawMeta.speedTier,
                  contextWindow: rawMeta.contextWindow,
              }
            : null,
        binding: base.binding,
        runtimeSessionId: base.runtimeSessionId,
    };
}

/**
 * Lista modelos disponíveis com o modelo atual anotado pela camada frontend do terminal.
 *
 * @returns {Promise<{
 *     currentModel: string;
 *     models: import('#copilot/sdk/types').ModelInfo[];
 * }>}
 */
export async function listTerminalAvailableModelsProjection() {
    return {
        currentModel: readTerminalConfigProjection().currentModel,
        models: await listModels(),
    };
}

/**
 * Estatísticas de modelos para a UX local do terminal.
 *
 * @returns {{ currentModel: string; stats: ReturnType<typeof modelStatsTracker.allStats> }}
 */
export function readTerminalModelStatsProjection() {
    return {
        currentModel: readTerminalConfigProjection().currentModel,
        stats: modelStatsTracker.allStats(),
    };
}

/**
 * Troca o modelo do runtime do agente e devolve a projeção pós-operação.
 *
 * @param {string} modelId
 * @returns {{
 *     previousModel: string;
 *     currentModel: string;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 * }}
 */
export function setTerminalModelProjection(modelId) {
    const { agent, binding } = readTerminalRuntimeBase();
    const previousModel = String(agent.model ?? 'unknown');
    agent.setModel(modelId);
    return {
        previousModel,
        currentModel: modelId,
        binding,
    };
}

/**
 * Ajusta o reasoning effort do runtime do agente.
 *
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @returns {{ previousReasoningEffort: string; currentReasoningEffort: string }}
 */
export function setTerminalReasoningProjection(effort) {
    const { agent } = readTerminalRuntimeBase();
    const previousReasoningEffort = String(agent.reasoningEffort ?? 'off');
    agent.setReasoningEffort(effort);
    return {
        previousReasoningEffort,
        currentReasoningEffort: String(effort ?? 'off'),
    };
}

/**
 * Retorna o histórico em memória do bridge LLM-A ↔ LLM-B.
 *
 * @param {number} [limitPairs=10] Default is `10`
 * @returns {{ role: string; content: string; timestamp: number }[]}
 */
export function readTerminalHistoryProjection(limitPairs = 10) {
    return llmBridgeClient.history.slice(-limitPairs * 2);
}

/**
 * Projeção consolidada do uso de contexto da LLM-B para o terminal.
 *
 * @returns {{
 *     hasHistory: boolean;
 *     totalChars: number;
 *     turnCount: number;
 *     usedTokens: number;
 *     maxTokens: number;
 *     utilization: number;
 *     isRealData: boolean;
 *     workspace: ReturnType<typeof getWorkspaceContext>;
 * }}
 */
export function readTerminalContextProjection() {
    const base = readTerminalRuntimeBase();
    const history = /** @type {{ role: string; content: string }[]} */ (
        /** @type {unknown} */ (llmBridgeClient.history) ?? []
    );

    let totalChars = 0;
    let turnCount = 0;
    for (const turn of history) {
        const text = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content);
        totalChars += text.length;
        turnCount += 1;
    }

    const isRealData = Boolean(base.contextWindow);
    const usedTokens = isRealData ? (base.contextWindow?.tokens ?? 0) : Math.ceil(totalChars / 4);
    const maxTokens = isRealData ? (base.contextWindow?.tokenLimit ?? 0) : 128_000;
    const utilization = isRealData ? (base.contextWindow?.utilization ?? 0) : Math.min(usedTokens / maxTokens, 1);

    return {
        hasHistory: history.length > 0,
        totalChars,
        turnCount,
        usedTokens,
        maxTokens,
        utilization,
        isRealData,
        workspace: getWorkspaceContext(),
    };
}

/**
 * Solicita compactação ao runtime da LLM-B e reconstrói o histórico local com o resumo final.
 *
 * @returns {Promise<{ ok: boolean; reply: string | null; estimatedTokens: number | null }>}
 */
export async function requestTerminalCompactionProjection() {
    const { sendTurn } = await import('../dialog.js');
    const reply = await sendTurn(
        '[SISTEMA] Compacte toda esta conversa em um resumo técnico denso. Preserve: ' +
            'todos os fatos, código, decisões, estados e contexto de arquivos discutidos. ' +
            'Responda APENAS com esse resumo. Após isso, considere o resumo como o novo ' +
            'contexto inicial desta sessão.',
        'user',
    );
    if (!reply) {
        return { ok: false, reply: null, estimatedTokens: null };
    }

    llmBridgeClient.clearHistory();
    if (typeof llmBridgeClient.seedHistory === 'function') {
        llmBridgeClient.seedHistory('assistant', reply);
    }

    return {
        ok: true,
        reply,
        estimatedTokens: Math.ceil((reply?.length ?? 0) / 4),
    };
}

/**
 * Limpa o histórico em memória do canal.
 *
 * @returns {void}
 */
export function clearTerminalHistory() {
    llmBridgeClient.clearHistory();
}

/**
 * Encaminha uma resposta à pergunta pendente do runtime.
 *
 * @param {string} answer
 * @returns {boolean}
 */
export function answerPendingTerminalQuestion(answer) {
    return readTerminalRuntimeBase().agent.answerPendingQuestion(answer);
}

/**
 * Lê turnos persistidos da hub session atual.
 *
 * @param {{ hubSessionId?: string | null; limit?: number; offset?: number }} input
 * @returns {{
 *     available: boolean;
 *     reason: string | null;
 *     turns: Record<string, any>[];
 *     limit: number;
 *     offset: number;
 * }}
 */
export function readTerminalDbHistoryProjection({ hubSessionId = null, limit = 20, offset = 0 }) {
    if (!hubSessionId) {
        return { available: false, reason: 'no-hub-session', turns: [], limit, offset };
    }
    return {
        available: true,
        reason: null,
        turns: conversationStore.readTurns(hubSessionId, { limit, offset }),
        limit,
        offset,
    };
}

/**
 * Lista sessões persistidas no hub com a sessão atual marcada separadamente.
 *
 * @param {{ currentHubSessionId?: string | null; limit?: number }} input
 * @returns {{ currentHubSessionId: string | null; sessions: Record<string, any>[] }}
 */
export function readTerminalDbSessionsProjection({ currentHubSessionId = null, limit = 10 }) {
    return {
        currentHubSessionId,
        sessions: conversationStore.listHubSessions({ limit }),
    };
}

/**
 * Calcula estatísticas simples da sessão conversacional atual.
 *
 * @param {{ hubSessionId?: string | null }} input
 * @returns {{
 *     available: boolean;
 *     reason: string | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     turns: number;
 *     userTurns: number;
 *     llmBTurns: number;
 *     memories: number;
 * }}
 */
export function readTerminalCountProjection({ hubSessionId = null }) {
    const binding = getSharedSessionBinding();
    if (!hubSessionId) {
        return {
            available: false,
            reason: 'no-hub-session',
            hubSessionId: null,
            sdkSessionId: binding.sdkSessionId,
            turns: 0,
            userTurns: 0,
            llmBTurns: 0,
            memories: 0,
        };
    }
    const turns = conversationStore.readTurns(hubSessionId, { limit: 9999 });
    const memories = conversationStore.recallMemories({ limit: 9999 });
    return {
        available: true,
        reason: null,
        hubSessionId,
        sdkSessionId: binding.sdkSessionId,
        turns: turns.length,
        userTurns: turns.filter((turn) => turn.role === 'user').length,
        llmBTurns: turns.filter((turn) => turn.role === 'llm_b').length,
        memories: memories.length,
    };
}

/**
 * Salva snapshot manual da sessão atual.
 *
 * @param {string | undefined} reason
 * @returns {Promise<{ data: Record<string, any>; path: string }>}
 */
export async function saveTerminalSnapshotProjection(reason) {
    const { agent, snap } = readTerminalRuntimeBase();
    const data = createSnapshot({
        sessionId: agent.sessionId ?? null,
        model: String(snap['model'] ?? 'unknown'),
        status: String(snap['status'] ?? 'unknown'),
        sendCount: Number(snap['sendCount'] ?? 0),
        dialogLoopActive: agent.dialogLoopActive,
        dialogPaused: Boolean(snap['dialogPaused']),
        pendingQuestion: snap['pendingQuestion'] ? String(snap['pendingQuestion']) : null,
        prMetrics: agent.dialogPrMetrics ?? null,
        reason: reason || 'manual',
    });
    const path = await saveSnapshotAsync(data);
    return { data, path };
}

/**
 * Lista snapshots disponíveis.
 *
 * @returns {Promise<Record<string, any>[]>}
 */
export async function listTerminalSnapshotsProjection() {
    return listSnapshotsAsync();
}

/**
 * Carrega um snapshot específico.
 *
 * @param {string} snapshotId
 * @returns {Promise<Record<string, any> | null>}
 */
export async function loadTerminalSnapshotProjection(snapshotId) {
    return loadSnapshotAsync(snapshotId);
}

/**
 * Lê a projeção diagnóstica consolidada do terminal.
 *
 * @param {{ hubSessionId?: string | null }} input
 * @returns {Promise<{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     dialogLoopActive: boolean;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeSessionId: string | null;
 *     mcp: ReturnType<typeof getMcpStatus>;
 *     memMB: number;
 *     uptimeSec: number;
 *     hub: { ready: boolean; activeHubSessionId: string | null; summary: string };
 *     todos: { id: string; title: string; status: string }[];
 *     topToolStats: [string, Record<string, any>][];
 * }>}
 */
export async function readTerminalDiagnoseProjection({ hubSessionId = null }) {
    const base = readTerminalRuntimeBase();
    const mcp = getMcpStatus();
    const memMB = Math.round(process.memoryUsage().rss / 1_048_576);
    const uptimeSec = Math.round(process.uptime());

    let summary = 'sem storage';
    if (conversationHub.isReady && hubSessionId) {
        try {
            const session = conversationStore.getHubSession(hubSessionId);
            summary = session ? `sessão ${hubSessionId.slice(0, 8)}…` : 'sessão não encontrada no store';
        } catch {
            summary = 'erro ao consultar store';
        }
    } else if (!conversationHub.isReady) {
        summary = 'hub não inicializado';
    }

    /** @type {{ id: string; title: string; status: string }[]} */
    let todos;
    try {
        const { readStore } = await import('../../tools/todo/store.js');
        todos = Object.values((await readStore()).tasks)
            .filter((task) => task.status === 'todo' || task.status === 'in_progress')
            .slice(0, 5)
            .map((task) => ({ id: task.id, title: task.title, status: task.status }));
    } catch {
        todos = [];
    }

    const topToolStats = Object.entries(getToolStats())
        .sort(([, a], [, b]) => Number(b['avgLatencyMs'] ?? 0) - Number(a['avgLatencyMs'] ?? 0))
        .slice(0, 5);

    return {
        snap: base.snap,
        health: base.health,
        dialogLoopActive: base.agent.dialogLoopActive,
        binding: base.binding,
        runtimeSessionId: base.runtimeSessionId,
        mcp,
        memMB,
        uptimeSec,
        hub: {
            ready: conversationHub.isReady,
            activeHubSessionId: hubSessionId ?? base.binding.hubSessionId ?? null,
            summary,
        },
        todos,
        topToolStats,
    };
}

/**
 * Consolida métricas da sessão e do runtime para a UX local.
 *
 * @returns {{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeSessionId: string | null;
 *     contextWindow: ContextWindowProjection | null;
 *     pr: Record<string, any> | null;
 *     turnCount: number;
 *     toolCallCount: number;
 *     toolErrorCount: number;
 *     errorStats: { total: number; buffered: number };
 * }}
 */
export function readTerminalMetricsProjection() {
    const base = readTerminalRuntimeBase();
    const pr = /** @type {Record<string, any> | null} */ (base.agent.lastPrInfo ?? null);
    const toolStats = getToolStats();
    let toolCallCount = 0;
    let toolErrorCount = 0;
    for (const stat of Object.values(toolStats)) {
        toolCallCount += Number(stat['calls'] ?? 0);
        toolErrorCount += Number(stat['errors'] ?? 0);
    }
    const errorStats =
        typeof defaultErrorTracker?.getStats === 'function'
            ? defaultErrorTracker.getStats()
            : { total: 0, buffered: 0 };
    return {
        snap: base.snap,
        health: base.health,
        binding: base.binding,
        runtimeSessionId: base.runtimeSessionId,
        contextWindow: base.contextWindow,
        pr,
        turnCount: llmBridgeClient.turnCount,
        toolCallCount,
        toolErrorCount,
        errorStats: {
            total: Number(errorStats.total ?? 0),
            buffered: Number(errorStats.buffered ?? 0),
        },
    };
}

/**
 * Erros recentes e contadores do error tracker para a UX local.
 *
 * @param {number} limit
 * @returns {{
 *     stats: { total: number; buffered: number };
 *     recent: { timestamp: number; errorType?: string; source?: string; message: string }[];
 * }}
 */
export function readTerminalErrorsProjection(limit) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const stats =
        typeof defaultErrorTracker?.getStats === 'function'
            ? defaultErrorTracker.getStats()
            : { total: 0, buffered: 0 };
    const recent = typeof defaultErrorTracker?.getErrors === 'function' ? defaultErrorTracker.getErrors(safeLimit) : [];
    return {
        stats: {
            total: Number(stats.total ?? 0),
            buffered: Number(stats.buffered ?? 0),
        },
        recent,
    };
}

/**
 * Projeção instantânea de uso/context window para `/usage now`.
 *
 * @returns {{
 *     contextWindow: ContextWindowProjection | null;
 *     pr: Record<string, any> | null;
 *     runtimeSessionId: string | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 * }}
 */
export function readTerminalUsageNowProjection() {
    const base = readTerminalRuntimeBase();
    return {
        contextWindow: base.contextWindow,
        pr: /** @type {Record<string, any> | null} */ (base.agent.lastPrInfo ?? null),
        runtimeSessionId: base.runtimeSessionId,
        binding: base.binding,
    };
}

/**
 * Persiste uma memória semântica pelo frontend principal do terminal.
 *
 * @param {{ hubSessionId?: string | null; input: string }} input
 * @returns {{ ok: boolean; reason: string | null; tag: string; content: string; id: string | null }}
 */
export function rememberTerminalMemoryProjection({ hubSessionId = null, input }) {
    const match = input.match(/^([a-z0-9_-]+):\s*(.+)$/i);
    const tag = match ? (match[1] ?? 'geral') : 'geral';
    const content = match ? (match[2] ?? '').trim() : input.trim();
    if (!content) {
        return { ok: false, reason: 'empty-content', tag, content, id: null };
    }
    const id = conversationStore.storeMemory({
        tag,
        content,
        ...(hubSessionId ? { hubSessionId } : {}),
    });
    return { ok: true, reason: null, tag, content, id };
}

/**
 * Recupera memórias por tag ou busca full-text.
 *
 * @param {string} rawArg
 * @returns {{ isSearch: boolean; label: string | null; memories: Record<string, any>[] }}
 */
export function recallTerminalMemoriesProjection(rawArg) {
    const arg = rawArg.trim();
    const isSearch = arg.startsWith('?');
    const label = isSearch ? arg.slice(1).trim() : arg || null;
    const memories = conversationStore.recallMemories({
        ...(isSearch ? { search: label ?? '' } : label ? { tag: label } : {}),
        limit: 10,
    });
    return { isSearch, label, memories };
}

/**
 * Remove uma memória semântica pelo ID.
 *
 * @param {string} memoryId
 * @returns {boolean}
 */
export function forgetTerminalMemoryProjection(memoryId) {
    return conversationStore.deleteMemory(memoryId);
}

/**
 * Lista sessões disponíveis para o fluxo `/resume`.
 *
 * @param {{ currentHubSessionId?: string | null; limit?: number }} input
 * @returns {{ currentHubSessionId: string | null; sessions: Record<string, any>[] }}
 */
export function readTerminalResumeListProjection({ currentHubSessionId = null, limit = 5 }) {
    return {
        currentHubSessionId,
        sessions: conversationStore.listHubSessions({ limit, offset: 0 }),
    };
}

/**
 * Constrói o payload de retomada de uma sessão anterior.
 *
 * @param {{ token: string; limitTurns?: number }} input
 * @returns {{
 *     found: boolean;
 *     reason: string | null;
 *     target: Record<string, any> | null;
 *     turns: Record<string, any>[];
 *     summaryPrompt: string | null;
 * }}
 */
export function readTerminalResumeProjection({ token, limitTurns = 50 }) {
    const sessions = conversationStore.listHubSessions({ limit: 100, offset: 0 });
    const target = sessions.find((session) => session.id === token || session.id.startsWith(token)) ?? null;
    if (!target) {
        return { found: false, reason: 'session-not-found', target: null, turns: [], summaryPrompt: null };
    }
    const turns = conversationStore.readTurns(target.id, { limit: limitTurns, offset: 0 });
    if (turns.length === 0) {
        return { found: false, reason: 'session-empty', target, turns, summaryPrompt: null };
    }
    const lines = turns.map((turn) => {
        const roleLabel = turn.role === 'llm_b' ? 'LLM-B' : turn.role === 'llm_a' ? 'LLM-A' : 'Usuário';
        return `[${roleLabel}] ${turn.content}`;
    });
    const summaryPrompt =
        '[CONTEXTO DE SESSÃO ANTERIOR] Estou retomando a seguinte conversa. ' +
        'Leia o contexto abaixo e continue a partir daí:\n\n' +
        lines.join('\n\n');
    return { found: true, reason: null, target, turns, summaryPrompt };
}

/**
 * Busca full-text em turnos persistidos pelo frontend do terminal.
 *
 * @param {{ query: string; hubSessionId?: string | null; limit?: number }} input
 * @returns {{ available: boolean; reason: string | null; query: string; results: Record<string, any>[] }}
 */
export function searchTerminalTurnsProjection({ query, hubSessionId = null, limit = 10 }) {
    const trimmed = query.trim();
    if (!trimmed) {
        return { available: false, reason: 'empty-query', query: trimmed, results: [] };
    }
    if (!conversationHub.isReady || !conversationHub.store) {
        return { available: false, reason: 'hub-unavailable', query: trimmed, results: [] };
    }
    /** @type {{ query: string; limit: number; hubSessionId?: string }} */
    const searchOpts = { query: trimmed, limit };
    if (hubSessionId) searchOpts.hubSessionId = hubSessionId;
    const results = conversationHub.store.searchTurns(searchOpts);
    return { available: true, reason: null, query: trimmed, results };
}
