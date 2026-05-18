// @ts-check
/**
 * @module copilot/presentation/runtime-ui-state-store
 * @file Store compartilhada do estado operacional/UI do terminal.
 *
 *   Esta store é dona arquitetural de busy state, fase, histórico de inject, histórico de thinking, attachment queue e
 *   toggles visuais do terminal.
 */

import {
    getTerminalInterventionMailboxPolicy,
    TERMINAL_MAX_ATTACHMENTS,
    TERMINAL_MAX_INJECT_HISTORY,
    TERMINAL_MAX_INTERVENTION_MAILBOX,
    TERMINAL_MAX_LISTENERS,
    TERMINAL_SHOW_INTENT_ACTIVITY,
    TERMINAL_SHOW_STREAMING,
    TERMINAL_SHOW_THINKING,
    TERMINAL_SHOW_TOOL_ACTIVITY,
    TERMINAL_SHOW_USAGE,
} from '#copilot/config';
import { getHubSessionId as _getCoreHubSessionId, CopilotError, setSharedHubSessionId } from '#copilot/core';
import { EventEmitter } from 'node:events';

export const stateEmitter = new EventEmitter();
stateEmitter.setMaxListeners(TERMINAL_MAX_LISTENERS);

export const TERMINAL_EVENTS = /** @type {const} */ ({
    HUB_SESSION_CHANGED: 'hubSessionId:changed',
    BUSY_CHANGED: 'busy:changed',
    SDK_SESSION_MODE_CHANGED: 'sdkSessionMode:changed',
    SDK_PLAN_OPERATION_CHANGED: 'sdkPlanOperation:changed',
    THINKING_HISTORY_CHANGED: 'thinkingHistory:changed',
    SHOW_THINKING_CHANGED: 'showThinking:changed',
    SHOW_USAGE_CHANGED: 'showUsage:changed',
    SHOW_STREAMING_CHANGED: 'showStreaming:changed',
    SHOW_TOOL_ACTIVITY_CHANGED: 'showToolActivity:changed',
    SHOW_INTENT_ACTIVITY_CHANGED: 'showIntentActivity:changed',
    SHOW_SESSION_ACTIVITY_CHANGED: 'showSessionActivity:changed',
    INTERVENTION_MAILBOX_CHANGED: 'interventionMailbox:changed',
});

let _busy = false;
/** @type {import('node:readline').Interface | null} */
let _rl = null;

/**
 * @typedef {string
 *     | {
 *           type?: string;
 *           path?: string;
 *           filePath?: string;
 *           displayName?: string;
 *           content?: string;
 *           text?: string;
 *           data?: string;
 *           mimeType?: string;
 *           selection?: Record<string, unknown>;
 *       }} TerminalAttachmentQueueEntry
 */

/** @type {TerminalAttachmentQueueEntry[]} */
let _attachmentQueue = [];
const MAX_ATTACHMENT_QUEUE = TERMINAL_MAX_ATTACHMENTS;

/**
 * @typedef {object} RuntimeInterventionMailboxEntry
 * @property {string} id
 * @property {number} ts
 * @property {string} runtimeId
 * @property {'terminal' | 'inject' | 'llm-a' | 'user' | 'system'} source
 * @property {'answer' | 'steer' | 'interrupt' | 'queue' | 'deferred'} modeHint Dica operacional preservada no mailbox
 *   zero-PR. `queue` aqui NÃO significa fila de turno SDK; significa que a intenção veio de `/queue`, `mode=queue` ou
 *   texto livre e deve ser aplicada somente via `ask_user`.
 * @property {string} message
 * @property {number} mergedCount
 */

/**
 * @typedef {{
 *     runtimeId: string;
 *     entries: RuntimeInterventionMailboxEntry[];
 *     dropped: number;
 *     updatedAt: number;
 * }} RuntimeInterventionMailboxState
 */

/** @type {Map<string, RuntimeInterventionMailboxState>} */
const _runtimeInterventionMailbox = new Map();
let _runtimeInterventionSeq = 0;

/**
 * @param {string | null | undefined} runtimeId
 * @returns {string}
 */
function _normalizeInterventionRuntimeId(runtimeId) {
    return typeof runtimeId === 'string' && runtimeId.trim().length > 0 ? runtimeId : 'default';
}

/**
 * @returns {string}
 */
function _nextInterventionId() {
    _runtimeInterventionSeq += 1;
    return `iv-${Date.now().toString(36)}-${_runtimeInterventionSeq.toString(36)}`;
}

