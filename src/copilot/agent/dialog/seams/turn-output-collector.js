// @ts-check
/**
 * @module copilot/agent/dialog/seams/turn-output-collector
 * @file Owner canônico de coleta semântica do output de um turno explícito do dialog loop.
 *
 *   Este seam consolida as pistas de resposta do turno explícito em um único collector no runtime do dialog:
 *
 *   - `assistant.message` → candidato textual final do SDK
 *   - `dialog.delta` / `task.delta` → streaming incremental útil para fallback
 *   - `assistant.turn_end` → gatilho de flush/resolução, não fonte de conteúdo
 *
 *   O objetivo é impedir que `channel/` e `terminal/` precisem reinterpretar semanticamente o turno.
 */

import {
    EMITTER_ASSISTANT_MESSAGE,
    EMITTER_ASSISTANT_TURN_END,
    EMITTER_DIALOG_DELTA,
    EMITTER_EXTERNAL_TOOL_COMPLETED,
    EMITTER_EXTERNAL_TOOL_REQUESTED,
    EMITTER_TASK_DELTA,
    EMITTER_TOOL_EXECUTION_COMPLETE,
    EMITTER_TOOL_EXECUTION_START,
} from '#copilot/events';
import { log } from '../../ports/logging/index.js';

const MAX_DELTA_FALLBACK_CHARS = 50_000;

/**
 * @param {any} host
 * @param {{
 *     normalizeAssistantMessageEvent: (evt: unknown) => { content: string; ts: number | null };
 *     normalizeAssistantReplyCandidate: (content: string) => string | null;
 *     readPendingProtocolSnapshot: (
 *         host: any,
 *     ) => { kind: 'reply' | 'ready' | 'stopped'; question: string; reply?: string } | null;
 * }} helpers
 * @returns {{
 *     markDispatched: () => void;
 *     onTurnEnd: (listener: () => void) => () => void;
 *     onAssistantMessageCandidate: (listener: () => void) => () => void;
 *     tryResolve: (
 *         turnStart: number,
 *         resolve: (reply: string) => void,
 *         finalizeReply: (turnStart: number, reply: string) => void,
 *         opts?: { allowDeltaFallback?: boolean },
 *     ) => boolean;
 *     snapshot: () => {
 *         dispatched: boolean;
 *         assistantMessageCandidate: string | null;
 *         assistantMessageCount: number;
 *         deltaChars: number;
 *         deltaEligible: boolean;
 *         pendingProtocolReply: string | null;
 *         pendingProtocolKind: 'reply' | 'ready' | 'stopped' | null;
 *         toolSignalCount: number;
 *         lastDeltaSeq: number;
 *         lastToolSignalSeq: number;
 *         lastResolutionSource: 'assistant.message' | 'delta' | 'pending_protocol' | null;
 *     };
 *     cleanup: () => void;
 * }}
 */
