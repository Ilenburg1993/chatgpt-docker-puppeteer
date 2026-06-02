// @ts-check

const MAX_RECENT_TURN_TRACES = 20;

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
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeToolCallId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
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
        files: trace.files.map((entry) => ({ ...entry })),
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
    const effectiveTarget = target ?? path ?? null;
    const actionKey =
        normalizedToolCallId ?? `${toolName}\u241f${operation}\u241f${effectiveTarget ?? ''}\u241f${source}`;
    const existingIndex = trace.toolIndex.get(actionKey);

    if (existingIndex == null) {
        trace.toolIndex.set(actionKey, trace.tools.length);
        trace.tools.push({
            toolName,
            operation,
            path,
            target: effectiveTarget,
            source,
            status,
            success,
            count: 1,
            updatedAt: timestamp,
        });
    } else {
        const existing = trace.tools[existingIndex];
        if (existing) {
            existing.status = status;
            existing.success = success;
            existing.updatedAt = timestamp;
            existing.count += 1;
            existing.path = existing.path ?? path;
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

    if (path) {
        recordTerminalTurnFileActivity({ path, operation, source, turnId: trace.turnId, timestamp });
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
        .map((choice) => choice.trim());
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
    allowFreeform = true,
    status = 'requested',
    answerPreview = null,
    source = 'sdk',
    turnId = null,
    timestamp = Date.now(),
}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const trace = ensureCurrentTurnTrace(timestamp, normalizedTurnId, normalizedTurnId ? 'assistant' : 'implicit');
    const normalizedRequestId = normalizeToolCallId(requestId);
    const normalizedQuestion = typeof question === 'string' && question.trim() ? question.trim() : '(sem pergunta)';
    const key =
        normalizedRequestId ??
        `${normalizeUserInputKind(kind)}\u241f${normalizedQuestion}\u241f${source}\u241f${trace.userInputs.length}`;
    const existingIndex = trace.userInputIndex.get(key);
    const normalizedStatus = normalizeUserInputStatus(status);

    if (existingIndex == null) {
        trace.userInputIndex.set(key, trace.userInputs.length);
        trace.userInputs.push({
            requestId: normalizedRequestId,
            kind: normalizeUserInputKind(kind),
            question: normalizedQuestion,
            choices: normalizeChoices(choices),
            allowFreeform: allowFreeform !== false,
            status: normalizedStatus,
            answerPreview:
                typeof answerPreview === 'string' && answerPreview.trim().length > 0 ? answerPreview.trim() : null,
            source,
            count: 1,
            updatedAt: timestamp,
        });
    } else {
        const existing = trace.userInputs[existingIndex];
        if (existing) {
            existing.status = normalizedStatus;
            existing.answerPreview =
                typeof answerPreview === 'string' && answerPreview.trim().length > 0
                    ? answerPreview.trim()
                    : existing.answerPreview;
            existing.choices = existing.choices.length > 0 ? existing.choices : normalizeChoices(choices);
            existing.allowFreeform = existing.allowFreeform || allowFreeform !== false;
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
 *     turnId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnTraceSnapshot}
 */
export function recordTerminalTurnFileActivity({
    path,
    operation = 'unknown',
    source = 'sdk',
    turnId = null,
    timestamp = Date.now(),
}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    const trace = ensureCurrentTurnTrace(timestamp, normalizedTurnId, normalizedTurnId ? 'assistant' : 'implicit');
    const fileKey = `${operation}\u241f${path}\u241f${source}`;
    const existingIndex = trace.fileIndex.get(fileKey);
    if (existingIndex == null) {
        trace.fileIndex.set(fileKey, trace.files.length);
        trace.files.push({ path, operation, source, count: 1, updatedAt: timestamp });
    } else {
        const existing = trace.files[existingIndex];
        if (existing) {
            existing.count += 1;
            existing.updatedAt = timestamp;
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
                files: entry.files.map((file) => ({ ...file })),
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