/**
 * @param {string} value
 * @param {number} maxChars
 * @returns {string}
 */
function _truncateInterventionMessage(value, maxChars) {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {RuntimeInterventionMailboxState}
 */
function _ensureRuntimeInterventionMailbox(runtimeId) {
    const normalizedRuntimeId = _normalizeInterventionRuntimeId(runtimeId);
    const current = _runtimeInterventionMailbox.get(normalizedRuntimeId);
    if (current) return current;
    const next = {
        runtimeId: normalizedRuntimeId,
        entries: [],
        dropped: 0,
        updatedAt: Date.now(),
    };
    _runtimeInterventionMailbox.set(normalizedRuntimeId, next);
    return next;
}
/** @type {'interactive' | 'plan' | 'autopilot' | 'shell' | null} */
let _sdkSessionMode = null;
/** @type {'create' | 'update' | 'delete' | null} */
let _sdkPlanOperation = null;
/** @type {number | null} */
let _sdkPlanChangedAt = null;

/** @returns {string | null} */
export function getHubSessionId() {
    return _getCoreHubSessionId();
}
/** @param {string | null} id @returns {void} */
export function setHubSessionId(id) {
    const prev = _getCoreHubSessionId();
    setSharedHubSessionId(id);
    if (prev !== id) stateEmitter.emit(TERMINAL_EVENTS.HUB_SESSION_CHANGED, id, prev);
}

/** @returns {boolean} */
export function getBusy() {
    return _busy;
}
/** @param {boolean} value @returns {void} */
export function setBusy(value) {
    const prev = _busy;
    _busy = value;
    if (prev !== value) {
        stateEmitter.emit(TERMINAL_EVENTS.BUSY_CHANGED, value);
        try {
            if (value && _phase === TerminalPhase.IDLE) {
                transitionTerminalPhase(TerminalPhase.BUSY);
            } else if (!value && _phase === TerminalPhase.BUSY) {
                transitionTerminalPhase(TerminalPhase.IDLE);
            }
        } catch {
            // ignora transição inválida
        }
    }
}

/** @returns {import('node:readline').Interface | null} */
export function getRl() {
    return _rl;
}
/** @param {import('node:readline').Interface | null} value @returns {void} */
export function setRl(value) {
    _rl = value;
}

/**
 * @param {TerminalAttachmentQueueEntry} entry
 * @returns {TerminalAttachmentQueueEntry}
 */
function cloneAttachmentEntry(entry) {
    return typeof entry === 'string' ? entry : { ...entry };
}

/**
 * @param {TerminalAttachmentQueueEntry} entry
 * @returns {string}
 */
function attachmentQueueKey(entry) {
    if (typeof entry === 'string') return `file:${entry}`;
    const type = typeof entry?.type === 'string' ? entry.type : 'file';
    if ((type === 'file' || type === 'directory') && typeof entry.path === 'string') {
        return `${type}:${entry.path}`;
    }
    if (type === 'selection' && typeof entry.filePath === 'string') {
        return `selection:${entry.filePath}:${String(entry.displayName ?? '')}:${String(entry.text ?? '')}`;
    }
    if (type === 'blob' && typeof entry.data === 'string') {
        return `blob:${String(entry.displayName ?? '')}:${String(entry.mimeType ?? '')}:${entry.data}`;
    }
    if (typeof entry.content === 'string') {
        return `content:${String(entry.displayName ?? '')}:${entry.content}`;
    }
    return JSON.stringify(entry);
}

/** @returns {TerminalAttachmentQueueEntry[]} */
export function getAttachmentQueue() {
    return _attachmentQueue.map(cloneAttachmentEntry);
}

/**
 * @param {TerminalAttachmentQueueEntry} attachment
 * @returns {void}
 */
export function addAttachment(attachment) {
    if (_attachmentQueue.length >= MAX_ATTACHMENT_QUEUE) {
        throw new CopilotError(`[runtime-ui-state-store] Fila de attachments cheia (máx: ${MAX_ATTACHMENT_QUEUE})`);
    }
    const key = attachmentQueueKey(attachment);
    if (!_attachmentQueue.some((entry) => attachmentQueueKey(entry) === key)) {
        _attachmentQueue.push(cloneAttachmentEntry(attachment));
    }
}

/** @returns {void} */
export function clearAttachments() {
    _attachmentQueue = [];
}

/**
 * @param {{
 *     runtimeId?: string | null;
 *     source?: 'terminal' | 'inject' | 'llm-a' | 'user' | 'system';
 *     modeHint?: 'answer' | 'steer' | 'interrupt' | 'queue' | 'deferred';
 *     message: string;
 * }} input
 * @returns {{
 *     enqueued: boolean;
 *     merged: boolean;
 *     runtimeId: string;
 *     queueSize: number;
 *     dropped: number;
 *     entryId: string | null;
 * }}
 */
export function enqueueRuntimeInterventionMailbox(input) {
    const message = (input.message ?? '').trim();
    if (!message) {
        return {
            enqueued: false,
            merged: false,
            runtimeId: _normalizeInterventionRuntimeId(input.runtimeId),
            queueSize: 0,
            dropped: 0,
            entryId: null,
        };
    }

    const policy = getTerminalInterventionMailboxPolicy();
    const state = _ensureRuntimeInterventionMailbox(input.runtimeId);
    const runtimeId = state.runtimeId;
    const now = Date.now();
    const source = input.source ?? 'terminal';
    const modeHint = input.modeHint ?? 'deferred';
    const boundedMessage = _truncateInterventionMessage(message, policy.maxMessageChars);

    const tail = state.entries.length > 0 ? state.entries[state.entries.length - 1] : null;
    if (tail && tail.source === source && now - tail.ts <= policy.coalesceWindowMs) {
        const mergedRaw = `${tail.message}\n\n[+intervenção] ${boundedMessage}`;
        tail.message = _truncateInterventionMessage(mergedRaw, policy.maxMessageChars);
        tail.ts = now;
        tail.modeHint = modeHint;
        tail.mergedCount += 1;
        state.updatedAt = now;
        stateEmitter.emit(TERMINAL_EVENTS.INTERVENTION_MAILBOX_CHANGED, runtimeId, {
            action: 'merged',
            entryId: tail.id,
            queueSize: state.entries.length,
            dropped: state.dropped,
        });
        return {
            enqueued: true,
            merged: true,
            runtimeId,
            queueSize: state.entries.length,
            dropped: state.dropped,
            entryId: tail.id,
        };
    }

    const entry = {
        id: _nextInterventionId(),
        ts: now,
        runtimeId,
        source,
        modeHint,
        message: boundedMessage,
        mergedCount: 0,
    };
    state.entries.push(entry);
    const effectiveMaxEntries = Math.max(1, Math.min(1024, policy.maxEntries || TERMINAL_MAX_INTERVENTION_MAILBOX));
    while (state.entries.length > effectiveMaxEntries) {
        state.entries.shift();
        state.dropped += 1;
    }
    state.updatedAt = now;
    stateEmitter.emit(TERMINAL_EVENTS.INTERVENTION_MAILBOX_CHANGED, runtimeId, {
        action: 'enqueued',
        entryId: entry.id,
        queueSize: state.entries.length,
        dropped: state.dropped,
    });
    return {
        enqueued: true,
        merged: false,
        runtimeId,
        queueSize: state.entries.length,
        dropped: state.dropped,
        entryId: entry.id,
    };
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {{
 *     runtimeId: string;
 *     queueSize: number;
 *     dropped: number;
 *     updatedAt: number | null;
 *     latest: RuntimeInterventionMailboxEntry | null;
 * }}
 */
export function readRuntimeInterventionMailboxSummary(runtimeId) {
    const normalizedRuntimeId = _normalizeInterventionRuntimeId(runtimeId);
    const state = _runtimeInterventionMailbox.get(normalizedRuntimeId);
    const latest = state && state.entries.length > 0 ? (state.entries.at(-1) ?? null) : null;
    return {
        runtimeId: normalizedRuntimeId,
        queueSize: state?.entries.length ?? 0,
        dropped: state?.dropped ?? 0,
        updatedAt: state?.updatedAt ?? null,
        latest,
    };
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {RuntimeInterventionMailboxEntry | null}
 */
export function peekRuntimeInterventionMailbox(runtimeId) {
    const normalizedRuntimeId = _normalizeInterventionRuntimeId(runtimeId);
    const state = _runtimeInterventionMailbox.get(normalizedRuntimeId);
    return state && state.entries.length > 0 ? (state.entries[0] ?? null) : null;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {RuntimeInterventionMailboxEntry | null}
 */
export function consumeRuntimeInterventionMailbox(runtimeId) {
    const normalizedRuntimeId = _normalizeInterventionRuntimeId(runtimeId);
    const state = _runtimeInterventionMailbox.get(normalizedRuntimeId);
    if (!state || state.entries.length === 0) return null;
    const entry = state.entries.shift() ?? null;
    state.updatedAt = Date.now();
    stateEmitter.emit(TERMINAL_EVENTS.INTERVENTION_MAILBOX_CHANGED, normalizedRuntimeId, {
        action: 'consumed',
        entryId: entry?.id ?? null,
        queueSize: state.entries.length,
        dropped: state.dropped,
    });
    return entry;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {number}
 */
export function clearRuntimeInterventionMailbox(runtimeId) {
    const normalizedRuntimeId = _normalizeInterventionRuntimeId(runtimeId);
    const state = _runtimeInterventionMailbox.get(normalizedRuntimeId);
    if (!state) return 0;
    const removed = state.entries.length;
    state.entries.length = 0;
    state.updatedAt = Date.now();
    stateEmitter.emit(TERMINAL_EVENTS.INTERVENTION_MAILBOX_CHANGED, normalizedRuntimeId, {
        action: 'cleared',
        entryId: null,
        queueSize: 0,
        dropped: state.dropped,
    });
    return removed;
}

/** @returns {'interactive' | 'plan' | 'autopilot' | 'shell' | null} */
export function getSdkSessionMode() {
    return _sdkSessionMode;
}

/**
 * @param {'interactive' | 'plan' | 'autopilot' | 'shell' | null} value
 * @returns {void}
 */
export function setSdkSessionMode(value) {
    const prev = _sdkSessionMode;
    _sdkSessionMode = value;
    if (prev !== value) {
        stateEmitter.emit(TERMINAL_EVENTS.SDK_SESSION_MODE_CHANGED, value, prev);
    }
}

/** @returns {'create' | 'update' | 'delete' | null} */
export function getLastSdkPlanOperation() {
    return _sdkPlanOperation;
}

/** @returns {number | null} */
export function getLastSdkPlanChangedAt() {
    return _sdkPlanChangedAt;
}

/**
 * @param {'create' | 'update' | 'delete' | null} value
 * @param {number} [timestamp]
 * @returns {void}
 */
export function setLastSdkPlanOperation(value, timestamp = Date.now()) {
    const prev = _sdkPlanOperation;
    _sdkPlanOperation = value;
    _sdkPlanChangedAt = value === null ? null : timestamp;
    if (prev !== value) {
        stateEmitter.emit(TERMINAL_EVENTS.SDK_PLAN_OPERATION_CHANGED, value, prev);
    }
}

let _showThinking = TERMINAL_SHOW_THINKING;
/** @returns {boolean} */
export function getShowThinking() {
    return _showThinking;
}
/** @param {boolean} value @returns {void} */
export function setShowThinking(value) {
    _showThinking = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_THINKING_CHANGED, value);
}

let _showUsage = TERMINAL_SHOW_USAGE;
/** @returns {boolean} */
export function getShowUsage() {
    return _showUsage;
}
/** @param {boolean} value @returns {void} */
export function setShowUsage(value) {
    _showUsage = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_USAGE_CHANGED, value);
}

let _showStreaming = TERMINAL_SHOW_STREAMING;
/** @returns {boolean} */
export function getShowStreaming() {
    return _showStreaming;
}
/** @param {boolean} value @returns {void} */
export function setShowStreaming(value) {
    _showStreaming = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_STREAMING_CHANGED, value);
}

let _showToolActivity = TERMINAL_SHOW_TOOL_ACTIVITY;
/** @returns {boolean} */
export function getShowToolActivity() {
    return _showToolActivity;
}
/** @param {boolean} value @returns {void} */
export function setShowToolActivity(value) {
    _showToolActivity = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_TOOL_ACTIVITY_CHANGED, value);
}

let _showIntentActivity = TERMINAL_SHOW_INTENT_ACTIVITY;
/** @returns {boolean} */
export function getShowIntentActivity() {
    return _showIntentActivity;
}
/** @param {boolean} value @returns {void} */
export function setShowIntentActivity(value) {
    _showIntentActivity = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_INTENT_ACTIVITY_CHANGED, value);
}

