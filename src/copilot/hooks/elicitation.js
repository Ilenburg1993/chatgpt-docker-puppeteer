// @ts-check
/**
 * src/copilot/hooks/elicitation.js
 *
 * Handlers para `onElicitationRequest` do SDK.
 *
 * Diferente de `ask_user`, elicitation transporta formulários/URLs estruturadas e pode conter schema JSON completo.
 * Este módulo fornece uma estratégia de fila assíncrona, permitindo que terminal, HTTP ou outra UI respondam de forma
 * programática a pedidos pendentes.
 *
 * @module copilot/hooks/elicitation
 */

import { normalizeElicitationResultWithSchema } from '../core/elicitation-schema.js';
import { log } from './logger.js';

/**
 * @typedef {import('#copilot/sdk/types.js').ElicitationContext} ElicitationContext
 *
 * @typedef {import('#copilot/sdk/types.js').ElicitationResult} ElicitationResult
 */

/**
 * @typedef {object} QueuedElicitationEntry
 * @property {string} id
 * @property {string} sessionId
 * @property {string} message
 * @property {import('#copilot/sdk/types.js').ElicitationSchema | undefined} [requestedSchema]
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
 * @property {import('#copilot/sdk/types.js').ElicitationSchema | undefined} [requestedSchema]
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
 * @param {import('#copilot/sdk/types.js').ElicitationSchema | undefined} [requestedSchema]
 * @returns {ElicitationResult}
 */
function normalizeElicitationResult(value, requestedSchema) {
    return /** @type {ElicitationResult} */ (
        normalizeElicitationResultWithSchema(value, requestedSchema, { context: '[hooks/elicitation]' })
    );
}

/**
 * Cria um handler de elicitation controlado por fila assíncrona.
 *
 * @param {QueuedElicitationHandlerOptions} [options]
 * @returns {{
 *     handler: import('#copilot/sdk/types.js').ElicitationHandler;
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
            log('WARN', `[hooks/elicitation] queue cheia (maxSize=${maxSize}) — cancelando solicitação.`);
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
            log('DEBUG', `[hooks/elicitation] pending: ${id} session=${context.sessionId}`);
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
        const normalized = normalizeElicitationResult(result, queued.entry.requestedSchema);
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
