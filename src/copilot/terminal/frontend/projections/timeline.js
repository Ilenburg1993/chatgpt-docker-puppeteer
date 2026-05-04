// @ts-check
/**
 * Projection family: timeline.
 *
 * Consolida a timeline canônica do terminal a partir do Conversation Hub persistido e do histórico vivo do transporte
 * LLM-A ↔ LLM-B.
 */

import { getWorkspaceContext } from '#copilot/boot';
import { sendRuntimeDialogTurnForRuntime } from '../../../presentation/runtime-dialog.js';
import { readTerminalSessionBinding } from '../gateways/agent-runtime.js';
import { clearTerminalHistoryFeed, readTerminalHistoryFeed, seedTerminalHistoryFeed } from '../gateways/dialog.js';
import { countTerminalHubTurns, readTerminalHubTurns } from '../gateways/hub.js';
import { readTerminalRuntimeBase } from './shared.js';

/** @typedef {'hub' | 'bridge' | 'mixed' | 'empty'} TerminalTimelineSource */
/** @typedef {'persistent' | 'transport' | 'reconciled' | 'none'} TerminalTimelineAuthority */
/** @typedef {'persistent_only' | 'bridge_only' | 'aligned' | 'bridge_tail' | 'diverged' | 'empty'} TerminalTimelineReconciliation */

/**
 * @typedef {{
 *     role: string;
 *     rawRole: string;
 *     content: string;
 *     timestamp: number;
 *     persisted: boolean;
 *     origin: 'hub' | 'bridge';
 *     turnId: number | null;
 *     sdkTurnId: string | null;
 * }} TerminalTimelineTurn
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTimelineRole(value) {
    const role = typeof value === 'string' ? value : 'assistant';
    if (role === 'llm_b' || role === 'assistant') return 'assistant';
    if (role === 'llm_a') return 'llm_a';
    if (role === 'user') return 'user';
    return role;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeTimestamp(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {Record<string, unknown>} turn
 * @param {number} index
 * @returns {TerminalTimelineTurn}
 */
function mapHubTimelineTurn(turn, index) {
    const rawRole = typeof turn['role'] === 'string' ? turn['role'] : 'assistant';
    /** @type {Record<string, unknown> | null} */
    let metadata = null;
    if (typeof turn['metadata'] === 'string' && turn['metadata']) {
        try {
            metadata = /** @type {Record<string, unknown>} */ (JSON.parse(turn['metadata']));
        } catch {
            metadata = null;
        }
    }
    const sdkTurnId =
        typeof turn['sdk_turn_id'] === 'string'
            ? turn['sdk_turn_id']
            : typeof metadata?.['sdkTurnId'] === 'string'
              ? metadata['sdkTurnId']
              : null;
    return {
        role: normalizeTimelineRole(rawRole),
        rawRole,
        content: typeof turn['content'] === 'string' ? turn['content'] : String(turn['content'] ?? ''),
        timestamp: normalizeTimestamp(turn['created_at'], Date.now() + index),
        persisted: true,
        origin: 'hub',
        turnId: typeof turn['id'] === 'number' ? turn['id'] : null,
        sdkTurnId,
    };
}

/**
 * @param {{ role: string; content: string; timestamp?: number }} turn
 * @param {number} index
 * @returns {TerminalTimelineTurn}
 */
function mapBridgeTimelineTurn(turn, index) {
    const rawRole = typeof turn.role === 'string' ? turn.role : 'assistant';
    return {
        role: normalizeTimelineRole(rawRole),
        rawRole,
        content: typeof turn.content === 'string' ? turn.content : String(turn.content ?? ''),
        timestamp: normalizeTimestamp(turn.timestamp, Date.now() + index),
        persisted: false,
        origin: 'bridge',
        turnId: null,
        sdkTurnId: null,
    };
}

/**
 * @param {TerminalTimelineTurn} turn
 * @returns {string}
 */
function buildTimelineSignature(turn) {
    return `${turn.role}\u241f${turn.content.trim()}`;
}

/**
 * Retorna o maior overlap em que o final do hub coincide com o início do bridge.
 *
 * @param {TerminalTimelineTurn[]} persistedTurns
 * @param {TerminalTimelineTurn[]} bridgeTurns
 * @returns {number}
 */
