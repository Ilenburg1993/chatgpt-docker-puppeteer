// @ts-check
/**
 * @module copilot/event-handlers/session-lifecycle
 * @see EventBus
 * Faixa B1: Handlers dedicados para session.idle, session.error, session.warning, session.model_change,
 * session.tools_updated, session.snapshot_rewind.
 */

import {
    EMITTER_EXTENSION_CONTEXT,
    EMITTER_NEW_INBOX_MESSAGE,
    EMITTER_SESSION_AUTOPILOT_OBJECTIVE_CHANGED,
    EMITTER_SESSION_CUSTOM_AGENTS_UPDATED,
    EMITTER_SESSION_CUSTOM_NOTIFICATION,
    EMITTER_SESSION_EXTENSIONS_ATTACHMENTS_PUSHED,
    EMITTER_SESSION_REMOTE_STEERABLE_CHANGED,
    EMITTER_SESSION_SCHEDULE_CANCELLED,
    EMITTER_SESSION_SCHEDULE_CREATED,
    SESSION_EVENTS,
} from '#copilot/events';
import { normalizeModelChangedEvent, normalizeToolsUpdatedEvent, onSessionEvent } from '#copilot/events/sdk-events';
import { log } from '#copilot/observability';

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
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit'>} cb
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
                toolsMaterialized: normalized.toolsMaterialized,
                countMaterialized: normalized.countMaterialized,
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

        // ── session.autopilot_objective_changed ─────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_AUTOPILOT_OBJECTIVE_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const objective =
                typeof data['objective'] === 'string'
                    ? data['objective']
                    : typeof data['title'] === 'string'
                      ? data['title']
                      : typeof data['summary'] === 'string'
                        ? data['summary']
                        : null;
            log('INFO', `[session-lifecycle] autopilot_objective_changed: ${objective ?? '(sem objetivo)'}`);
            emit(EMITTER_SESSION_AUTOPILOT_OBJECTIVE_CHANGED, { objective, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.custom_agents_updated ───────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_CUSTOM_AGENTS_UPDATED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const agents = /** @type {unknown[] | undefined} */ (data['agents'] ?? data['customAgents']);
            const count = Array.isArray(agents) ? agents.length : Number(data['count'] ?? 0);
            log('INFO', `[session-lifecycle] custom_agents_updated: ${Number.isFinite(count) ? count : 0}`);
            emit(EMITTER_SESSION_CUSTOM_AGENTS_UPDATED, {
                count: Number.isFinite(count) ? count : 0,
                agents: Array.isArray(agents) ? agents : undefined,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── session.custom_notification ─────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_CUSTOM_NOTIFICATION, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const title = typeof data['title'] === 'string' ? data['title'] : null;
            const message = typeof data['message'] === 'string' ? data['message'] : null;
            const level =
                typeof data['level'] === 'string'
                    ? data['level']
                    : typeof data['severity'] === 'string'
                      ? data['severity']
                      : null;
            log('INFO', `[session-lifecycle] custom_notification: ${title ?? message ?? '(sem mensagem)'}`);
            emit(EMITTER_SESSION_CUSTOM_NOTIFICATION, {
                title,
                message,
                level,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── session.extensions.attachments_pushed ───────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_EXTENSIONS_ATTACHMENTS_PUSHED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const attachments = /** @type {unknown[] | undefined} */ (data['attachments']);
            const count = Array.isArray(attachments) ? attachments.length : Number(data['count'] ?? 0);
            const extensionName =
                typeof data['extensionName'] === 'string'
                    ? data['extensionName']
                    : typeof data['extension'] === 'string'
                      ? data['extension']
                      : null;
            log('INFO', `[session-lifecycle] extensions.attachments_pushed: ${Number.isFinite(count) ? count : 0}`);
            emit(EMITTER_SESSION_EXTENSIONS_ATTACHMENTS_PUSHED, {
                count: Number.isFinite(count) ? count : 0,
                extensionName,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── session.remote_steerable_changed ────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_REMOTE_STEERABLE_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const enabled =
                typeof data['enabled'] === 'boolean'
                    ? data['enabled']
                    : typeof data['remoteSteerable'] === 'boolean'
                      ? data['remoteSteerable']
                      : null;
            log('INFO', `[session-lifecycle] remote_steerable_changed: ${enabled == null ? 'unknown' : enabled}`);
            emit(EMITTER_SESSION_REMOTE_STEERABLE_CHANGED, { enabled, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── session.schedule_created / session.schedule_cancelled ───────
        onSessionEvent(session, SESSION_EVENTS.SESSION_SCHEDULE_CREATED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const scheduleId =
                typeof data['scheduleId'] === 'string'
                    ? data['scheduleId']
                    : typeof data['id'] === 'string'
                      ? data['id']
                      : null;
            const title =
                typeof data['title'] === 'string'
                    ? data['title']
                    : typeof data['name'] === 'string'
                      ? data['name']
                      : null;
            log('INFO', `[session-lifecycle] schedule_created: ${scheduleId ?? title ?? '(sem id)'}`);
            emit(EMITTER_SESSION_SCHEDULE_CREATED, { scheduleId, title, data, ts: evt?.timestamp ?? Date.now() });
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_SCHEDULE_CANCELLED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const scheduleId =
                typeof data['scheduleId'] === 'string'
                    ? data['scheduleId']
                    : typeof data['id'] === 'string'
                      ? data['id']
                      : null;
            const title =
                typeof data['title'] === 'string'
                    ? data['title']
                    : typeof data['name'] === 'string'
                      ? data['name']
                      : null;
            log('INFO', `[session-lifecycle] schedule_cancelled: ${scheduleId ?? title ?? '(sem id)'}`);
            emit(EMITTER_SESSION_SCHEDULE_CANCELLED, { scheduleId, title, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── extension_context / new_inbox_message ───────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXTENSION_CONTEXT, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const extensionName =
                typeof data['extensionName'] === 'string'
                    ? data['extensionName']
                    : typeof data['extension'] === 'string'
                      ? data['extension']
                      : null;
            log('INFO', `[session-lifecycle] extension_context: ${extensionName ?? '(sem extensão)'}`);
            emit(EMITTER_EXTENSION_CONTEXT, { extensionName, data, ts: evt?.timestamp ?? Date.now() });
        }),
        onSessionEvent(session, SESSION_EVENTS.NEW_INBOX_MESSAGE, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const message =
                typeof data['message'] === 'string'
                    ? data['message']
                    : typeof data['subject'] === 'string'
                      ? data['subject']
                      : null;
            log('INFO', `[session-lifecycle] new_inbox_message: ${message ?? '(sem mensagem)'}`);
            emit(EMITTER_NEW_INBOX_MESSAGE, { message, data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