export function createDialogTurnOutputCollector(host, helpers) {
    if (typeof host.on !== 'function' || typeof host.off !== 'function') {
        return {
            markDispatched: () => {},
            onTurnEnd: () => () => {},
            onAssistantMessageCandidate: () => () => {},
            tryResolve: () => false,
            snapshot: () => ({
                dispatched: false,
                assistantMessageCandidate: null,
                assistantMessageCount: 0,
                deltaChars: 0,
                deltaEligible: false,
                pendingProtocolReply: null,
                pendingProtocolKind: null,
                toolSignalCount: 0,
                lastDeltaSeq: 0,
                lastToolSignalSeq: 0,
                lastResolutionSource: null,
            }),
            cleanup: () => {},
        };
    }

    let dispatched = false;
    /** @type {string | null} */
    let assistantMessageCandidate = null;
    /** @type {string} */
    let deltaCandidate = '';
    let assistantMessageCount = 0;
    let deltaCharsObserved = 0;
    let lastResolutionDeltaEligible = false;
    let signalSeq = 0;
    let lastDeltaSeq = 0;
    let lastToolSignalSeq = 0;
    let toolSignalCount = 0;
    /** @type {'assistant.message' | 'delta' | 'pending_protocol' | null} */
    let lastResolutionSource = null;
    /** @type {Set<() => void>} */
    const turnEndListeners = new Set();
    /** @type {Set<() => void>} */
    const assistantMessageCandidateListeners = new Set();

    /**
     * @returns {boolean}
     */
    function isDeltaCandidateEligible() {
        return deltaCandidate.length > 0 && (lastToolSignalSeq === 0 || lastDeltaSeq >= lastToolSignalSeq);
    }

    const onAssistantMessage = (/** @type {unknown} */ evt) => {
        if (!dispatched) return;
        const { content } = helpers.normalizeAssistantMessageEvent(evt);
        const normalized = helpers.normalizeAssistantReplyCandidate(content);
        if (normalized) {
            assistantMessageCandidate = normalized;
            assistantMessageCount += 1;
            for (const listener of [...assistantMessageCandidateListeners]) {
                listener();
            }
        }
    };

    const onDelta = (/** @type {unknown} */ rawEvt) => {
        if (!dispatched || !rawEvt || typeof rawEvt !== 'object') return;
        const chunk = Reflect.get(rawEvt, 'chunk');
        if (typeof chunk !== 'string' || chunk.length === 0) return;
        const remaining = MAX_DELTA_FALLBACK_CHARS - deltaCandidate.length;
        if (remaining > 0) {
            const appendable = chunk.slice(0, remaining);
            deltaCandidate += appendable;
            deltaCharsObserved += appendable.length;
            signalSeq += 1;
            lastDeltaSeq = signalSeq;
        }
    };

    const onToolSignal = () => {
        if (!dispatched) return;
        signalSeq += 1;
        lastToolSignalSeq = signalSeq;
        toolSignalCount += 1;
    };

    const onAssistantTurnEnd = () => {
        if (!dispatched) return;
        for (const listener of [...turnEndListeners]) {
            listener();
        }
    };

    host.on(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
    host.on(EMITTER_DIALOG_DELTA, onDelta);
    host.on(EMITTER_TASK_DELTA, onDelta);
    host.on(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
    host.on(EMITTER_TOOL_EXECUTION_START, onToolSignal);
    host.on(EMITTER_TOOL_EXECUTION_COMPLETE, onToolSignal);
    host.on(EMITTER_EXTERNAL_TOOL_REQUESTED, onToolSignal);
    host.on(EMITTER_EXTERNAL_TOOL_COMPLETED, onToolSignal);

    return {
        markDispatched: () => {
            dispatched = true;
            assistantMessageCandidate = null;
            deltaCandidate = '';
            assistantMessageCount = 0;
            deltaCharsObserved = 0;
            lastResolutionDeltaEligible = false;
            signalSeq = 0;
            lastDeltaSeq = 0;
            lastToolSignalSeq = 0;
            toolSignalCount = 0;
            lastResolutionSource = null;
        },
        onTurnEnd: (listener) => {
            turnEndListeners.add(listener);
            return () => {
                turnEndListeners.delete(listener);
            };
        },
        onAssistantMessageCandidate: (listener) => {
            assistantMessageCandidateListeners.add(listener);
            return () => {
                assistantMessageCandidateListeners.delete(listener);
            };
        },
        tryResolve: (turnStart, resolve, finalizeReply, opts = {}) => {
            const pendingProtocolRawReply = helpers.readPendingProtocolSnapshot(host)?.reply ?? null;
            const pendingProtocolReply =
                typeof pendingProtocolRawReply === 'string'
                    ? helpers.normalizeAssistantReplyCandidate(pendingProtocolRawReply)
                    : null;
            const allowDeltaFallback = opts.allowDeltaFallback !== false;
            const deltaReplyCandidate =
                allowDeltaFallback && isDeltaCandidateEligible()
                    ? helpers.normalizeAssistantReplyCandidate(deltaCandidate)
                    : null;
            const replySource = assistantMessageCandidate
                ? 'assistant.message'
                : deltaReplyCandidate
                  ? 'delta'
                  : pendingProtocolReply
                    ? 'pending_protocol'
                    : 'none';
            const reply = assistantMessageCandidate ?? deltaReplyCandidate ?? pendingProtocolReply ?? null;
            if (!reply) return false;
            lastResolutionSource = replySource === 'none' ? null : replySource;
            lastResolutionDeltaEligible = isDeltaCandidateEligible();
            assistantMessageCandidate = null;
            deltaCandidate = '';
            signalSeq = 0;
            lastDeltaSeq = 0;
            lastToolSignalSeq = 0;
            log(
                'DEBUG',
                `[DialogLoopManager] collector semântico resolveu o reply do dialog loop ` +
                    `(source=${replySource}, replyLen=${reply.length}, pendingProtocolReplyLen=${pendingProtocolReply?.length ?? 0}).`,
            );
            finalizeReply(turnStart, reply);
            resolve(reply);
            return true;
        },
        snapshot: () => {
            const pendingProtocol = helpers.readPendingProtocolSnapshot(host);
            return {
                dispatched,
                assistantMessageCandidate,
                assistantMessageCount,
                deltaChars: deltaCharsObserved,
                deltaEligible: lastResolutionSource ? lastResolutionDeltaEligible : isDeltaCandidateEligible(),
                pendingProtocolReply:
                    typeof pendingProtocol?.reply === 'string'
                        ? helpers.normalizeAssistantReplyCandidate(pendingProtocol.reply)
                        : null,
                pendingProtocolKind: pendingProtocol?.kind ?? null,
                toolSignalCount,
                lastDeltaSeq,
                lastToolSignalSeq,
                lastResolutionSource,
            };
        },
        cleanup: () => {
            turnEndListeners.clear();
            assistantMessageCandidateListeners.clear();
            host.off?.(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
            host.off?.(EMITTER_DIALOG_DELTA, onDelta);
            host.off?.(EMITTER_TASK_DELTA, onDelta);
            host.off?.(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
            host.off?.(EMITTER_TOOL_EXECUTION_START, onToolSignal);
            host.off?.(EMITTER_TOOL_EXECUTION_COMPLETE, onToolSignal);
            host.off?.(EMITTER_EXTERNAL_TOOL_REQUESTED, onToolSignal);
            host.off?.(EMITTER_EXTERNAL_TOOL_COMPLETED, onToolSignal);
        },
    };
}
