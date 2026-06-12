// @ts-check

const MAX_RECENT_TURN_TRACES = 20;
const MAX_TURN_TRACE_TOOLS = 128;
const MAX_TURN_TRACE_FILES = 256;
const MAX_TURN_TRACE_USER_INPUTS = 64;
const MAX_FILE_DEDUPE_KEYS = 32;
const MAX_USER_INPUT_CHOICES = 32;
const MAX_TRACE_LABEL_LENGTH = 512;
const MAX_TRACE_PATH_LENGTH = 4096;
const MAX_TRACE_QUESTION_LENGTH = 4096;
const MAX_TRACE_PREVIEW_LENGTH = 2048;
const MAX_DEDUPE_KEY_LENGTH = 1024;

/** @typedef {'assistant' | 'implicit'} TerminalTurnTraceSource */
/** @typedef {'active' | 'completed' | 'failed' | 'interrupted'} TerminalTurnTraceStatus */
/** @typedef {'read' | 'write' | 'edit' | 'copy' | 'move' | 'delete' | 'list' | 'run' | 'inspect' | 'ask' | 'intent' | 'unknown'} TerminalTurnTraceOperation */
/** @typedef {'question' | 'ready' | 'reply' | 'stopped' | 'structured'} TerminalTurnTraceUserInputKind */
/** @typedef {'requested' | 'answered' | 'cancelled'} TerminalTurnTraceUserInputStatus */

/**
 * @typedef {{
 *     toolName: string;
 *     operation: TerminalTurnTraceOperation;
 *     path: string | null;
 *     target: string | null;
 *     source: string;
 *     status: 'started' | 'completed' | 'failed' | 'requested' | 'user_requested';
 *     success: boolean | null;
 *     count: number;
 *     updatedAt: number;
 * }} TerminalTurnTraceToolEntry
 */

/**
 * @typedef {{
 *     path: string;
 *     operation: TerminalTurnTraceOperation;
 *     source: string;
 *     count: number;
 *     updatedAt: number;
 *     dedupeKeys?: string[];
 * }} TerminalTurnTraceFileEntry
 */

/**
 * @typedef {{
 *     requestId: string | null;
 *     kind: TerminalTurnTraceUserInputKind;
 *     question: string;
 *     choices: string[];
 *     allowFreeform: boolean;
 *     status: TerminalTurnTraceUserInputStatus;
 *     answerPreview: string | null;
 *     source: string;
 *     count: number;
 *     updatedAt: number;
 * }} TerminalTurnTraceUserInputEntry
 */

/**
 * @typedef {{
 *     traceId: string;
 *     turnId: string | null;
 *     source: TerminalTurnTraceSource;
 *     status: TerminalTurnTraceStatus;
 *     startedAt: number;
 *     updatedAt: number;
 *     finishedAt: number | null;
 *     toolCount: number;
 *     fileCount: number;
 *     userInputCount: number;
 *     tools: TerminalTurnTraceToolEntry[];
 *     files: TerminalTurnTraceFileEntry[];
 *     userInputs: TerminalTurnTraceUserInputEntry[];
 * }} TerminalTurnTraceSnapshot
 */

/**
 * @typedef {TerminalTurnTraceSnapshot & {
 *     toolIndex: Map<string, number>;
 *     fileIndex: Map<string, number>;
 *     userInputIndex: Map<string, number>;
 * }} InternalTerminalTurnTrace
 */

/** @type {InternalTerminalTurnTrace | null} */
let _currentTurnTrace = null;

/** @type {TerminalTurnTraceSnapshot[]} */
let _recentTurnTraces = [];

