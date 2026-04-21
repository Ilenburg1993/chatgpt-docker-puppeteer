// @ts-check
/**
 * @module copilot/presentation/runtime-ui-state-store
 * @file Store compartilhada do estado operacional/UI do terminal.
 *
 *   Esta store retira de `terminal/state.js` a propriedade arquitetural sobre busy state, fase, histórico de inject,
 *   attachment queue e toggles visuais. O módulo antigo do terminal passa a existir como shim de compatibilidade.
 */

import {
    TERMINAL_MAX_ATTACHMENTS,
    TERMINAL_MAX_INJECT_HISTORY,
    TERMINAL_MAX_LISTENERS,
    TERMINAL_SHOW_INTENT_ACTIVITY,
    TERMINAL_SHOW_STREAMING,
    TERMINAL_SHOW_THINKING,
    TERMINAL_SHOW_TOOL_ACTIVITY,
    TERMINAL_SHOW_USAGE,
} from '#copilot/config';
import { CopilotError, getHubSessionId as _getCoreHubSessionId, setSharedHubSessionId } from '#copilot/core';
import { EventEmitter } from 'node:events';

export const stateEmitter = new EventEmitter();
stateEmitter.setMaxListeners(TERMINAL_MAX_LISTENERS);

export const TERMINAL_EVENTS = /** @type {const} */ ({
    HUB_SESSION_CHANGED: 'hubSessionId:changed',
    BUSY_CHANGED: 'busy:changed',
    SDK_SESSION_MODE_CHANGED: 'sdkSessionMode:changed',
    SDK_PLAN_OPERATION_CHANGED: 'sdkPlanOperation:changed',
    SHOW_THINKING_CHANGED: 'showThinking:changed',
    SHOW_USAGE_CHANGED: 'showUsage:changed',
    SHOW_STREAMING_CHANGED: 'showStreaming:changed',
    SHOW_TOOL_ACTIVITY_CHANGED: 'showToolActivity:changed',
    SHOW_INTENT_ACTIVITY_CHANGED: 'showIntentActivity:changed',
});

let _busy = false;
/** @type {import('node:readline').Interface | null} */
let _rl = null;
/** @type {string[]} */
let _attachmentQueue = [];
const MAX_ATTACHMENT_QUEUE = TERMINAL_MAX_ATTACHMENTS;
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

/** @returns {string[]} */
export function getAttachmentQueue() {
    return [..._attachmentQueue];
}

/**
 * @param {string} filePath
 * @returns {void}
 */
export function addAttachment(filePath) {
    if (_attachmentQueue.length >= MAX_ATTACHMENT_QUEUE) {
        throw new CopilotError(`[runtime-ui-state-store] Fila de attachments cheia (máx: ${MAX_ATTACHMENT_QUEUE})`);
    }
    if (!_attachmentQueue.includes(filePath)) {
        _attachmentQueue.push(filePath);
    }
}

/** @returns {void} */
export function clearAttachments() {
    _attachmentQueue = [];
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

const MAX_INJECT_HISTORY = TERMINAL_MAX_INJECT_HISTORY;
/**
 * @typedef {{
 *     ts: number;
 *     from: string;
 *     message: string;
 *     replySnippet: string | null;
 *     durationMs: number;
 *     ok: boolean;
 * }} InjectHistoryEntry
 */
/** @type {InjectHistoryEntry[]} */
let _injectHistory = [];

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
