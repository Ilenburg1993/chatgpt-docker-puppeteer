// @ts-check
/**
 * Núcleo canônico de elicitation para a arquitetura 2.0/2.1.
 *
 * Responsabilidades:
 *
 * - normalizar resultados de elicitation com base no schema do `core`;
 * - normalizar eventos `elicitation.pending` / `elicitation.completed` em contrato estável;
 * - prover a fila assíncrona provider-side usada pelo agent/runtime.
 *
 * Camadas legacy (ex.: `hooks/elicitation.js`) devem delegar para este módulo.
 *
 * @module copilot/sdk/session/elicitation
 */

import { normalizeElicitationResultWithSchema } from '#copilot/core/elicitation-schema';

/**
 * @typedef {import('../types.js').ElicitationContext} ElicitationContext
 *
 * @typedef {import('../types.js').ElicitationResult} ElicitationResult
 *
 * @typedef {import('../types.js').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('../types.js').ElicitationSchema} ElicitationSchema
 */

/**
 * @typedef {object} QueuedElicitationEntry
 * @property {string} id
 * @property {string} sessionId
 * @property {string} message
 * @property {ElicitationSchema | undefined} [requestedSchema]
 * @property {'form' | 'url'} mode
 * @property {string | undefined} [elicitationSource]
 * @property {string | undefined} [url]
 * @property {number} createdAt
 */

/**
 * @typedef {object} CompletedQueuedElicitationEntry
 * @property {string} id
 * @property {string} sessionId
 * @property {string} message
 * @property {ElicitationSchema | undefined} [requestedSchema]
 * @property {'form' | 'url'} mode
 * @property {string | undefined} [elicitationSource]
 * @property {string | undefined} [url]
 * @property {number} createdAt
 * @property {number} completedAt
 * @property {ElicitationResult} result
 */

/**
 * @typedef {object} QueuedElicitationHandlerOptions
 * @property {number} [maxSize]
 * @property {(entry: QueuedElicitationEntry) => void} [onPending]
 * @property {(entry: CompletedQueuedElicitationEntry) => void} [onCompleted]
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function tsOrNow(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

/**
 * @param {unknown} value
 * @param {ElicitationSchema | undefined} [requestedSchema]
 * @param {{ context?: string }} [options]
 * @returns {ElicitationResult}
 */
