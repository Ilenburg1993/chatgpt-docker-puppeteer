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
    EMITTER_TASK_DELTA,
} from '#copilot/events';
import { log } from '../../ports/index.js';

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
 *     tryResolve: (
 *         turnStart: number,
 *         resolve: (reply: string) => void,
 *         finalizeReply: (turnStart: number, reply: string) => void,
 *     ) => boolean;
 *     snapshot: () => {
 *         dispatched: boolean;
 *         assistantMessageCandidate: string | null;
 *         deltaChars: number;
 *         pendingProtocolReply: string | null;
 *     };
 *     cleanup: () => void;
 * }}
 */
export function createDialogTurnOutputCollector(host, helpers) {
    if (typeof host.on !== 'function' || typeof host.off !== 'function') {
        return {
            markDispatched: () => {},
            onTurnEnd: () => () => {},
            tryResolve: () => false,
            snapshot: () => ({
                dispatched: false,
                assistantMessageCandidate: null,
                deltaChars: 0,
                pendingProtocolReply: null,
            }),
            cleanup: () => {},
        };
    }

    let dispatched = false;
    /** @type {string | null} */
    let assistantMessageCandidate = null;
    /** @type {string} */
    let deltaCandidate = '';
    /** @type {Set<() => void>} */
    const turnEndListeners = new Set();

    const onAssistantMessage = (/** @type {unknown} */ evt) => {
        if (!dispatched) return;
        const { content } = helpers.normalizeAssistantMessageEvent(evt);
        const normalized = helpers.normalizeAssistantReplyCandidate(content);
        if (normalized) {
            assistantMessageCandidate = normalized;
        }
    };

    const onDelta = (/** @type {unknown} */ rawEvt) => {
        if (!dispatched || !rawEvt || typeof rawEvt !== 'object') return;
        const chunk = Reflect.get(rawEvt, 'chunk');
        if (typeof chunk !== 'string' || chunk.length === 0) return;
        const remaining = MAX_DELTA_FALLBACK_CHARS - deltaCandidate.length;
        if (remaining > 0) {
            deltaCandidate += chunk.slice(0, remaining);
        }
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

    return {
        markDispatched: () => {
            dispatched = true;
            assistantMessageCandidate = null;
            deltaCandidate = '';
        },
        onTurnEnd: (listener) => {
            turnEndListeners.add(listener);
            return () => {
                turnEndListeners.delete(listener);
            };
        },
        tryResolve: (turnStart, resolve, finalizeReply) => {
            const pendingProtocolRawReply = helpers.readPendingProtocolSnapshot(host)?.reply ?? null;
            const pendingProtocolReply =
                typeof pendingProtocolRawReply === 'string'
                    ? helpers.normalizeAssistantReplyCandidate(pendingProtocolRawReply)
                    : null;
            const deltaReplyCandidate = helpers.normalizeAssistantReplyCandidate(deltaCandidate);
            const replySource = assistantMessageCandidate
                ? 'assistant.message'
                : deltaReplyCandidate
                  ? 'delta'
                  : pendingProtocolReply
                    ? 'pending_protocol'
                    : 'none';
            const reply = assistantMessageCandidate ?? deltaReplyCandidate ?? pendingProtocolReply ?? null;
            if (!reply) return false;
            assistantMessageCandidate = null;
            deltaCandidate = '';
            log(
                'DEBUG',
                `[DialogLoopManager] collector semântico resolveu o reply do dialog loop ` +
                    `(source=${replySource}, replyLen=${reply.length}, pendingProtocolReplyLen=${pendingProtocolReply?.length ?? 0}).`,
            );
            finalizeReply(turnStart, reply);
            resolve(reply);
            return true;
        },
        snapshot: () => ({
            dispatched,
            assistantMessageCandidate,
            deltaChars: deltaCandidate.length,
            pendingProtocolReply:
                typeof helpers.readPendingProtocolSnapshot(host)?.reply === 'string'
                    ? helpers.normalizeAssistantReplyCandidate(helpers.readPendingProtocolSnapshot(host)?.reply ?? '')
                    : null,
        }),
        cleanup: () => {
            turnEndListeners.clear();
            host.off?.(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
            host.off?.(EMITTER_DIALOG_DELTA, onDelta);
            host.off?.(EMITTER_TASK_DELTA, onDelta);
            host.off?.(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
        },
    };
}
