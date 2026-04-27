// @ts-check
/**
 * Estado de UX terminal para interações SDK que não pertencem ao protocolo READY/REPLY.
 *
 * `ask_user` é tratado pelo dialog loop porque ele transporta a conversa viva da LLM-B. `elicitation` é tratado aqui
 * porque é formulário/URL estruturado do SDK, normalmente correlacionado a tools/MCP/UI.
 *
 * @module copilot/terminal/sdk-interactions
 */

/** @typedef {'pending' | 'completed' | 'cleared'} SdkInteractionStatus */

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

/** @type {Map<string, TerminalElicitationEntry>} */
const _elicitations = new Map();

/** @type {string | null} */
let _latestElicitationId = null;

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
