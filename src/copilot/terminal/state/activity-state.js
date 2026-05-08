// @ts-check
/**
 * Estado reativo da UX do terminal LLM-B.
 *
 * Centraliza a noção de "o que a LLM-B está fazendo agora" para que REPL, status, HTTP frontend e diagnósticos
 * compartilhem uma única semântica operacional.
 */

import { EventEmitter } from 'node:events';

const MAX_ACTIVITY_HISTORY = 100;
const FOCUSED_ACTIVITY_MAX_AGE_MS = 10 * 60_000;

/**
 * @typedef {'idle'
 *     | 'boot'
 *     | 'turn'
 *     | 'thinking'
 *     | 'streaming'
 *     | 'tool'
 *     | 'task'
 *     | 'compaction'
 *     | 'question'
 *     | 'subagent'
 *     | 'system'
 *     | 'error'} TerminalActivityPhase
 */

/**
 * @typedef {'info' | 'warn' | 'error'} TerminalActivitySeverity
 */

/**
 * @typedef {Object} TerminalActivitySnapshot
 * @property {TerminalActivityPhase} phase
 * @property {string} label
 * @property {string | null} detail
 * @property {string} source
 * @property {TerminalActivitySeverity} severity
 * @property {number | null} progress
 * @property {string | null} toolName
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} ageMs
 */

/**
 * @typedef {TerminalActivitySnapshot & { ts: number }} TerminalActivityHistoryEntry
 */

/** @type {EventEmitter} */
export const terminalActivityEmitter = new EventEmitter();
terminalActivityEmitter.setMaxListeners(25);

/** @type {TerminalActivitySnapshot} */
let _currentActivity = {
    phase: 'idle',
    label: 'Pronto',
    detail: 'Aguardando próxima mensagem',
    source: 'terminal',
    severity: 'info',
    progress: null,
    toolName: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ageMs: 0,
};

/** @type {TerminalActivitySnapshot | null} */
let _focusedActivity = null;

/** @type {TerminalActivityHistoryEntry[]} */
let _activityHistory = [];

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeProgress(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
}

/**
 * @param {TerminalActivitySnapshot} snapshot
 * @returns {TerminalActivitySnapshot}
 */
function withAge(snapshot) {
    return {
        ...snapshot,
        ageMs: Math.max(0, Date.now() - snapshot.startedAt),
    };
}

/**
 * @param {TerminalActivitySnapshot} snapshot
 * @returns {void}
 */
function pushHistory(snapshot) {
    _activityHistory.push({ ...snapshot, ts: snapshot.updatedAt });
    if (_activityHistory.length > MAX_ACTIVITY_HISTORY) {
        _activityHistory = _activityHistory.slice(-MAX_ACTIVITY_HISTORY);
    }
}

/**
 * @param {TerminalActivityPhase} phase
 * @param {string} label
 * @returns {boolean}
 */
function isTerminalActivityCompletion(phase, label) {
    if (phase === 'idle') return true;
    const normalized = label.toLowerCase();
    return (
        normalized.includes('conclu') ||
        normalized.includes('falh') ||
        normalized.includes('encerrad') ||
        normalized.includes('respondid') ||
        normalized.includes('aprovad') ||
        normalized.includes('rejeitad')
    );
}

/**
 * @param {TerminalActivityPhase} phase
 * @returns {boolean}
 */
function isFocusableTerminalActivityPhase(phase) {
    return (
        phase === 'boot' ||
        phase === 'turn' ||
        phase === 'thinking' ||
        phase === 'streaming' ||
        phase === 'tool' ||
        phase === 'task' ||
        phase === 'compaction' ||
        phase === 'question' ||
        phase === 'subagent' ||
        phase === 'error'
    );
}

/**
 * @param {TerminalActivitySnapshot} activity
 * @returns {void}
 */
function updateFocusedActivity(activity) {
    if (isTerminalActivityCompletion(activity.phase, activity.label)) {
        if (!activity.toolName || _focusedActivity?.toolName === activity.toolName) {
            _focusedActivity = null;
        }
        return;
    }
    if (isFocusableTerminalActivityPhase(activity.phase)) {
        _focusedActivity = activity;
    }
}

/**
 * @returns {TerminalActivitySnapshot | null}
 */
function readFocusedActivity() {
    if (!_focusedActivity) return null;
    if (Date.now() - _focusedActivity.updatedAt > FOCUSED_ACTIVITY_MAX_AGE_MS) {
        _focusedActivity = null;
        return null;
    }
    return withAge(_focusedActivity);
}

/**
 * @param {TerminalActivityPhase} phase
 * @param {string} label
 * @param {{
 *     detail?: string | null;
 *     source?: string;
 *     severity?: TerminalActivitySeverity;
 *     progress?: number | null;
 *     toolName?: string | null;
 *     recordHistory?: boolean;
 *     timestamp?: number;
 * }} [opts]
 * @returns {TerminalActivitySnapshot}
 */
export function recordTerminalActivity(phase, label, opts = {}) {
    const timestamp = opts.timestamp ?? Date.now();
    const source = opts.source ?? 'terminal';
    const detail = opts.detail ?? null;
    const severity = opts.severity ?? 'info';
    const progress = normalizeProgress(opts.progress ?? null);
    const toolName = opts.toolName ?? null;
    const recordHistory = opts.recordHistory !== false;
    const keepStart =
        _currentActivity.phase === phase &&
        _currentActivity.label === label &&
        _currentActivity.source === source &&
        _currentActivity.toolName === toolName;
    const sameSemanticPayload =
        keepStart &&
        _currentActivity.detail === detail &&
        _currentActivity.severity === severity &&
        _currentActivity.progress === progress;
    const next = withAge({
        phase,
        label,
        detail,
        source,
        severity,
        progress,
        toolName,
        startedAt: keepStart ? _currentActivity.startedAt : timestamp,
        updatedAt: timestamp,
        ageMs: 0,
    });
    const prev = _currentActivity;
    _currentActivity = next;
    updateFocusedActivity(next);
    if (recordHistory && !sameSemanticPayload) {
        pushHistory(next);
    }
    terminalActivityEmitter.emit('activity:changed', next, prev);
    return next;
}

/**
 * @param {string} [detail]
 * @returns {TerminalActivitySnapshot}
 */
export function markTerminalActivityIdle(detail = 'Aguardando próxima mensagem') {
    return recordTerminalActivity('idle', 'Pronto', { detail, source: 'terminal' });
}

/**
 * @returns {TerminalActivitySnapshot}
 */
export function readTerminalActivitySnapshot() {
    return readFocusedActivity() ?? withAge(_currentActivity);
}

/**
 * @param {number} [limit=10] Default is `10`
 * @returns {TerminalActivityHistoryEntry[]}
 */
export function readTerminalActivityHistory(limit = 10) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    return _activityHistory
        .slice(-safeLimit)
        .reverse()
        .map((entry) => ({
            ...entry,
            ageMs: Math.max(0, Date.now() - entry.startedAt),
        }));
}

/**
 * @returns {void}
 */
export function clearTerminalActivityHistory() {
    _activityHistory = [];
}