let _showSessionActivity = false;
/** @returns {boolean} */
export function getShowSessionActivity() {
    return _showSessionActivity;
}
/** @param {boolean} value @returns {void} */
export function setShowSessionActivity(value) {
    _showSessionActivity = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_SESSION_ACTIVITY_CHANGED, value);
}

const MAX_INJECT_HISTORY = TERMINAL_MAX_INJECT_HISTORY;
/**
 * @typedef {{
 *     ts: number;
 *     traceId?: string;
 *     from: string;
 *     message: string;
 *     replySnippet: string | null;
 *     durationMs: number;
 *     timeoutMs?: number | null;
 *     timeoutStrategy?: 'explicit' | 'adaptive' | 'disabled';
 *     timeoutReasons?: string[];
 *     runtimeId?: string | null;
 *     promptDigest?: string | null;
 *     promptBindingDigest?: string | null;
 *     promptIsStale?: boolean | null;
 *     promptFreshnessReason?: string | null;
 *     promptRecommendedAction?: 'none' | 'observe-live-reload' | 'resume-session' | null;
 *     transportTimeoutMs?: number | null;
 *     transportTimeoutStrategy?: 'explicit' | 'adaptive' | 'disabled';
 *     transportTimeoutReasons?: string[];
 *     diagnostics?: Record<string, unknown> | null;
 *     outcome?: 'completed' | 'null_reply' | 'timeout' | 'error' | 'steered' | 'interrupted';
 *     ok: boolean;
 * }} InjectHistoryEntry
 */