export function normalizeElicitationResult(value, requestedSchema, options = {}) {
    return /** @type {ElicitationResult} */ (
        normalizeElicitationResultWithSchema(value, requestedSchema, {
            context: options.context ?? '[sdk/session/elicitation]',
        })
    );
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     sessionId: string | null;
 *     runtimeId: string | null;
 *     message: string;
 *     mode: string;
 *     requestedSchema: Record<string, unknown> | null;
 *     url: string | null;
 *     toolCallId: string | null;
 *     elicitationSource: string | null;
 *     actionable: boolean;
 *     providerRequest: boolean;
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizeElicitationPendingEvent(eventOrData) {
    const root = objectOrNull(eventOrData) ?? {};
    const data = objectOrNull(root['data']) ?? {};
    const payload = Object.keys(data).length > 0 ? data : root;

    return {
        requestId: stringOr(payload['requestId'], '') || null,
        sessionId: stringOr(payload['sessionId'], '') || null,
        runtimeId:
            stringOr(root['runtimeId'], '') ||
            stringOr(root['sourceRuntime'], '') ||
            stringOr(payload['runtimeId'], '') ||
            stringOr(payload['sourceRuntime'], '') ||
            null,
        message: stringOr(payload['message'], ''),
        mode: stringOr(payload['mode'], payload['url'] ? 'url' : 'form'),
        requestedSchema: objectOrNull(payload['requestedSchema']),
        url: stringOr(payload['url'], '') || null,
        toolCallId: stringOr(payload['toolCallId'], '') || null,
        elicitationSource: stringOr(payload['elicitationSource'], '') || null,
        actionable: payload['actionable'] === true,
        providerRequest: payload['providerRequest'] === true,
        data: payload,
        ts: tsOrNow(root['timestamp'] ?? root['ts'] ?? payload['ts']),
    };
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     sessionId: string | null;
 *     runtimeId: string | null;
 *     action: 'accept' | 'decline' | 'cancel' | null;
 *     content: Record<string, unknown> | null;
 *     actionable: boolean;
 *     providerRequest: boolean;
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizeElicitationCompletedEvent(eventOrData) {
    const root = objectOrNull(eventOrData) ?? {};
    const data = objectOrNull(root['data']) ?? {};
    const nested = objectOrNull(data['data']) ?? {};
    const payload = Object.keys(data).length > 0 ? data : root;
    const action = payload['action'] ?? nested['action'];
    const content = payload['content'] ?? nested['content'];

    return {
        requestId: stringOr(payload['requestId'], '') || null,
        sessionId: stringOr(payload['sessionId'], '') || null,
        runtimeId:
            stringOr(root['runtimeId'], '') ||
            stringOr(root['sourceRuntime'], '') ||
            stringOr(payload['runtimeId'], '') ||
            stringOr(payload['sourceRuntime'], '') ||
            null,
        action: action === 'accept' || action === 'decline' || action === 'cancel' ? action : null,
        content: objectOrNull(content),
        actionable: payload['actionable'] === true,
        providerRequest: payload['providerRequest'] === true,
        data: payload,
        ts: tsOrNow(root['timestamp'] ?? root['ts'] ?? payload['ts']),
    };
}

/**
 * Cria um handler de elicitation controlado por fila assíncrona.
 *
 * @param {QueuedElicitationHandlerOptions} [options]
 * @returns {{
 *     handler: ElicitationHandler;
 *     resolvePending: (id: string, result: ElicitationResult) => boolean;
 *     listPending: (opts?: { sessionId?: string }) => QueuedElicitationEntry[];
 *     getPending: (id: string) => QueuedElicitationEntry | null;
 *     clearPending: (id: string, result?: ElicitationResult) => boolean;
 *     pendingCount: () => number;
 * }}
 */
export function createQueuedElicitationHandler(options = {}) {
    const { maxSize = 100, onPending, onCompleted } = options;
    /** @type {Map<string, { entry: QueuedElicitationEntry; resolve: (result: ElicitationResult) => void }>} */
    const pending = new Map();

    /**
     * @param {ElicitationContext} context
     * @returns {Promise<ElicitationResult>}
     */
    const handler = async (context) => {
        if (pending.size >= maxSize) {
            return { action: 'cancel' };
        }
        const id = `elicitation-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
        const entry = /** @type {QueuedElicitationEntry} */ ({
            id,
            sessionId: context.sessionId,
            message: context.message,
            ...(context.requestedSchema ? { requestedSchema: context.requestedSchema } : {}),
            mode: context.mode ?? (context.url ? 'url' : 'form'),
            ...(context.elicitationSource ? { elicitationSource: context.elicitationSource } : {}),
            ...(context.url ? { url: context.url } : {}),
            createdAt: Date.now(),
        });
        onPending?.(entry);
        return new Promise((resolve) => {
            pending.set(id, { entry, resolve });
        });
    };

    /**
     * @param {string} id
     * @param {ElicitationResult} result
     * @returns {boolean}
     */
    function resolvePending(id, result) {
        const queued = pending.get(id);
        if (!queued) return false;
        const normalized = normalizeElicitationResult(result, queued.entry.requestedSchema, {
            context: '[sdk/session/elicitation]',
        });
        pending.delete(id);
        queued.resolve(normalized);
        onCompleted?.({
            ...queued.entry,
            completedAt: Date.now(),
            result: normalized,
        });
        return true;
    }

    /**
     * @param {{ sessionId?: string }} [opts]
     * @returns {QueuedElicitationEntry[]}
     */
    function listPending(opts = {}) {
        return [...pending.values()]
            .map((item) => item.entry)
            .filter((entry) => !opts.sessionId || entry.sessionId === opts.sessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * @param {string} id
     * @returns {QueuedElicitationEntry | null}
     */
    function getPending(id) {
        return pending.get(id)?.entry ?? null;
    }

    /**
     * @param {string} id
     * @param {ElicitationResult} [result]
     * @returns {boolean}
     */
    function clearPending(id, result = { action: 'cancel' }) {
        return resolvePending(id, result);
    }

    return {
        handler,
        resolvePending,
        listPending,
        getPending,
        clearPending,
        pendingCount: () => pending.size,
    };
}
