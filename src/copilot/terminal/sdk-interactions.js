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

/** @typedef {'pending' | 'completed' | 'cleared'} SdkInteractionStatus */

/** @typedef {'question' | 'ready' | 'reply' | 'protocol'} TerminalSdkUserInputKind */

/**
 * @typedef {object} TerminalElicitationEntry
 * @property {string} id
 * @property {string | null} requestId
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

/** @type {Map<string, TerminalSdkUserInputEntry>} */
const _userInputs = new Map();

/** @type {string | null} */
let _latestUserInputId = null;

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {'accept' | 'decline' | 'cancel' | null}
 */
function elicitationActionOrNull(value) {
    return value === 'accept' || value === 'decline' || value === 'cancel' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOfStrings(value) {
    return Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0)
        : [];
}

/**
 * @param {string} question
 * @returns {TerminalSdkUserInputKind}
 */
function classifyUserInputKind(question) {
    const normalized = question.trim().toUpperCase();
    if (normalized.startsWith('READY:')) return 'ready';
    if (normalized.startsWith('REPLY:')) return 'reply';
    if (normalized.startsWith('PROTO:')) return 'protocol';
    return 'question';
}

/**
 * @param {unknown} evt
 * @returns {TerminalElicitationEntry}
 */
export function recordTerminalElicitationPending(evt) {
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '');
    const id = requestId || `elicitation-${Date.now().toString(36)}`;
    const entry = {
        id,
        requestId: requestId || null,
        message: stringOr(data['message'], '(sem mensagem)'),
        mode: stringOr(data['mode'], data['url'] ? 'url' : 'form'),
        requestedSchema: objectOrNull(data['requestedSchema']),
        url: stringOr(data['url'], '') || null,
        toolCallId: stringOr(data['toolCallId'], '') || null,
        source: stringOr(data['elicitationSource'], '') || null,
        actionable: data['actionable'] === true,
        providerRequest: data['providerRequest'] === true,
        data,
        resultAction: null,
        resultContent: null,
        createdAt: typeof data['ts'] === 'number' ? data['ts'] : Date.now(),
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _elicitations.set(id, entry);
    _latestElicitationId = id;
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalElicitationEntry | null}
 */
export function recordTerminalElicitationCompleted(evt) {
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '');
    if (!requestId) return null;
    const entry = _elicitations.get(requestId) ?? null;
    if (!entry) return null;
    entry.status = 'completed';
    entry.completedAt = typeof data['ts'] === 'number' ? data['ts'] : Date.now();
    entry.resultAction =
        elicitationActionOrNull(data['action']) ?? elicitationActionOrNull(objectOrNull(data['data'])?.['action']);
    entry.resultContent = objectOrNull(data['content']) ?? objectOrNull(objectOrNull(data['data'])?.['content']);
    return entry;
}

/**
 * @param {{ includeCompleted?: boolean }} [opts]
 * @returns {TerminalElicitationEntry[]}
 */
export function listTerminalElicitations(opts = {}) {
    return [..._elicitations.values()]
        .filter((entry) => opts.includeCompleted || entry.status === 'pending')
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @returns {{ pending: number; latest: TerminalElicitationEntry | null }}
 */
export function readTerminalElicitationSummary() {
    return {
        pending: listTerminalElicitations().length,
        latest: _latestElicitationId ? (_elicitations.get(_latestElicitationId) ?? null) : null,
    };
}

/**
 * @param {string | null | undefined} id
 * @returns {TerminalElicitationEntry | null}
 */
export function getTerminalElicitation(id) {
    const resolved = !id || id === 'latest' ? _latestElicitationId : id;
    return resolved ? (_elicitations.get(resolved) ?? null) : null;
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
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '');
    const permissionType = stringOr(data['permissionType'], stringOr(data['type'], 'unknown'));
    const id = requestId || `permission-${permissionType}-${Date.now().toString(36)}`;
    const entry = {
        id,
        requestId: requestId || null,
        permissionType,
        data,
        granted: null,
        result: null,
        createdAt: typeof data['ts'] === 'number' ? data['ts'] : Date.now(),
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _permissions.set(id, entry);
    _latestPermissionId = id;
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalPermissionEntry | null}
 */
export function recordTerminalPermissionCompleted(evt) {
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '') || stringOr(objectOrNull(data['data'])?.['requestId'], '');
    const permissionType = stringOr(
        data['permissionType'],
        stringOr(objectOrNull(data['data'])?.['permissionType'], ''),
    );
    const entry =
        (requestId ? _permissions.get(requestId) : null) ??
        [..._permissions.values()]
            .filter((candidate) => candidate.status === 'pending')
            .find((candidate) => !permissionType || candidate.permissionType === permissionType) ??
        null;
    if (!entry) return null;
    const grantedValue = data['granted'] ?? data['approved'] ?? objectOrNull(data['data'])?.['granted'];
    entry.status = 'completed';
    entry.completedAt = typeof data['ts'] === 'number' ? data['ts'] : Date.now();
    entry.granted = typeof grantedValue === 'boolean' ? grantedValue : null;
    entry.result = stringOr(data['result'], stringOr(objectOrNull(data['data'])?.['result'], '')) || null;
    entry.data = { ...entry.data, completion: data };
    return entry;
}

