// @ts-check
/**
 * @module copilot/event-handlers/session-lifecycle
 * @see EventBus
 * Faixa B1: Handlers dedicados para session.idle, session.error, session.warning, session.model_change,
 * session.tools_updated, session.snapshot_rewind.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSessionLifecycleEvents(session, { emit }) {
    return [
        // ── session.idle ─────────────────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_IDLE, (evt) => {
            log('DEBUG', '[session-lifecycle] session.idle');
            emit('session.idle', { ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.error ────────────────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_ERROR, (evt) => {
            const data = evt?.data ?? {};
            const errorType = /** @type {string | undefined} */ (data['errorType']);
            const message = /** @type {string | undefined} */ (data['message']);
            log('WARN', `[session-lifecycle] session.error: type=${errorType ?? 'unknown'} msg=${message ?? ''}`);
            emit('session.error', { errorType, message, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.warning ──────────────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_WARNING, (evt) => {
            const data = evt?.data ?? {};
            const message = /** @type {string | undefined} */ (data['message']);
            log('WARN', `[session-lifecycle] session.warning: ${message ?? '(sem mensagem)'}`);
            emit('session.warning', { message, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.model_change ─────────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_MODEL_CHANGE, (evt) => {
            const data = evt?.data ?? {};
            const previousModel = /** @type {string | undefined} */ (data['previousModel']);
            const newModel = /** @type {string | undefined} */ (data['newModel']);
            log('INFO', `[session-lifecycle] model_change: ${previousModel ?? '?'} → ${newModel ?? '?'}`);
            emit('session.model_changed', { previousModel, newModel, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.tools_updated ────────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_TOOLS_UPDATED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const tools = /** @type {unknown[] | undefined} */ (data['tools']);
            const count = Array.isArray(tools) ? tools.length : 0;
            log('INFO', `[session-lifecycle] tools_updated: ${count} tools`);
            emit('session.tools_updated', { count, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.snapshot_rewind ──────────────────────────────────────
        session.on(SESSION_EVENTS.SESSION_SNAPSHOT_REWIND, (evt) => {
            const data = evt?.data ?? {};
            log('INFO', '[session-lifecycle] snapshot_rewind');
            emit('session.snapshot_rewind', { data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