function computeHubBridgeOverlap(persistedTurns, bridgeTurns) {
    const maxOverlap = Math.min(persistedTurns.length, bridgeTurns.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const persistedSlice = persistedTurns.slice(-overlap);
        const bridgeSlice = bridgeTurns.slice(0, overlap);
        const isMatch = persistedSlice.every((turn, index) => {
            const candidate = bridgeSlice[index];
            return candidate ? buildTimelineSignature(turn) === buildTimelineSignature(candidate) : false;
        });
        if (isMatch) return overlap;
    }
    return 0;
}

/**
 * @param {string} hubSessionId
 * @param {number} limitTurns
 * @param {number} newestOffset
 * @returns {{ totalTurns: number; effectiveOffset: number; turns: Record<string, unknown>[] }}
 */
function readLatestTerminalHubTurnsWindow(hubSessionId, limitTurns, newestOffset) {
    const totalTurns = countTerminalHubTurns(hubSessionId);
    const safeLimit = Math.max(1, Math.trunc(limitTurns));
    const safeNewestOffset = Math.max(0, Math.trunc(newestOffset));
    const effectiveOffset = Math.max(totalTurns - safeLimit - safeNewestOffset, 0);
    return {
        totalTurns,
        effectiveOffset,
        turns: readTerminalHubTurns(hubSessionId, { limit: safeLimit, offset: effectiveOffset }),
    };
}

/**
 * @param {{ limitPairs?: number; runtimeId?: string | null; newestOffset?: number }} [input]
 * @returns {{
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     timelineSource: TerminalTimelineSource;
 *     timelineAuthority: TerminalTimelineAuthority;
 *     reconciliationStatus: TerminalTimelineReconciliation;
 *     totalPersistedTurns: number;
 *     effectiveOffset: number;
 *     bridgeTurnCount: number;
 *     liveBridgeTailCount: number;
 *     overlapCount: number;
 *     turns: TerminalTimelineTurn[];
 * }}
 */
export function readTerminalTimelineProjection({ limitPairs = 10, runtimeId = null, newestOffset = 0 } = {}) {
    const base = readTerminalRuntimeBase(runtimeId);
    const binding = readTerminalSessionBinding();
    const hubSessionId = binding.hubSessionId ?? base.binding.hubSessionId ?? null;
    const limitTurns = Math.max(1, Math.trunc(limitPairs * 2));

    const bridgeTurns = readTerminalHistoryFeed().slice(-limitTurns).map(mapBridgeTimelineTurn);

    /** @type {TerminalTimelineTurn[]} */
    let persistedTurns = [];
    let totalPersistedTurns = 0;
    let effectiveOffset = 0;
    if (hubSessionId) {
        const persistedWindow = readLatestTerminalHubTurnsWindow(hubSessionId, limitTurns, newestOffset);
        totalPersistedTurns = persistedWindow.totalTurns;
        effectiveOffset = persistedWindow.effectiveOffset;
        persistedTurns = persistedWindow.turns.map(mapHubTimelineTurn);
    }

    /** @type {TerminalTimelineSource} */
    let timelineSource = 'empty';
    /** @type {TerminalTimelineAuthority} */
    let timelineAuthority = 'none';
    /** @type {TerminalTimelineReconciliation} */
    let reconciliationStatus = 'empty';
    /** @type {TerminalTimelineTurn[]} */
    let turns = [];
    let overlapCount = 0;
    let liveBridgeTailCount = 0;

    if (persistedTurns.length > 0) {
        turns = persistedTurns;
        timelineSource = 'hub';
        timelineAuthority = 'persistent';
        reconciliationStatus = 'persistent_only';

        if (bridgeTurns.length > 0) {
            overlapCount = computeHubBridgeOverlap(persistedTurns, bridgeTurns);
            if (overlapCount === bridgeTurns.length) {
                reconciliationStatus = 'aligned';
            } else if (overlapCount > 0) {
                const liveTail = bridgeTurns.slice(overlapCount);
                if (liveTail.length > 0) {
                    turns = [...persistedTurns, ...liveTail];
                    timelineSource = 'mixed';
                    timelineAuthority = 'reconciled';
                    reconciliationStatus = 'bridge_tail';
                    liveBridgeTailCount = liveTail.length;
                } else {
                    reconciliationStatus = 'aligned';
                }
            } else {
                reconciliationStatus = 'diverged';
            }
        }
    } else if (bridgeTurns.length > 0) {
        turns = bridgeTurns;
        timelineSource = 'bridge';
        timelineAuthority = 'transport';
        reconciliationStatus = 'bridge_only';
    }

    return {
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        hubSessionId,
        sdkSessionId: binding.sdkSessionId,
        timelineSource,
        timelineAuthority,
        reconciliationStatus,
        totalPersistedTurns,
        effectiveOffset,
        bridgeTurnCount: bridgeTurns.length,
        liveBridgeTailCount,
        overlapCount,
        turns,
    };
}