/**
 * @param {{ includeCompleted?: boolean }} [opts]
 * @returns {TerminalPermissionEntry[]}
 */
export function listTerminalPermissions(opts = {}) {
    return [..._permissions.values()]
        .filter((entry) => opts.includeCompleted || entry.status === 'pending')
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @param {string | null | undefined} id
 * @returns {TerminalPermissionEntry | null}
 */
export function getTerminalPermission(id) {
    const resolved = !id || id === 'latest' ? _latestPermissionId : id;
    return resolved ? (_permissions.get(resolved) ?? null) : null;
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
 * @returns {{ pending: number; latest: TerminalPermissionEntry | null }}
 */
export function readTerminalPermissionSummary() {
    return {
        pending: listTerminalPermissions().length,
        latest: _latestPermissionId ? (_permissions.get(_latestPermissionId) ?? null) : null,
    };
}

/**
 * @param {unknown} evt
 * @returns {TerminalSdkUserInputEntry}
 */
export function recordTerminalUserInputRequested(evt) {
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '');
    const question = stringOr(data['question'], '(sem pergunta)');
    const id = requestId || `user-input-${Date.now().toString(36)}`;
    const entry = {
        id,
        requestId: requestId || null,
        question,
        choices: arrayOfStrings(data['choices']),
        allowFreeform: data['allowFreeform'] !== false,
        toolCallId: stringOr(data['toolCallId'], '') || null,
        kind: classifyUserInputKind(question),
        data,
        answer: null,
        wasFreeform: null,
        createdAt: typeof data['ts'] === 'number' ? data['ts'] : Date.now(),
        completedAt: null,
        status: /** @type {SdkInteractionStatus} */ ('pending'),
    };
    _userInputs.set(id, entry);
    _latestUserInputId = id;
    return entry;
}

/**
 * @param {unknown} evt
 * @returns {TerminalSdkUserInputEntry | null}
 */
export function recordTerminalUserInputCompleted(evt) {
    const data = objectOrNull(evt) ?? {};
    const requestId = stringOr(data['requestId'], '');
    const entry =
        (requestId ? _userInputs.get(requestId) : null) ??
        [..._userInputs.values()].find((candidate) => candidate.status === 'pending') ??
        null;
    if (!entry) return null;
    entry.status = 'completed';
    entry.completedAt = typeof data['ts'] === 'number' ? data['ts'] : Date.now();
    entry.answer = stringOr(data['answer'], '') || null;
    entry.wasFreeform = data['wasFreeform'] === true;
    entry.data = { ...entry.data, completion: data };
    return entry;
}

/**
 * @param {{ includeCompleted?: boolean }} [opts]
 * @returns {TerminalSdkUserInputEntry[]}
 */
export function listTerminalUserInputs(opts = {}) {
    return [..._userInputs.values()]
        .filter((entry) => opts.includeCompleted || entry.status === 'pending')
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * @returns {{ pending: number; latest: TerminalSdkUserInputEntry | null }}
 */
export function readTerminalUserInputSummary() {
    return {
        pending: listTerminalUserInputs().length,
        latest: _latestUserInputId ? (_userInputs.get(_latestUserInputId) ?? null) : null,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalUserInputs() {
    _userInputs.clear();
    _latestUserInputId = null;
}

/**
 * @returns {void}
 */
export function clearTerminalPermissions() {
    _permissions.clear();
    _latestPermissionId = null;
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
