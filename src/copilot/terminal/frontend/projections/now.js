// @ts-check
/**
 * Projection family: now.
 *
 * Cobre todas as projeções de estado imediato, histórico, contexto, diagnóstico, memórias, snapshots, retomada de
 * sessão e busca full-text.
 */

import { getWorkspaceContext } from '#copilot/boot';
import { getMcpStatus } from '#copilot/bridges';
import { sendRuntimeDialogTurnForRuntime } from '../../../presentation/runtime-dialog.js';
import { readRuntimeLifecycleSnapshot } from '../../../presentation/runtime-lifecycle.js';
import { listActiveRuntimeTodosProjection } from '../../../presentation/runtime-todos.js';
import {
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getSdkSessionMode,
} from '../../../presentation/runtime-ui-state-store.js';
import { readToolStatsProjection } from '../../../presentation/system-metrics.js';
import { readTerminalActivityHistory, readTerminalActivitySnapshot } from '../../activity-state.js';
import { readTerminalDisplayState } from '../../display-policy.js';
import {
    answerTerminalPendingQuestion,
    clearTerminalPendingQuestionShadow,
    createTerminalSnapshot,
    listTerminalSnapshots,
    loadTerminalSnapshot,
    readTerminalSessionBinding,
    saveTerminalSnapshot,
} from '../gateways/agent-runtime.js';
import { clearTerminalHistoryFeed, readTerminalHistoryFeed, seedTerminalHistoryFeed } from '../gateways/dialog.js';
import {
    canSearchTerminalHubTurns,
    deleteTerminalHubMemory,
    isTerminalHubReady,
    readTerminalHubMemories,
    readTerminalHubSession,
    readTerminalHubSessions,
    readTerminalHubTurns,
    searchTerminalHubTurns,
    storeTerminalHubMemory,
} from '../gateways/hub.js';
import { readTerminalRuntimeBase } from './shared.js';

// ---------------------------------------------------------------------------
// Activity & display
// ---------------------------------------------------------------------------

/**
 * @param {number} [limit=10] Default is `10`
 * @returns {{
 *     current: import('../../activity-state.js').TerminalActivitySnapshot;
 *     history: import('../../activity-state.js').TerminalActivityHistoryEntry[];
 * }}
 */
export function readTerminalActivityProjection(limit = 10) {
    return {
        current: readTerminalActivitySnapshot(),
        history: readTerminalActivityHistory(limit),
    };
}

/**
 * @returns {{ thinking: boolean; streaming: boolean; usage: boolean; tools: boolean; intent: boolean }}
 */
export function readTerminalDisplayProjection() {
    return readTerminalDisplayState();
}

// ---------------------------------------------------------------------------
// History & context
// ---------------------------------------------------------------------------

/**
 * Retorna o histórico em memória do bridge LLM-A ↔ LLM-B.
 *
 * @param {number} [limitPairs=10] Default is `10`
 * @returns {{ role: string; content: string; timestamp: number }[]}
 */
export function readTerminalHistoryProjection(limitPairs = 10) {
    return readTerminalHistoryFeed()
        .slice(-limitPairs * 2)
        .map(
            (
                /** @type {{ role: string; content: string; timestamp?: number }} */ turn,
                /** @type {number} */ index,
            ) => ({
                ...turn,
                timestamp: turn.timestamp ?? Date.now() + index,
            }),
        );
}

/**
 * Projeção consolidada do uso de contexto da LLM-B para o terminal.
 *
 * @param {string | null | undefined} [runtimeId]
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
export function readTerminalContextProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const history = /** @type {{ role: string; content: string }[]} */ (readTerminalHistoryFeed());

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
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ ok: boolean; reply: string | null; estimatedTokens: number | null; runtimeId: string | null }>}
 */
export async function requestTerminalCompactionProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const resolvedRuntimeId = base.runtimeId;
    const reply = await sendRuntimeDialogTurnForRuntime(
        '[SISTEMA] Compacte toda esta conversa em um resumo técnico denso. Preserve: ' +
            'todos os fatos, código, decisões, estados e contexto de arquivos discutidos. ' +
            'Responda APENAS com esse resumo. Após isso, considere o resumo como o novo ' +
            'contexto inicial desta sessão.',
        'user',
        undefined,
        runtimeId,
    );
    if (!reply) {
        return { ok: false, reply: null, estimatedTokens: null, runtimeId: resolvedRuntimeId };
    }

    clearTerminalHistoryFeed();
    seedTerminalHistoryFeed('assistant', reply);

    return {
        ok: true,
        reply,
        estimatedTokens: Math.ceil((reply?.length ?? 0) / 4),
        runtimeId: resolvedRuntimeId,
    };
}

/**
 * Limpa o histórico em memória do canal.
 *
 * @returns {void}
 */
export function clearTerminalHistory() {
    clearTerminalHistoryFeed();
}