/**
 * @param {number} [limitPairs=10] Default is `10`
 * @param {string | null | undefined} [runtimeId]
 * @returns {TerminalTimelineTurn[]}
 */
export function readTerminalHistoryProjection(limitPairs = 10, runtimeId) {
    return readTerminalTimelineProjection({ limitPairs, runtimeId: runtimeId ?? null }).turns;
}

/**
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
 *     timelineSource: TerminalTimelineSource;
 *     timelineAuthority: TerminalTimelineAuthority;
 *     reconciliationStatus: TerminalTimelineReconciliation;
 *     hasPersistentHistory: boolean;
 *     persistedTurnCount: number;
 *     bridgeTurnCount: number;
 *     liveBridgeTailCount: number;
 * }}
 */
export function readTerminalContextProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const timeline = readTerminalTimelineProjection({ limitPairs: 50, runtimeId: runtimeId ?? null });
    const history = timeline.turns;

    let totalChars = 0;
    for (const turn of history) {
        totalChars += turn.content.length;
    }

    const isRealData = Boolean(base.contextWindow);
    const usedTokens = isRealData ? (base.contextWindow?.tokens ?? 0) : Math.ceil(totalChars / 4);
    const maxTokens = isRealData ? (base.contextWindow?.tokenLimit ?? 0) : 128_000;
    const utilization = isRealData ? (base.contextWindow?.utilization ?? 0) : Math.min(usedTokens / maxTokens, 1);

    return {
        hasHistory: history.length > 0,
        totalChars,
        turnCount: history.length,
        usedTokens,
        maxTokens,
        utilization,
        isRealData,
        workspace: getWorkspaceContext(),
        timelineSource: timeline.timelineSource,
        timelineAuthority: timeline.timelineAuthority,
        reconciliationStatus: timeline.reconciliationStatus,
        hasPersistentHistory: timeline.totalPersistedTurns > 0,
        persistedTurnCount: timeline.totalPersistedTurns,
        bridgeTurnCount: timeline.bridgeTurnCount,
        liveBridgeTailCount: timeline.liveBridgeTailCount,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     ok: boolean;
 *     reply: string | null;
 *     estimatedTokens: number | null;
 *     runtimeId: string | null;
 *     timelineSourceBeforeCompaction: TerminalTimelineSource;
 * }>}
 */
export async function requestTerminalCompactionProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const resolvedRuntimeId = base.runtimeId;
    const timeline = readTerminalTimelineProjection({ limitPairs: 50, runtimeId: runtimeId ?? null });
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
        return {
            ok: false,
            reply: null,
            estimatedTokens: null,
            runtimeId: resolvedRuntimeId,
            timelineSourceBeforeCompaction: timeline.timelineSource,
        };
    }

    clearTerminalHistoryFeed();
    seedTerminalHistoryFeed('assistant', reply);

    return {
        ok: true,
        reply,
        estimatedTokens: Math.ceil((reply?.length ?? 0) / 4),
        runtimeId: resolvedRuntimeId,
        timelineSourceBeforeCompaction: timeline.timelineSource,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalHistory() {
    clearTerminalHistoryFeed();
}

/**
 * @param {{ hubSessionId?: string | null; limit?: number; offset?: number }} input
 * @returns {{
 *     available: boolean;
 *     reason: string | null;
 *     turns: Record<string, unknown>[];
 *     limit: number;
 *     offset: number;
 *     effectiveOffset: number;
 *     totalTurns: number;
 * }}
 */
export function readTerminalDbHistoryProjection({ hubSessionId = null, limit = 20, offset = 0 }) {
    if (!hubSessionId) {
        return {
            available: false,
            reason: 'no-hub-session',
            turns: [],
            limit,
            offset,
            effectiveOffset: 0,
            totalTurns: 0,
        };
    }

    const window = readLatestTerminalHubTurnsWindow(hubSessionId, limit, offset);
    return {
        available: true,
        reason: null,
        turns: window.turns,
        limit,
        offset,
        effectiveOffset: window.effectiveOffset,
        totalTurns: window.totalTurns,
    };
}
