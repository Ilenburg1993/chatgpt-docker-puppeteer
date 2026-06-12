// @ts-check
/**
 * Projection state for public `tool.lifecycle` events.
 *
 * The operational registry remains session-scoped and authoritative for correlation/dedupe. This module keeps only a
 * bounded diagnostic projection for `/tools diag` and related operator views.
 *
 * @module copilot/terminal/state/tool-lifecycle-state
 */

const MAX_RECENT_TOOL_LIFECYCLE = 48;
const MAX_ACTIVE_TOOL_LIFECYCLE = 128;
const ACTIVE_TOOL_LIFECYCLE_TTL_MS = 10 * 60_000;

/**
 * @typedef {{
 *     key: string;
 *     type: import('../events/tool-lifecycle-event.js').ToolLifecycleType;
 *     status: 'active' | 'waiting_user' | 'completed' | 'failed' | 'io';
 *     source: import('../events/tool-lifecycle-event.js').ToolLifecycleSource;
 *     toolName: string;
 *     rawToolName: string | null;
 *     operation: string | null;
 *     toolCallId: string | null;
 *     requestId: string | null;
 *     traceId: string | null;
 *     turnId: string | null;
 *     target: string | null;
 *     path: string | null;
 *     directoryTargets: string[];
 *     commands: string[];
 *     filters: string[];
 *     resultCount: number | null;
 *     resultSummary: string | null;
 *     primaryTargetKind: string | null;
 *     progress: number | null;
 *     progressMessage: string | null;
 *     success: boolean | null;
 *     durationMs: number | null;
 *     startedAt: number | null;
 *     updatedAt: number;
 *     completedAt: number | null;
 * }} TerminalToolLifecycleDiagnostic
 */

/** @type {Map<string, TerminalToolLifecycleDiagnostic>} */
const _active = new Map();

/** @type {TerminalToolLifecycleDiagnostic[]} */
const _recent = [];

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {import('../events/tool-lifecycle-event.js').ToolLifecycleEvent} event
 * @returns {string}
 */
function buildLifecycleKey(event) {
    return (
        nonEmptyString(event.toolCallId) ??
        nonEmptyString(event.requestId) ??
        `${nonEmptyString(event.toolName) ?? 'tool'}:${nonEmptyString(event.traceId) ?? 'no-trace'}`
    );
}

/**
 * @param {import('../events/tool-lifecycle-event.js').ToolLifecycleEvent} event
 * @param {TerminalToolLifecycleDiagnostic | null} previous
 * @returns {TerminalToolLifecycleDiagnostic}
 */
function buildDiagnostic(event, previous) {
    const now = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    const completed = event.type === 'complete' || event.type === 'external_completed';
    const success = typeof event.success === 'boolean' ? event.success : (previous?.success ?? null);
    return {
        key: buildLifecycleKey(event),
        type: event.type,
        status:
            event.type === 'io_op'
                ? 'io'
                : event.type === 'user_requested'
                  ? 'waiting_user'
                  : completed
                    ? success === false
                        ? 'failed'
                        : 'completed'
                    : (previous?.status ?? 'active'),
        source: event.source,
        toolName: nonEmptyString(event.toolName) ?? previous?.toolName ?? 'tool',
        rawToolName: nonEmptyString(event.rawToolName) ?? previous?.rawToolName ?? null,
        operation: nonEmptyString(event.operation) ?? previous?.operation ?? null,
        toolCallId: nonEmptyString(event.toolCallId) ?? previous?.toolCallId ?? null,
        requestId: nonEmptyString(event.requestId) ?? previous?.requestId ?? null,
        traceId: nonEmptyString(event.traceId) ?? previous?.traceId ?? null,
        turnId: nonEmptyString(event.turnId) ?? previous?.turnId ?? null,
        target: nonEmptyString(event.target) ?? previous?.target ?? null,
        path: nonEmptyString(event.path) ?? previous?.path ?? null,
        directoryTargets:
            (event.directoryTargets?.length ?? 0) > 0
                ? [...(event.directoryTargets ?? [])]
                : (previous?.directoryTargets ?? []),
        commands: (event.commands?.length ?? 0) > 0 ? [...(event.commands ?? [])] : (previous?.commands ?? []),
        filters: (event.filters?.length ?? 0) > 0 ? [...(event.filters ?? [])] : (previous?.filters ?? []),
        resultCount: typeof event.resultCount === 'number' ? event.resultCount : (previous?.resultCount ?? null),
        resultSummary: nonEmptyString(event.resultSummary) ?? previous?.resultSummary ?? null,
        primaryTargetKind: nonEmptyString(event.primaryTargetKind) ?? previous?.primaryTargetKind ?? null,
        progress: typeof event.progress === 'number' ? event.progress : (previous?.progress ?? null),
        progressMessage: nonEmptyString(event.progressMessage) ?? previous?.progressMessage ?? null,
        success,
        durationMs: typeof event.durationMs === 'number' ? event.durationMs : (previous?.durationMs ?? null),
        startedAt: previous?.startedAt ?? (completed ? null : now),
        updatedAt: now,
        completedAt: completed ? now : null,
    };
}

/**
 * @param {TerminalToolLifecycleDiagnostic} entry
 * @returns {void}
 */
function pushRecent(entry) {
    _recent.unshift(entry);
    if (_recent.length > MAX_RECENT_TOOL_LIFECYCLE) _recent.length = MAX_RECENT_TOOL_LIFECYCLE;
}

/**
 * @param {number} now
 * @returns {void}
 */
function pruneActive(now) {
    for (const [key, entry] of _active) {
        if (now - entry.updatedAt > ACTIVE_TOOL_LIFECYCLE_TTL_MS) {
            _active.delete(key);
        }
    }
    while (_active.size > MAX_ACTIVE_TOOL_LIFECYCLE) {
        const oldest = _active.keys().next().value;
        if (typeof oldest !== 'string') break;
        _active.delete(oldest);
    }
}

/**
 * @param {import('../events/tool-lifecycle-event.js').ToolLifecycleEvent} event
 * @returns {void}
 */
export function recordTerminalToolLifecycleDiagnostic(event) {
    const now = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    pruneActive(now);
    const key = buildLifecycleKey(event);
    const previous = _active.get(key) ?? null;
    const diagnostic = buildDiagnostic(event, previous);
    if (event.type === 'complete' || event.type === 'external_completed') {
        _active.delete(key);
        pushRecent(diagnostic);
        return;
    }
    if (event.type === 'io_op') {
        pushRecent(diagnostic);
        return;
    }
    _active.set(key, diagnostic);
    pruneActive(now);
}

/**
 * @param {number} [limit=8] Default is `8`
 * @returns {{
 *     active: TerminalToolLifecycleDiagnostic[];
 *     recent: TerminalToolLifecycleDiagnostic[];
 *     summary: { active: number; recent: number; waitingUser: number; failedRecent: number };
 * }}
 */
export function readTerminalToolLifecycleProjection(limit = 8) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 8;
    const active = [..._active.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = _recent.slice(0, safeLimit);
    return {
        active,
        recent,
        summary: {
            active: active.length,
            recent: _recent.length,
            waitingUser: active.filter((entry) => entry.status === 'waiting_user').length,
            failedRecent: _recent.filter((entry) => entry.status === 'failed').length,
        },
    };
}

/**
 * @returns {void}
 */
export function clearTerminalToolLifecycleDiagnostics() {
    _active.clear();
    _recent.length = 0;
}
