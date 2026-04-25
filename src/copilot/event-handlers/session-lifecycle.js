// @ts-check
/**
 * @module copilot/event-handlers/session-lifecycle
 * @see EventBus
 * Faixa B1: Handlers dedicados para session.idle, session.error, session.warning, session.model_change,
 * session.tools_updated, session.snapshot_rewind.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '../sdk/session/events.js';

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizeSdkMessage(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (raw);
        if (typeof rec['message'] === 'string' && rec['message']) return rec['message'];
        const nestedError = rec['error'];
        if (nestedError && typeof nestedError === 'object') {
            const errRec = /** @type {Record<string, unknown>} */ (nestedError);
            if (typeof errRec['message'] === 'string' && errRec['message']) return errRec['message'];
        }
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw);
        }
    }
    return raw == null ? undefined : String(raw);
}

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSessionLifecycleEvents(session, { emit }) {
    return [
        // ── session.idle ─────────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_IDLE, (evt) => {
            log('DEBUG', '[session-lifecycle] session.idle');
            emit('session.idle', { ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.info ─────────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_INFO, (evt) => {
            const data = evt?.data ?? {};
            const infoType = /** @type {string | undefined} */ (data['infoType']);
            const message = /** @type {string | undefined} */ (data['message']);
            const url = /** @type {string | undefined} */ (data['url']);
            log('INFO', `[session-lifecycle] session.info[${infoType ?? 'unknown'}]: ${message ?? ''}`);
            emit('session.info', { infoType, message, url, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.error ────────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_ERROR, (evt) => {
            const data = evt?.data ?? {};
            const errorType = /** @type {string | undefined} */ (data['errorType']);
            const message = normalizeSdkMessage(data['message']);
            log('WARN', `[session-lifecycle] session.error: type=${errorType ?? 'unknown'} msg=${message ?? ''}`);
            emit('session.error', { errorType, message, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.warning ──────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_WARNING, (evt) => {
            const data = evt?.data ?? {};
            const warningType = /** @type {string | undefined} */ (data['warningType']);
            const message = /** @type {string | undefined} */ (data['message']);
            const url = /** @type {string | undefined} */ (data['url']);
            log('WARN', `[session-lifecycle] session.warning: ${message ?? '(sem mensagem)'}`);
            emit('session.warning', { warningType, message, url, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.model_change ─────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_MODEL_CHANGE, (evt) => {
            const data = evt?.data ?? {};
            const previousModel = /** @type {string | undefined} */ (data['previousModel']);
            const newModel = /** @type {string | undefined} */ (data['newModel']);
            const reasoningEffort = /** @type {string | undefined} */ (data['reasoningEffort']);
            log('INFO', `[session-lifecycle] model_change: ${previousModel ?? '?'} → ${newModel ?? '?'}`);
            emit('session.model_changed', {
                previousModel,
                newModel,
                reasoningEffort,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── session.tools_updated ────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_TOOLS_UPDATED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const tools = /** @type {unknown[] | undefined} */ (data['tools']);
            const count = Array.isArray(tools) ? tools.length : 0;
            log('INFO', `[session-lifecycle] tools_updated: ${count} tools`);
            emit('session.tools_updated', { count, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.snapshot_rewind ──────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_SNAPSHOT_REWIND, (evt) => {
            const data = evt?.data ?? {};
            log('INFO', '[session-lifecycle] snapshot_rewind');
            emit('session.snapshot_rewind', { data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
