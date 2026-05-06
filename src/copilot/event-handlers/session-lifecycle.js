// @ts-check
/**
 * @module copilot/event-handlers/session-lifecycle
 * @see EventBus
 * Faixa B1: Handlers dedicados para session.idle, session.error, session.warning, session.model_change,
 * session.tools_updated, session.snapshot_rewind.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { normalizeModelChangedEvent, normalizeToolsUpdatedEvent } from '#copilot/sdk';
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
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks, 'emit'>} cb
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
            const normalized = normalizeModelChangedEvent(evt);
            log(
                'INFO',
                `[session-lifecycle] model_change: ${normalized.previousModel ?? '?'} → ${normalized.newModel}`,
            );
            emit('session.model_changed', {
                previousModel: normalized.previousModel,
                newModel: normalized.newModel,
                reasoningEffort: normalized.reasoningEffort,
                ts: normalized.ts,
            });
        }),

        // ── session.tools_updated ────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_TOOLS_UPDATED, (evt) => {
            const normalized = normalizeToolsUpdatedEvent(evt);
            log('INFO', `[session-lifecycle] tools_updated: ${normalized.count} tools`);
            emit('session.tools_updated', {
                count: normalized.count,
                tools: normalized.tools,
                ts: normalized.ts,
            });
        }),

        // ── session.skills_loaded ────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_SKILLS_LOADED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const skills = /** @type {unknown[] | undefined} */ (data['skills']);
            const enabled = Array.isArray(skills)
                ? skills.filter((skill) => {
                      const rec =
                          skill && typeof skill === 'object' ? /** @type {Record<string, unknown>} */ (skill) : {};
                      return rec['enabled'] !== false;
                  }).length
                : 0;
            const count = Array.isArray(skills) ? skills.length : 0;
            log('INFO', `[session-lifecycle] skills_loaded: ${enabled}/${count} enabled`);
            emit('session.skills_loaded', { count, enabled, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.extensions_loaded ────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_EXTENSIONS_LOADED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const extensions = /** @type {unknown[] | undefined} */ (data['extensions']);
            const count = Array.isArray(extensions) ? extensions.length : 0;
            log('INFO', `[session-lifecycle] extensions_loaded: ${count}`);
            emit('session.extensions_loaded', { count, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.mcp_servers_loaded ───────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_MCP_SERVERS_LOADED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const servers = /** @type {unknown[] | undefined} */ (data['servers'] ?? data['mcpServers']);
            const count = Array.isArray(servers) ? servers.length : 0;
            log('INFO', `[session-lifecycle] mcp_servers_loaded: ${count}`);
            emit('session.mcp_servers_loaded', { count, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.background_tasks_changed ─────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_BACKGROUND_TASKS_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const count = Number(data['count'] ?? data['pendingCount'] ?? data['backgroundPendingCount'] ?? 0);
            log('DEBUG', `[session-lifecycle] background_tasks_changed: ${Number.isFinite(count) ? count : '?'}`);
            emit('session.background_tasks_changed', {
                count: Number.isFinite(count) ? count : 0,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── session.snapshot_rewind ──────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_SNAPSHOT_REWIND, (evt) => {
            const data = evt?.data ?? {};
            log('INFO', '[session-lifecycle] snapshot_rewind');
            emit('session.snapshot_rewind', { data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