/** @type {Map<string, string>} */
let _activeToolCalls = new Map();

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTurnId(value) {
    if (typeof value === 'string' && value.length > 0) {
        return value.length <= MAX_TRACE_LABEL_LENGTH ? value : value.slice(0, MAX_TRACE_LABEL_LENGTH);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeToolCallId(value) {
    return normalizeBoundedString(value, MAX_TRACE_LABEL_LENGTH);
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
function normalizeBoundedString(value, maxLength) {
    if (typeof value !== 'string' || value.length === 0) return null;
    return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/**
 * Removes the oldest retained entry and keeps the index map aligned with the shifted array.
 *
 * @template T
 * @param {T[]} entries
 * @param {Map<string, number>} index
 * @returns {string | null}
 */
function evictOldestIndexedEntry(entries, index) {
    if (entries.length === 0) return null;
    entries.shift();
    let removedKey = null;
    for (const [key, position] of index) {
        if (position === 0) {
            removedKey = key;
            index.delete(key);
        } else {
            index.set(key, position - 1);
        }
    }
    return removedKey;
}

/**
 * @param {string} actionKey
 * @returns {void}
 */
function forgetActiveToolCallsForAction(actionKey) {
    for (const [toolCallId, activeActionKey] of _activeToolCalls) {
        if (activeActionKey === actionKey) {
            _activeToolCalls.delete(toolCallId);
        }
    }
}

/**
 * @param {number} timestamp
 * @param {string | null} turnId
 * @param {TerminalTurnTraceSource} source
 * @returns {InternalTerminalTurnTrace}
 */
function createTurnTrace(timestamp, turnId, source) {
    const traceId = turnId ? `turn:${turnId}` : `implicit:${timestamp}`;
    return {
        traceId,
        turnId,
        source,
        status: 'active',
        startedAt: timestamp,
        updatedAt: timestamp,
        finishedAt: null,
        toolCount: 0,
        fileCount: 0,
        userInputCount: 0,
        tools: [],
        files: [],
        userInputs: [],
        toolIndex: new Map(),
        fileIndex: new Map(),
        userInputIndex: new Map(),
    };
}

/**
 * @param {InternalTerminalTurnTrace} trace
 * @returns {TerminalTurnTraceSnapshot}
 */
function toSnapshot(trace) {
    return {
        traceId: trace.traceId,
        turnId: trace.turnId,
        source: trace.source,
        status: trace.status,
        startedAt: trace.startedAt,
        updatedAt: trace.updatedAt,
        finishedAt: trace.finishedAt,
        toolCount: trace.tools.length,
        fileCount: trace.files.length,
        userInputCount: trace.userInputs.length,
        tools: trace.tools.map((entry) => ({ ...entry })),
        files: trace.files.map((entry) => ({
            ...entry,
            ...(entry.dedupeKeys ? { dedupeKeys: [...entry.dedupeKeys] } : {}),
        })),
        userInputs: trace.userInputs.map((entry) => ({ ...entry, choices: [...entry.choices] })),
    };
}

/**
 * @param {InternalTerminalTurnTrace} trace
 * @returns {void}
 */
function pushRecentTrace(trace) {
    _recentTurnTraces.push(toSnapshot(trace));
    if (_recentTurnTraces.length > MAX_RECENT_TURN_TRACES) {
        _recentTurnTraces = _recentTurnTraces.slice(-MAX_RECENT_TURN_TRACES);
    }
}

/**
 * @param {number} timestamp
 * @param {string | null} turnId
 * @param {TerminalTurnTraceSource} source
 * @returns {InternalTerminalTurnTrace}
 */
function ensureCurrentTurnTrace(timestamp, turnId, source) {
    if (_currentTurnTrace && (!_currentTurnTrace.turnId || _currentTurnTrace.turnId === turnId || turnId == null)) {
        return _currentTurnTrace;
    }
    if (_currentTurnTrace) {
        completeTerminalTurnTrace({ timestamp, status: 'interrupted' });
    }
    _currentTurnTrace = createTurnTrace(timestamp, turnId, source);
    return _currentTurnTrace;
}

/**
 * @param {{ turnId?: string | null; timestamp?: number; source?: TerminalTurnTraceSource }} [input]
 * @returns {TerminalTurnTraceSnapshot}
 */
export function beginTerminalTurnTrace({ turnId = null, timestamp = Date.now(), source = 'assistant' } = {}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    if (
        normalizedTurnId &&
        _currentTurnTrace &&
        (_currentTurnTrace.source === 'implicit' || _currentTurnTrace.turnId === '0')
    ) {
        _currentTurnTrace.turnId = normalizedTurnId;
        _currentTurnTrace.traceId = `turn:${normalizedTurnId}`;
        _currentTurnTrace.source = source;
        _currentTurnTrace.updatedAt = timestamp;
        return toSnapshot(_currentTurnTrace);
    }
    const current = ensureCurrentTurnTrace(timestamp, normalizedTurnId, source);
    if (normalizedTurnId && current.turnId == null) {
        current.turnId = normalizedTurnId;
        current.traceId = `turn:${normalizedTurnId}`;
    }
    current.updatedAt = timestamp;
    return toSnapshot(current);
}

/**
 * @param {{ turnId?: string | null; timestamp?: number; status?: Exclude<TerminalTurnTraceStatus, 'active'> }} [input]
 * @returns {TerminalTurnTraceSnapshot | null}
 */
export function completeTerminalTurnTrace({ turnId = null, timestamp = Date.now(), status = 'completed' } = {}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const current = _currentTurnTrace;
    if (!current) return null;
    if (normalizedTurnId && current.turnId && current.turnId !== normalizedTurnId) {
        return null;
    }
    current.status = status;
    current.updatedAt = timestamp;
    current.finishedAt = timestamp;
    pushRecentTrace(current);
    _currentTurnTrace = null;
    _activeToolCalls = new Map();
    return _recentTurnTraces[_recentTurnTraces.length - 1] ?? null;
}

/**
 * Reconciles late lifecycle failures emitted after `assistant.turn_end`.
 *
 * Some providers surface a transport/query failure only after the SDK already emitted the assistant turn end event.
 * In that case the trace was closed as completed a few milliseconds earlier. This function revises the most recent
 * matching trace instead of creating a parallel error trace.
 *
 * @param {{ turnId?: string | null; timestamp?: number; status?: Exclude<TerminalTurnTraceStatus, 'active'>; maxAgeMs?: number }} [input]
 * @returns {TerminalTurnTraceSnapshot | null}
 */
export function reviseRecentTerminalTurnTraceStatus({
    turnId = null,
    timestamp = Date.now(),
    status = 'failed',
    maxAgeMs = 30_000,
} = {}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    if (_currentTurnTrace) {
        return completeTerminalTurnTrace({ turnId: normalizedTurnId, timestamp, status });
    }
    for (let index = _recentTurnTraces.length - 1; index >= 0; index -= 1) {
        const trace = _recentTurnTraces[index];
        if (!trace) continue;
        if (normalizedTurnId && trace.turnId && trace.turnId !== normalizedTurnId) continue;
        const ageMs = timestamp - (trace.finishedAt ?? trace.updatedAt);
        if (Number.isFinite(ageMs) && ageMs > maxAgeMs) continue;
        const revised = {
            ...trace,
            status,
            updatedAt: timestamp,
            finishedAt: timestamp,
        };
        _recentTurnTraces[index] = revised;
        return { ...revised };
    }
    return null;
}

/**
 * @param {{
 *     toolName: string;
 *     operation?: TerminalTurnTraceOperation;
 *     path?: string | null;
 *     target?: string | null;
 *     source?: string;
 *     status?: TerminalTurnTraceToolEntry['status'];
 *     success?: boolean | null;
 *     toolCallId?: string | null;
 *     turnId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnTraceSnapshot}
 */
export function recordTerminalTurnToolActivity({
    toolName,
    operation = 'unknown',
    path = null,
    target = null,
    source = 'sdk',
    status = 'started',
    success = null,
    toolCallId = null,
    turnId = null,
    timestamp = Date.now(),
}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const normalizedToolCallId = normalizeToolCallId(toolCallId);
    const trace = ensureCurrentTurnTrace(timestamp, normalizedTurnId, normalizedTurnId ? 'assistant' : 'implicit');
    const normalizedToolName = normalizeBoundedString(toolName, MAX_TRACE_LABEL_LENGTH) ?? '(unknown)';
    const normalizedPath = normalizeBoundedString(path, MAX_TRACE_PATH_LENGTH);
    const normalizedTarget = normalizeBoundedString(target, MAX_TRACE_PATH_LENGTH);
    const normalizedSource = normalizeBoundedString(source, MAX_TRACE_LABEL_LENGTH) ?? 'sdk';
    const effectiveTarget = normalizedTarget ?? normalizedPath ?? null;
    const actionKey =
        normalizedToolCallId ??
        `${normalizedToolName}\u241f${operation}\u241f${effectiveTarget ?? ''}\u241f${normalizedSource}`;
    const existingIndex = trace.toolIndex.get(actionKey);
    let shouldRecordPrimaryFile = false;

    if (existingIndex == null) {
        if (trace.tools.length >= MAX_TURN_TRACE_TOOLS) {
            const evictedActionKey = evictOldestIndexedEntry(trace.tools, trace.toolIndex);
            if (evictedActionKey) forgetActiveToolCallsForAction(evictedActionKey);
        }
        trace.toolIndex.set(actionKey, trace.tools.length);
        trace.tools.push({
            toolName: normalizedToolName,
            operation,
            path: normalizedPath,
            target: effectiveTarget,
            source: normalizedSource,
            status,
            success,
            count: 1,
            updatedAt: timestamp,
        });
        shouldRecordPrimaryFile = Boolean(normalizedPath);
    } else {
        const existing = trace.tools[existingIndex];
        if (existing) {
            shouldRecordPrimaryFile = Boolean(normalizedPath && !existing.path);
            existing.status = status;
            existing.success = success;
            existing.updatedAt = timestamp;
            existing.count += 1;
            existing.path = existing.path ?? normalizedPath;
            existing.target = existing.target ?? effectiveTarget;
        }
    }

    trace.updatedAt = timestamp;

    if (normalizedToolCallId) {
        _activeToolCalls.set(normalizedToolCallId, actionKey);
        if (status === 'completed' || status === 'failed') {
            _activeToolCalls.delete(normalizedToolCallId);
        }
    }

    if (normalizedPath && shouldRecordPrimaryFile) {
        recordTerminalTurnFileActivity({
            path: normalizedPath,
            operation,
            source: normalizedSource,
            dedupeKey: normalizedToolCallId
                ? `${normalizedToolCallId}\u241fprimary\u241f${normalizedPath}`
                : null,
            turnId: trace.turnId,
            timestamp,
        });
    }

    return toSnapshot(trace);
}

/**
 * @param {{
 *     toolCallId: string;
 *     success: boolean;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnTraceSnapshot | null}
 */
export function completeTerminalTurnToolCall({ toolCallId, success, timestamp = Date.now() }) {
    const current = _currentTurnTrace;
    if (!current) return null;
    const actionKey = _activeToolCalls.get(toolCallId);
    if (!actionKey) return null;
    const index = current.toolIndex.get(actionKey);
    if (index == null) return null;
    const entry = current.tools[index];
    if (!entry) return null;
    entry.status = success ? 'completed' : 'failed';
    entry.success = success;
    entry.updatedAt = timestamp;
    current.updatedAt = timestamp;
    _activeToolCalls.delete(toolCallId);
    return toSnapshot(current);
}

/**
 * @param {unknown} value
 * @returns {TerminalTurnTraceUserInputKind}
 */
function normalizeUserInputKind(value) {
    return value === 'ready' || value === 'reply' || value === 'stopped' || value === 'structured'
        ? value
        : 'question';
}

/**
 * @param {unknown} value
 * @returns {TerminalTurnTraceUserInputStatus}
 */
function normalizeUserInputStatus(value) {
    return value === 'answered' || value === 'cancelled' ? value : 'requested';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeChoices(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((choice) => typeof choice === 'string' && choice.trim().length > 0)
        .slice(0, MAX_USER_INPUT_CHOICES)
        .map((choice) => choice.trim().slice(0, MAX_TRACE_LABEL_LENGTH));
}

/**
 * @param {{
 *     requestId?: string | null;
 *     kind?: TerminalTurnTraceUserInputKind;
 *     question?: string;
 *     choices?: string[];
 *     allowFreeform?: boolean;
 *     status?: TerminalTurnTraceUserInputStatus;
 *     answerPreview?: string | null;
 *     source?: string;
 *     turnId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnTraceSnapshot}
 */
export function recordTerminalTurnUserInputActivity({
    requestId = null,
    kind = 'question',
    question = '',
    choices = [],
    allowFreeform: _ = true,
    status = 'requested',
    answerPreview = null,
    source = 'sdk',
    turnId = null,
    timestamp = Date.now(),
}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const trace = ensureCurrentTurnTrace(timestamp, normalizedTurnId, normalizedTurnId ? 'assistant' : 'implicit');
    const normalizedRequestId = normalizeToolCallId(requestId);
    const normalizedQuestion =
        normalizeBoundedString(typeof question === 'string' ? question.trim() : null, MAX_TRACE_QUESTION_LENGTH) ??
        '(sem pergunta)';
    const normalizedSource = normalizeBoundedString(source, MAX_TRACE_LABEL_LENGTH) ?? 'sdk';
    const key =
        normalizedRequestId ??
        `${normalizeUserInputKind(kind)}\u241f${normalizedQuestion}\u241f${normalizedSource}\u241f${trace.userInputs.length}`;
    const existingIndex = trace.userInputIndex.get(key);
    const normalizedStatus = normalizeUserInputStatus(status);
    const normalizedAnswerPreview = normalizeBoundedString(
        typeof answerPreview === 'string' ? answerPreview.trim() : null,
        MAX_TRACE_PREVIEW_LENGTH,
    );

    if (existingIndex == null) {
        if (trace.userInputs.length >= MAX_TURN_TRACE_USER_INPUTS) {
            evictOldestIndexedEntry(trace.userInputs, trace.userInputIndex);
        }
        trace.userInputIndex.set(key, trace.userInputs.length);
        trace.userInputs.push({
            requestId: normalizedRequestId,
            kind: normalizeUserInputKind(kind),
            question: normalizedQuestion,
            choices: normalizeChoices(choices),
            allowFreeform: true,
            status: normalizedStatus,
            answerPreview: normalizedAnswerPreview,
            source: normalizedSource,
            count: 1,
            updatedAt: timestamp,
        });
    } else {
        const existing = trace.userInputs[existingIndex];
        if (existing) {
            existing.status = normalizedStatus;
            existing.answerPreview = normalizedAnswerPreview ?? existing.answerPreview;
            existing.choices = existing.choices.length > 0 ? existing.choices : normalizeChoices(choices);
            existing.allowFreeform = true;
            existing.count += 1;
            existing.updatedAt = timestamp;
        }
    }

    trace.updatedAt = timestamp;
    return toSnapshot(trace);
}

/**
 * @param {{
 *     path: string;
 *     operation?: TerminalTurnTraceOperation;
 *     source?: string;
 *     dedupeKey?: string | null;
 *     turnId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnTraceSnapshot}
 */
export function recordTerminalTurnFileActivity({
    path,
    operation = 'unknown',
    source = 'sdk',
    dedupeKey = null,
    turnId = null,
    timestamp = Date.now(),
}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const trace = ensureCurrentTurnTrace(timestamp, normalizedTurnId, normalizedTurnId ? 'assistant' : 'implicit');
    const normalizedPath = normalizeBoundedString(path, MAX_TRACE_PATH_LENGTH) ?? '(unknown)';
    const normalizedSource = normalizeBoundedString(source, MAX_TRACE_LABEL_LENGTH) ?? 'sdk';
    const normalizedDedupeKey = normalizeBoundedString(dedupeKey, MAX_DEDUPE_KEY_LENGTH);
    const fileKey = `${operation}\u241f${normalizedPath}\u241f${normalizedSource}`;
    const existingIndex = trace.fileIndex.get(fileKey);
    if (existingIndex == null) {
        if (trace.files.length >= MAX_TURN_TRACE_FILES) {
            evictOldestIndexedEntry(trace.files, trace.fileIndex);
        }
        trace.fileIndex.set(fileKey, trace.files.length);
        trace.files.push({
            path: normalizedPath,
            operation,
            source: normalizedSource,
            count: 1,
            updatedAt: timestamp,
            ...(normalizedDedupeKey ? { dedupeKeys: [normalizedDedupeKey] } : {}),
        });
    } else {
        const existing = trace.files[existingIndex];
        if (existing) {
            if (normalizedDedupeKey && existing.dedupeKeys?.includes(normalizedDedupeKey)) {
                existing.updatedAt = timestamp;
                return toSnapshot(trace);
            }
            existing.count += 1;
            existing.updatedAt = timestamp;
            if (normalizedDedupeKey) {
                existing.dedupeKeys = [...(existing.dedupeKeys ?? []), normalizedDedupeKey].slice(
                    -MAX_FILE_DEDUPE_KEYS,
                );
            }
        }
    }
    trace.updatedAt = timestamp;
    return toSnapshot(trace);
}

/**
 * @param {number} [limit=3] Default is `3`
 * @returns {{ current: TerminalTurnTraceSnapshot | null; recent: TerminalTurnTraceSnapshot[] }}
 */
export function readTerminalTurnTraceProjection(limit = 3) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
    return {
        current: _currentTurnTrace ? toSnapshot(_currentTurnTrace) : null,
        recent: _recentTurnTraces
            .slice(-safeLimit)
            .reverse()
            .map((entry) => ({
                ...entry,
                tools: entry.tools.map((tool) => ({ ...tool })),
                files: entry.files.map((file) => ({
                    ...file,
                    ...(file.dedupeKeys ? { dedupeKeys: [...file.dedupeKeys] } : {}),
                })),
                userInputs: (entry.userInputs ?? []).map((userInput) => ({
                    ...userInput,
                    choices: [...userInput.choices],
                })),
            })),
    };
}

/**
 * @returns {void}
 */
export function clearTerminalTurnTraceState() {
    _currentTurnTrace = null;
    _recentTurnTraces = [];
    _activeToolCalls = new Map();
}
