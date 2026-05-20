// @ts-check
/**
 * Estado de UX terminal para interações SDK que não pertencem ao protocolo READY/REPLY.
 *
 * `ask_user` é tratado pelo dialog loop porque ele transporta a conversa viva da LLM-B. `elicitation` e permissões SDK
 * são tratados aqui porque representam interrupções estruturadas do operador, normalmente correlacionadas a
 * tools/MCP/UI.
 *
 * @module copilot/terminal/sdk-interactions
 */

import {
    classifyTerminalUserInputQuestionKind,
    normalizeTerminalElicitationCompletedEvent,
    normalizeTerminalElicitationPendingEvent,
    normalizeTerminalPermissionCompletedEvent,
    normalizeTerminalPermissionRequestedEvent,
    normalizeTerminalUserInputCompletedEvent,
    normalizeTerminalUserInputRequestedEvent,
} from '../frontend/gateways/index.js';

/** @typedef {'pending' | 'completed' | 'cleared'} SdkInteractionStatus */

/** @typedef {{ mode: 'approve_all' | 'audit_only' | 'selective'; ts: number }} TerminalPermissionModeEntry */

/** @typedef {'question' | 'ready' | 'reply' | 'stopped'} TerminalSdkUserInputKind */

const MAX_COMPLETED_INTERACTIONS_PER_KIND = 100;
const COMPLETED_INTERACTION_TTL_MS = 30 * 60_000;
const USER_INPUT_ECHO_SUPPRESSION_TTL_MS = 10_000;

let _syntheticInteractionSeq = 0;

/**
 * @typedef {object} TerminalElicitationEntry
 * @property {string} id
 * @property {string | null} requestId
 * @property {string | null} runtimeId
 * @property {string} message
 * @property {string} mode
 * @property {Record<string, unknown> | null} requestedSchema
 * @property {string | null} url
 * @property {string | null} toolCallId
 * @property {string | null} source
 * @property {boolean} actionable
 * @property {boolean} providerRequest
 * @property {Record<string, unknown>} data
 * @property {'accept' | 'decline' | 'cancel' | null} resultAction
 * @property {Record<string, unknown> | null} resultContent
 * @property {number} createdAt
 * @property {number | null} completedAt
 * @property {SdkInteractionStatus} status
 */

/**
 * @typedef {object} TerminalSdkUserInputEntry
 * @property {string} id
 * @property {string | null} requestId
 * @property {string | null} runtimeId
 * @property {string} question
 * @property {string[]} choices
 * @property {boolean} allowFreeform
 * @property {string | null} toolCallId
 * @property {TerminalSdkUserInputKind} kind
 * @property {Record<string, unknown>} data
 * @property {string | null} answer
 * @property {boolean | null} wasFreeform
 * @property {number} createdAt
 * @property {number | null} completedAt
 * @property {SdkInteractionStatus} status
 */

/**
 * @typedef {object} TerminalPermissionEntry
 * @property {string} id
 * @property {string | null} requestId
 * @property {string | null} runtimeId
 * @property {string} permissionType
 * @property {Record<string, unknown>} data
 * @property {boolean | null} granted
 * @property {string | null} result
 * @property {number} createdAt
 * @property {number | null} completedAt
 * @property {SdkInteractionStatus} status
 */

/** @type {Map<string, TerminalElicitationEntry>} */
const _elicitations = new Map();

/** @type {string | null} */
let _latestElicitationId = null;

/** @type {Map<string, TerminalPermissionEntry>} */
const _permissions = new Map();

/** @type {string | null} */
let _latestPermissionId = null;

/** @type {TerminalPermissionModeEntry[]} */
const _permissionModeHistory = [];

/** @type {Map<string, TerminalSdkUserInputEntry>} */
const _userInputs = new Map();

/** @type {string | null} */
let _latestUserInputId = null;