/** @type {InjectHistoryEntry[]} */
let _injectHistory = [];

/** @returns {void} */
export function clearInjectHistory() {
    _injectHistory = [];
}

/**
 * @param {InjectHistoryEntry} entry
 * @returns {void}
 */
export function recordInjectHistory(entry) {
    _injectHistory.push(entry);
    if (_injectHistory.length > MAX_INJECT_HISTORY) {
        _injectHistory = _injectHistory.slice(-MAX_INJECT_HISTORY);
    }
}

/**
 * @param {number} [n=50] Default is `50`
 * @returns {InjectHistoryEntry[]}
 */
export function getInjectHistory(n = 50) {
    const limit = Math.min(Math.max(1, n), MAX_INJECT_HISTORY);
    return _injectHistory.slice(-limit);
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {number} [n=50] Default is `50`
 * @returns {InjectHistoryEntry[]}
 */
export function getInjectHistoryForRuntime(runtimeId, n = 50) {
    const targetRuntimeId = runtimeId ?? 'default';
    const limit = Math.min(Math.max(1, n), MAX_INJECT_HISTORY);
    return _injectHistory.filter((entry) => (entry.runtimeId ?? 'default') === targetRuntimeId).slice(-limit);
}

/**
 * @returns {InjectHistoryEntry | null}
 */
export function getLatestInjectHistoryEntry() {
    return _injectHistory.length > 0 ? (_injectHistory.at(-1) ?? null) : null;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {InjectHistoryEntry | null}
 */
export function getLatestInjectHistoryEntryForRuntime(runtimeId) {
    const targetRuntimeId = runtimeId ?? 'default';
    for (let index = _injectHistory.length - 1; index >= 0; index--) {
        const entry = _injectHistory[index] ?? null;
        if (entry && (entry.runtimeId ?? 'default') === targetRuntimeId) {
            return entry;
        }
    }
    return null;
}

const MAX_THINKING_HISTORY = 10_000;

/**
 * @typedef {'dialog' | 'task'} ThinkingSource
 */

/**
 * @typedef {{
 *     id: string;
 *     ts: number;
 *     source: ThinkingSource;
 *     title: string;
 *     content: string;
 *     chars: number;
 *     durationMs: number | null;
 *     reasoningId: string | null;
 *     taskId?: string | null;
 *     model?: string;
 *     effort?: string;
 *     status: 'streaming' | 'completed' | 'error';
 * }} ThinkingHistoryEntry
 */

/** @type {ThinkingHistoryEntry[]} */
let _thinkingHistory = [];

/**
 * @param {ThinkingHistoryEntry} entry
 * @returns {void}
 */
function upsertThinkingHistoryEntry(entry) {
    const idx = _thinkingHistory.findIndex((item) => item.id === entry.id);
    if (idx === -1) _thinkingHistory.push(entry);
    else _thinkingHistory[idx] = entry;
    if (_thinkingHistory.length > MAX_THINKING_HISTORY) {
        _thinkingHistory = _thinkingHistory.slice(-MAX_THINKING_HISTORY);
    }
    stateEmitter.emit(TERMINAL_EVENTS.THINKING_HISTORY_CHANGED, entry);
}

/**
 * @param {{
 *     id: string;
 *     source: ThinkingSource;
 *     title: string;
 *     chunk: string;
 *     reasoningId?: string | null;
 *     taskId?: string | null;
 *     model?: string;
 *     effort?: string;
 *     ts?: number;
 * }} input
 * @returns {ThinkingHistoryEntry}
 */
export function appendThinkingHistoryChunk(input) {
    const now = input.ts ?? Date.now();
    const existing = _thinkingHistory.find((entry) => entry.id === input.id) ?? null;
    const content = (existing?.content ?? '') + input.chunk;
    const taskId = input.taskId ?? existing?.taskId;
    const model = input.model ?? existing?.model;
    const effort = input.effort ?? existing?.effort;
    /** @type {ThinkingHistoryEntry} */
    const nextEntry = {
        id: input.id,
        ts: existing?.ts ?? now,
        source: input.source,
        title: input.title,
        content,
        chars: content.length,
        durationMs: existing?.durationMs ?? null,
        reasoningId: input.reasoningId ?? existing?.reasoningId ?? null,
        status: 'streaming',
        ...(taskId !== undefined ? { taskId } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
    };
    upsertThinkingHistoryEntry(nextEntry);
    return nextEntry;
}

/**
 * @param {string} id
 * @param {{ durationMs?: number | null; status?: 'completed' | 'error' }} [opts]
 * @returns {ThinkingHistoryEntry | null}
 */
export function finalizeThinkingHistoryEntry(id, opts = {}) {
    const existing = _thinkingHistory.find((entry) => entry.id === id) ?? null;
    if (!existing) return null;
    /** @type {ThinkingHistoryEntry} */
    const nextEntry = {
        ...existing,
        durationMs: opts.durationMs ?? existing.durationMs ?? null,
        status: opts.status ?? 'completed',
    };
    upsertThinkingHistoryEntry(nextEntry);
    return nextEntry;
}

/**
 * @param {number} [n=20] Default is `20`
 * @returns {ThinkingHistoryEntry[]}
 */
export function getThinkingHistory(n = 20) {
    const limit = Math.max(1, Math.floor(n));
    return _thinkingHistory.slice(-limit);
}

/**
 * @param {string} id
 * @returns {ThinkingHistoryEntry | null}
 */
export function getThinkingHistoryEntry(id) {
    return _thinkingHistory.find((entry) => entry.id === id) ?? null;
}

/** @returns {ThinkingHistoryEntry | null} */
export function getLatestThinkingHistoryEntry() {
    return _thinkingHistory.at(-1) ?? null;
}

/** @returns {void} */
export function clearThinkingHistory() {
    _thinkingHistory = [];
    stateEmitter.emit(TERMINAL_EVENTS.THINKING_HISTORY_CHANGED, null);
}

export const TerminalPhase = /** @type {const} */ ({
    INIT: 'init',
    IDLE: 'idle',
    BUSY: 'busy',
    SHUTTING_DOWN: 'shutting_down',
    STOPPED: 'stopped',
});

/** @type {ReadonlyMap<string, readonly string[]>} */
const VALID_TRANSITIONS = new Map([
    [TerminalPhase.INIT, [TerminalPhase.IDLE, TerminalPhase.STOPPED]],
    [TerminalPhase.IDLE, [TerminalPhase.BUSY, TerminalPhase.SHUTTING_DOWN]],
    [TerminalPhase.BUSY, [TerminalPhase.IDLE, TerminalPhase.SHUTTING_DOWN]],
    [TerminalPhase.SHUTTING_DOWN, [TerminalPhase.STOPPED]],
    [TerminalPhase.STOPPED, []],
]);

/** @type {string} */
let _phase = TerminalPhase.INIT;

/** @returns {string} */
export function getTerminalPhase() {
    return _phase;
}

/**
 * @param {string} next
 * @returns {void}
 */
export function transitionTerminalPhase(next) {
    const allowed = VALID_TRANSITIONS.get(_phase);
    if (!allowed?.includes(next)) {
        throw new CopilotError(
            `[TerminalSM] transição inválida: ${_phase} → ${next} (permitidas: ${allowed?.join(', ') ?? 'nenhuma'})`,
            'STATE_TRANSITION_ERROR',
        );
    }
    const prev = _phase;
    _phase = next;
    stateEmitter.emit('phase:changed', next, prev);
}