// ---------------------------------------------------------------------------
// Pending questions
// ---------------------------------------------------------------------------

/**
 * Encaminha uma resposta à pergunta pendente do runtime.
 *
 * @param {string} answer
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function answerPendingTerminalQuestion(answer, runtimeId) {
    return answerTerminalPendingQuestion(answer, runtimeId);
}

/**
 * Limpa explicitamente a shadow persistida de `ask_user` restaurada do disco.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function clearPendingTerminalQuestionShadow(runtimeId) {
    return clearTerminalPendingQuestionShadow(runtimeId);
}

// ---------------------------------------------------------------------------
// Database / hub history
// ---------------------------------------------------------------------------

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
        turns: readTerminalHubTurns(hubSessionId, { limit, offset }),
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
        sessions: readTerminalHubSessions({ limit, offset: 0 }),
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
    const binding = readTerminalSessionBinding();
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
    const turns = readTerminalHubTurns(hubSessionId, { limit: 9999, offset: 0 });
    const memories = readTerminalHubMemories({ limit: 9999 });
    return {
        available: true,
        reason: null,
        hubSessionId,
        sdkSessionId: binding.sdkSessionId,
        turns: turns.length,
        userTurns: turns.filter((turn) => turn['role'] === 'user').length,
        llmBTurns: turns.filter((turn) => turn['role'] === 'llm_b').length,
        memories: memories.length,
    };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Salva snapshot manual da sessão atual.
 *
 * @param {string | undefined} reason
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ data: Record<string, any>; path: string }>}
 */
export async function saveTerminalSnapshotProjection(reason, runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const { snap } = base;
    const pendingQuestion =
        base.pendingQuestion && typeof base.pendingQuestion === 'object' ? base.pendingQuestion : null;
    const pendingQuestionShadow =
        base.pendingQuestionShadow && typeof base.pendingQuestionShadow === 'object'
            ? base.pendingQuestionShadow
            : null;
    const data = createTerminalSnapshot({
        sessionId: base.sessionId ?? null,
        model: String(snap['model'] ?? 'unknown'),
        status: String(snap['status'] ?? 'unknown'),
        sendCount: Number(snap['sendCount'] ?? 0),
        dialogLoopActive: base.dialogLoopActive,
        dialogPaused: Boolean(snap['dialogPaused']),
        pendingQuestion: snap['pendingQuestion'] ? String(snap['pendingQuestion']) : null,
        pendingQuestionMeta:
            pendingQuestion !== null
                ? {
                      kind: pendingQuestion.kind,
                      askedAt: pendingQuestion.askedAt,
                      allowFreeform: pendingQuestion.allowFreeform,
                      protocolControlled: pendingQuestion.protocolControlled,
                      ...(pendingQuestion.choices !== undefined ? { choices: pendingQuestion.choices } : {}),
                  }
                : null,
        pendingQuestionShadow:
            pendingQuestionShadow !== null
                ? {
                      question: pendingQuestionShadow.question,
                      meta: {
                          kind: pendingQuestionShadow.meta.kind,
                          askedAt: pendingQuestionShadow.meta.askedAt,
                          allowFreeform: pendingQuestionShadow.meta.allowFreeform,
                          protocolControlled: pendingQuestionShadow.meta.protocolControlled,
                          ...(pendingQuestionShadow.meta.choices !== undefined
                              ? { choices: pendingQuestionShadow.meta.choices }
                              : {}),
                      },
                      restoredAt: pendingQuestionShadow.restoredAt,
                      expiresAt: pendingQuestionShadow.expiresAt,
                  }
                : null,
        prMetrics:
            /** @type {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} */ (
                base.dialogPrMetrics ?? null
            ),
        reason: reason || 'manual',
    });
    const path = await saveTerminalSnapshot(data);
    return { data, path };
}

/**
 * Lista snapshots disponíveis.
 *
 * @returns {Promise<Record<string, any>[]>}
 */
export async function listTerminalSnapshotsProjection() {
    return listTerminalSnapshots();
}

/**
 * Carrega um snapshot específico.
 *
 * @param {string} snapshotId
 * @returns {Promise<Record<string, any> | null>}
 */
export async function loadTerminalSnapshotProjection(snapshotId) {
    return loadTerminalSnapshot(snapshotId);
}