/** @type {{ answer: string; runtimeId: string | null; requestId: string | null; ts: number }[]} */
const _recentUserInputAnswerEchoGuards = [];

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeRuntimeId(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEchoComparableText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function nextSyntheticInteractionId(prefix) {
    _syntheticInteractionSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${_syntheticInteractionSeq.toString(36)}`;
}

/**
 * @param {Map<string, { id: string; status: SdkInteractionStatus; createdAt: number; completedAt: number | null }>} map
 * @param {string | null} latestId
 * @param {number} [now]
 * @returns {string | null}
 */
function pruneCompletedInteractionMap(map, latestId, now = Date.now()) {
    /** @type {{ id: string; status: SdkInteractionStatus; createdAt: number; completedAt: number | null }[]} */
    const completed = [];
    /** @type {{ id: string; status: SdkInteractionStatus; createdAt: number; completedAt: number | null } | null} */
    let latestRemaining = null;
    for (const entry of map.values()) {
        if (!latestRemaining || entry.createdAt > latestRemaining.createdAt) {
            latestRemaining = entry;
        }
        if (entry.status !== 'pending') {
            completed.push(entry);
        }
    }
    completed.sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
    const toDelete = new Set();
    for (const entry of completed) {
        const completedAt = entry.completedAt ?? entry.createdAt;
        if (now - completedAt > COMPLETED_INTERACTION_TTL_MS) {
            toDelete.add(entry.id);
        }
    }
    for (const entry of completed.slice(MAX_COMPLETED_INTERACTIONS_PER_KIND)) {
        toDelete.add(entry.id);
    }
    for (const id of toDelete) {
        map.delete(id);
    }
    if (latestId && map.has(latestId)) return latestId;
    if (latestRemaining && !toDelete.has(latestRemaining.id)) {
        return latestRemaining.id;
    }
    let nextLatest = null;
    for (const entry of map.values()) {
        if (!nextLatest || entry.createdAt > nextLatest.createdAt) {
            nextLatest = entry;
        }
    }
    return nextLatest?.id ?? null;
}

/**
 * Limita retenção de interações SDK concluídas sem apagar waits pendentes.
 *
 * Sessões longas podem produzir milhares de eventos de elicitation/permissão/user_input. A UI só precisa de histórico
 * recente; pendências vivas são sempre preservadas.
 *
 * @param {number} [now]
 * @returns {void}
 */
export function pruneTerminalSdkInteractions(now = Date.now()) {
    _latestElicitationId = pruneCompletedInteractionMap(_elicitations, _latestElicitationId, now);
    _latestPermissionId = pruneCompletedInteractionMap(_permissions, _latestPermissionId, now);
    _latestUserInputId = pruneCompletedInteractionMap(_userInputs, _latestUserInputId, now);
}

/**
 * @param {unknown} evt
 * @returns {TerminalElicitationEntry}
 */
export function recordTerminalElicitationPending(evt) {
    const normalized = normalizeTerminalElicitationPendingEvent(evt);
    const requestId = normalized.requestId ?? '';
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const id = requestId || nextSyntheticInteractionId('elicitation');
    const entry = {
        id,
        requestId: requestId || null,
        runtimeId,
        message: normalized.message || '(sem mensagem)',
        mode: normalized.mode,
        requestedSchema: normalized.requestedSchema,
        url: normalized.url,
        toolCallId: normalized.toolCallId,
        source: normalized.elicitationSource,
        actionable: normalized.actionable,
        providerRequest: normalized.providerRequest,
        data: normalized.data,
        resultAction: null,
        resultContent: null,
        createdAt: normalized.ts,
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _elicitations.set(id, entry);
    _latestElicitationId = id;
    pruneTerminalSdkInteractions();
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalElicitationEntry | null}
 */
export function recordTerminalElicitationCompleted(evt) {
    const normalized = normalizeTerminalElicitationCompletedEvent(evt);
    const requestId = normalized.requestId ?? '';
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const entry =
        (requestId ? _elicitations.get(requestId) : null) ??
        [..._elicitations.values()]
            .filter((candidate) => candidate.status === 'pending')
            .filter((candidate) => !runtimeId || candidate.runtimeId === runtimeId)
            .find(() => true) ??
        null;
    if (!entry) return null;
    entry.status = 'completed';
    entry.completedAt = normalized.ts;
    entry.resultAction = normalized.action;
    entry.resultContent = normalized.content;
    entry.data = { ...entry.data, completion: normalized.data };
    pruneTerminalSdkInteractions(normalized.ts);
    return entry;
}

/**
 * @param {{ includeCompleted?: boolean; runtimeId?: string | null }} [opts]
 * @returns {TerminalElicitationEntry[]}
 */
export function listTerminalElicitations(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    return [..._elicitations.values()]
        .filter((entry) => opts.includeCompleted || entry.status === 'pending')
        .filter((entry) => !runtimeId || entry.runtimeId === runtimeId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @param {{ runtimeId?: string | null }} [opts]
 * @returns {{ pending: number; latest: TerminalElicitationEntry | null }}
 */
export function readTerminalElicitationSummary(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    const pendingEntries = listTerminalElicitations({ runtimeId });
    const latest = runtimeId
        ? (listTerminalElicitations({ includeCompleted: true, runtimeId })[0] ?? null)
        : _latestElicitationId
          ? (_elicitations.get(_latestElicitationId) ?? null)
          : null;
    return {
        pending: pendingEntries.length,
        latest,
    };
}

/**
 * @param {string | null | undefined} id
 * @param {{ runtimeId?: string | null }} [opts]
 * @returns {TerminalElicitationEntry | null}
 */
export function getTerminalElicitation(id, opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    const wantsLatest = !id || id === 'latest';
    if (wantsLatest) {
        return listTerminalElicitations({ includeCompleted: true, runtimeId })[0] ?? null;
    }
    const resolved = id;
    const entry = _elicitations.get(resolved) ?? null;
    if (!entry) return null;
    if (runtimeId && entry.runtimeId !== runtimeId) return null;
    return entry;
}

/**
 * @param {string | null | undefined} id
 * @returns {boolean}
 */
export function clearTerminalElicitation(id) {
    if (id === 'all') {
        _elicitations.clear();
        _latestElicitationId = null;
        return true;
    }
    const resolved = !id || id === 'latest' ? _latestElicitationId : id;
    if (!resolved) return false;
    const deleted = _elicitations.delete(resolved);
    if (_latestElicitationId === resolved) {
        _latestElicitationId = listTerminalElicitations({ includeCompleted: true })[0]?.id ?? null;
    }
    return deleted;
}

/**
 * @param {unknown} evt
 * @returns {TerminalPermissionEntry}
 */
export function recordTerminalPermissionRequested(evt) {
    const normalized = normalizeTerminalPermissionRequestedEvent(evt);
    const requestId = normalized.requestId ?? '';
    const permissionType = normalized.permissionType;
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const id = requestId || nextSyntheticInteractionId(`permission-${permissionType}`);
    const entry = {
        id,
        requestId: requestId || null,
        runtimeId,
        permissionType,
        data: normalized.data,
        granted: null,
        result: null,
        createdAt: normalized.ts,
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _permissions.set(id, entry);
    _latestPermissionId = id;
    pruneTerminalSdkInteractions();
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalPermissionEntry | null}
 */
export function recordTerminalPermissionCompleted(evt) {
    const normalized = normalizeTerminalPermissionCompletedEvent(evt);
    const requestId = normalized.requestId ?? '';
    const permissionType = normalized.permissionType;
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const entry =
        (requestId ? _permissions.get(requestId) : null) ??
        [..._permissions.values()]
            .filter((candidate) => candidate.status === 'pending')
            .filter((candidate) => !runtimeId || candidate.runtimeId === runtimeId)
            .find((candidate) => !permissionType || candidate.permissionType === permissionType) ??
        null;
    if (!entry) return null;
    entry.status = 'completed';
    entry.completedAt = normalized.ts;
    entry.granted = normalized.granted;
    entry.result = normalized.resultKind;
    entry.data = { ...entry.data, completion: normalized.data, decision: normalized.decision };
    pruneTerminalSdkInteractions(normalized.ts);
    return entry;
}

/**
 * @param {{ includeCompleted?: boolean; runtimeId?: string | null }} [opts]
 * @returns {TerminalPermissionEntry[]}
 */
export function listTerminalPermissions(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    return [..._permissions.values()]
        .filter((entry) => (opts.includeCompleted ? true : entry.status === 'pending'))
        .filter((entry) => !runtimeId || entry.runtimeId === runtimeId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @param {string | null | undefined} id
 * @param {{ runtimeId?: string | null }} [opts]
 * @returns {TerminalPermissionEntry | null}
 */
export function getTerminalPermission(id, opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    const wantsLatest = !id || id === 'latest';
    if (wantsLatest) {
        return listTerminalPermissions({ includeCompleted: true, runtimeId })[0] ?? null;
    }
    const resolved = id;
    const entry = _permissions.get(resolved) ?? null;
    if (!entry) return null;
    if (runtimeId && entry.runtimeId !== runtimeId) return null;
    return entry;
}

/**
 * @param {string | null | undefined} id
 * @returns {boolean}
 */
export function clearTerminalPermission(id) {
    if (id === 'all') {
        clearTerminalPermissions();
        return true;
    }
    const resolved = !id || id === 'latest' ? _latestPermissionId : id;
    if (!resolved) return false;
    const deleted = _permissions.delete(resolved);
    if (_latestPermissionId === resolved) {
        _latestPermissionId = listTerminalPermissions({ includeCompleted: true })[0]?.id ?? null;
    }
    return deleted;
}

/**
 * @param {{ runtimeId?: string | null }} [opts]
 * @returns {{ pending: number; latest: TerminalPermissionEntry | null }}
 */
export function readTerminalPermissionSummary(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    const pendingEntries = listTerminalPermissions({ runtimeId });
    const latest = listTerminalPermissions({ includeCompleted: true, runtimeId })[0] ?? null;
    return {
        pending: pendingEntries.length,
        latest,
    };
}

/**
 * @param {unknown} mode
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
function normalizePermissionMode(mode) {
    if (mode === 'audit_only' || mode === 'selective') return mode;
    return 'approve_all';
}

/**
 * @param {unknown} evt
 * @returns {TerminalPermissionModeEntry}
 */
export function recordTerminalPermissionModeChanged(evt) {
    const data = objectOrNull(evt) ?? {};
    const entry = {
        mode: normalizePermissionMode(data['mode']),
        ts: typeof data['ts'] === 'number' && Number.isFinite(data['ts']) ? data['ts'] : Date.now(),
    };
    _permissionModeHistory.unshift(entry);
    if (_permissionModeHistory.length > 30) {
        _permissionModeHistory.length = 30;
    }
    return entry;
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {TerminalPermissionModeEntry[]}
 */
export function listTerminalPermissionModeHistory(opts = {}) {
    const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 5;
    return _permissionModeHistory.slice(0, limit);
}

/**
 * @param {unknown} evt
 * @returns {TerminalSdkUserInputEntry}
 */
export function recordTerminalUserInputRequested(evt) {
    const normalized = normalizeTerminalUserInputRequestedEvent(evt);
    const requestId = normalized.requestId ?? '';
    const question = normalized.question || '(sem pergunta)';
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const id = requestId || nextSyntheticInteractionId('user-input');
    const entry = {
        id,
        requestId: requestId || null,
        runtimeId,
        question,
        choices: normalized.choices,
        allowFreeform: normalized.allowFreeform,
        toolCallId: normalized.toolCallId,
        kind: classifyTerminalUserInputQuestionKind(question),
        data: normalized.data,
        answer: null,
        wasFreeform: null,
        createdAt: normalized.ts,
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _userInputs.set(id, entry);
    _latestUserInputId = id;
    pruneTerminalSdkInteractions();
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalSdkUserInputEntry | null}
 */
export function recordTerminalUserInputCompleted(evt) {
    const normalized = normalizeTerminalUserInputCompletedEvent(evt);
    const requestId = normalized.requestId ?? '';
    const runtimeId = normalizeRuntimeId(normalized.runtimeId);
    const entry =
        (requestId ? _userInputs.get(requestId) : null) ??
        [..._userInputs.values()]
            .filter((candidate) => candidate.status === 'pending')
            .filter((candidate) => !runtimeId || candidate.runtimeId === runtimeId)
            .find(() => true) ??
        null;
    if (!entry) return null;
    entry.status = 'completed';
    entry.completedAt = normalized.ts;
    entry.answer = normalized.answer || null;
    entry.wasFreeform = normalized.wasFreeform;
    entry.data = { ...entry.data, completion: normalized.data };
    recordTerminalUserInputAnswerEchoGuard({
        answer: normalized.answer,
        runtimeId,
        requestId: entry.requestId,
        ts: normalized.ts,
    });
    pruneTerminalSdkInteractions(normalized.ts);
    return entry;
}

/**
 * Registra localmente uma resposta humana recém-enviada para bloquear ecos em canais de streaming que podem chegar
 * antes do evento SDK `user_input.completed`.
 *
 * @param {{ answer: string; runtimeId?: string | null; requestId?: string | null; ts?: number }} input
 * @returns {void}
 */
export function recordTerminalUserInputAnswerEchoGuard({ answer, runtimeId = null, requestId = null, ts = Date.now() }) {
    const normalizedAnswer = normalizeEchoComparableText(answer);
    if (!normalizedAnswer) return;
    _recentUserInputAnswerEchoGuards.unshift({
        answer: normalizedAnswer,
        runtimeId: normalizeRuntimeId(runtimeId),
        requestId: typeof requestId === 'string' && requestId.trim() ? requestId.trim() : null,
        ts,
    });
    if (_recentUserInputAnswerEchoGuards.length > 32) {
        _recentUserInputAnswerEchoGuards.length = 32;
    }
}

/**
 * Detecta `assistant.message` que é apenas eco protocolar imediato da resposta humana enviada para `ask_user`.
 *
 * O SDK pode emitir a resposta do operador no canal de mensagem pública logo após `user_input.completed`. Esse texto já
 * tem fonte canônica própria (`question.answered`/`user_input.completed`) e mostrá-lo como fala da LLM-B confunde
 * autoria, histórico e auditoria de transcript.
 *
 * @param {{ content?: string; runtimeId?: string | null; now?: number }} input
 * @returns {boolean}
 */
export function shouldSuppressTerminalAssistantMessageAsUserInputEcho({ content, runtimeId = null, now = Date.now() }) {
    const normalizedContent = normalizeEchoComparableText(content);
    if (!normalizedContent) return false;
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    for (const guard of _recentUserInputAnswerEchoGuards) {
        if (now - guard.ts > USER_INPUT_ECHO_SUPPRESSION_TTL_MS) continue;
        if (normalizedRuntimeId && guard.runtimeId && guard.runtimeId !== normalizedRuntimeId) continue;
        if (guard.answer === normalizedContent) return true;
    }
    for (const entry of _userInputs.values()) {
        if (entry.status !== 'completed') continue;
        if (!entry.completedAt || now - entry.completedAt > USER_INPUT_ECHO_SUPPRESSION_TTL_MS) continue;
        if (normalizedRuntimeId && entry.runtimeId && entry.runtimeId !== normalizedRuntimeId) continue;
        if (normalizeEchoComparableText(entry.answer) !== normalizedContent) continue;
        return true;
    }
    return false;
}

/**
 * @param {{ includeCompleted?: boolean; runtimeId?: string | null }} [opts]
 * @returns {TerminalSdkUserInputEntry[]}
 */
export function listTerminalUserInputs(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    return [..._userInputs.values()]
        .filter((entry) => opts.includeCompleted || entry.status === 'pending')
        .filter((entry) => !runtimeId || entry.runtimeId === runtimeId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @param {{ runtimeId?: string | null }} [opts]
 * @returns {{ pending: number; latest: TerminalSdkUserInputEntry | null }}
 */
export function readTerminalUserInputSummary(opts = {}) {
    const runtimeId = normalizeRuntimeId(opts.runtimeId);
    const pendingEntries = listTerminalUserInputs({ runtimeId });
    const latest = runtimeId
        ? (listTerminalUserInputs({ includeCompleted: true, runtimeId })[0] ?? null)
        : _latestUserInputId
          ? (_userInputs.get(_latestUserInputId) ?? null)
          : null;
    return {
        pending: pendingEntries.length,
        latest,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalUserInputs() {
    _userInputs.clear();
    _recentUserInputAnswerEchoGuards.length = 0;
    _latestUserInputId = null;
}

/**
 * @returns {void}
 */
export function clearTerminalPermissions() {
    _permissions.clear();
    _latestPermissionId = null;
    _permissionModeHistory.length = 0;
}

/**
 * @param {unknown} result
 * @returns {'ok' | 'warn' | 'bad'}
 */
export function classifyTerminalSdkQuota(result) {
    const data = objectOrNull(result) ?? {};
    const snapshots = objectOrNull(data['quotaSnapshots']) ?? {};
    let worst = 1;
    for (const snapshot of Object.values(snapshots)) {
        const snap = objectOrNull(snapshot) ?? {};
        const remaining = Number(snap['remainingPercentage']);
        if (Number.isFinite(remaining)) worst = Math.min(worst, remaining);
    }
    if (worst <= 0.05) return 'bad';
    if (worst <= 0.2) return 'warn';
    return 'ok';
}