// ---------------------------------------------------------------------------
// Memory (hub)
// ---------------------------------------------------------------------------

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
    const id = storeTerminalHubMemory({ tag, content, ...(hubSessionId ? { hubSessionId } : {}) });
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
    const memories = readTerminalHubMemories({
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
    return deleteTerminalHubMemory(memoryId);
}

// ---------------------------------------------------------------------------
// Resume / search
// ---------------------------------------------------------------------------

/**
 * Lista sessões disponíveis para o fluxo `/resume`.
 *
 * @param {{ currentHubSessionId?: string | null; limit?: number }} input
 * @returns {{ currentHubSessionId: string | null; sessions: Record<string, any>[] }}
 */
export function readTerminalResumeListProjection({ currentHubSessionId = null, limit = 5 }) {
    return {
        currentHubSessionId,
        sessions: readTerminalHubSessions({ limit, offset: 0 }),
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
    const sessions = readTerminalHubSessions({ limit: 100, offset: 0 });
    const target =
        sessions.find((session) => {
            const sessionId = typeof session['id'] === 'string' ? session['id'] : '';
            return sessionId === token || sessionId.startsWith(token);
        }) ?? null;
    if (!target) {
        return { found: false, reason: 'session-not-found', target: null, turns: [], summaryPrompt: null };
    }
    const targetId = typeof target['id'] === 'string' ? target['id'] : '';
    const turns = readTerminalHubTurns(targetId, { limit: limitTurns, offset: 0 });
    if (turns.length === 0) {
        return { found: false, reason: 'session-empty', target, turns, summaryPrompt: null };
    }
    const lines = turns.map((turn) => {
        const roleLabel = turn['role'] === 'llm_b' ? 'LLM-B' : turn['role'] === 'llm_a' ? 'LLM-A' : 'Usuário';
        return `[${roleLabel}] ${turn['content']}`;
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
    if (!canSearchTerminalHubTurns()) {
        return { available: false, reason: 'hub-unavailable', query: trimmed, results: [] };
    }
    /** @type {{ query: string; limit: number; hubSessionId?: string }} */
    const searchOpts = { query: trimmed, limit };
    if (hubSessionId) searchOpts.hubSessionId = hubSessionId;
    const results = searchTerminalHubTurns(searchOpts);
    return { available: true, reason: null, query: trimmed, results };
}

// ---------------------------------------------------------------------------
// Diagnose
// ---------------------------------------------------------------------------

/**
 * Lê a projeção diagnóstica consolidada do terminal.
 *
 * @param {{ hubSessionId?: string | null; runtimeId?: string | null }} [input]
 * @returns {Promise<{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     dialogLoopActive: boolean;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeId: string;
 *     runtimeSessionId: string | null;
 *     mcp: ReturnType<typeof getMcpStatus>;
 *     memMB: number;
 *     uptimeSec: number;
 *     hub: { ready: boolean; activeHubSessionId: string | null; summary: string };
 *     todos: { id: string; title: string; status: string }[];
 *     topToolStats: [string, Record<string, any>][];
 *     activity: import('../../activity-state.js').TerminalActivitySnapshot;
 *     display: ReturnType<typeof readTerminalDisplayProjection>;
 *     lifecycle: ReturnType<typeof readRuntimeLifecycleSnapshot>;
 *     sdkSessionMode: 'interactive' | 'plan' | 'autopilot' | 'shell' | null;
 *     sdkPlanOperation: 'create' | 'update' | 'delete' | null;
 *     sdkPlanChangedAt: number | null;
 * }>}
 */
export async function readTerminalDiagnoseProjection({ hubSessionId = null, runtimeId = null } = {}) {
    const base = readTerminalRuntimeBase(runtimeId);
    const mcp = getMcpStatus();
    const memMB = Math.round(process.memoryUsage().rss / 1_048_576);
    const uptimeSec = Math.round(process.uptime());

    let summary = 'sem storage';
    if (isTerminalHubReady() && hubSessionId) {
        try {
            const session = readTerminalHubSession(hubSessionId);
            summary = session ? `sessão ${hubSessionId.slice(0, 8)}…` : 'sessão não encontrada no store';
        } catch {
            summary = 'erro ao consultar store';
        }
    } else if (!isTerminalHubReady()) {
        summary = 'hub não inicializado';
    }

    const todos = await listActiveRuntimeTodosProjection({ limit: 5 }).catch(() => []);

    const topToolStats = readToolStatsProjection()
        .entries.sort(([, a], [, b]) => Number(b['avgLatencyMs'] ?? 0) - Number(a['avgLatencyMs'] ?? 0))
        .slice(0, 5);

    return {
        snap: base.snap,
        health: base.health,
        dialogLoopActive: base.dialogLoopActive,
        binding: base.binding,
        runtimeId: base.runtimeId,
        runtimeSessionId: base.runtimeSessionId,
        mcp,
        memMB,
        uptimeSec,
        hub: {
            ready: isTerminalHubReady(),
            activeHubSessionId: hubSessionId ?? base.binding.hubSessionId ?? null,
            summary,
        },
        todos,
        topToolStats,
        activity: readTerminalActivitySnapshot(),
        display: readTerminalDisplayProjection(),
        lifecycle: readRuntimeLifecycleSnapshot(),
        sdkSessionMode: getSdkSessionMode(),
        sdkPlanOperation: getLastSdkPlanOperation(),
        sdkPlanChangedAt: getLastSdkPlanChangedAt(),
    };
}
