// @ts-check
/**
 * src/copilot/observability/collectors/session-handlers.js
 *
 * Handlers de eventos de sessão do EventCollector.
 *
 * @module copilot/observability/collectors/session-handlers
 * @see EventBus
 */

import { SESSION_EVENTS as SE } from '#copilot/events';
import { onSessionEvent } from '../../sdk/session/events.js';
import { normalizeToolsUpdatedEvent } from '../../sdk/session/session-events.js';
import { log } from '../logger.js';

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

/** @typedef {import('./context.js').CollectorContext} CollectorContext */

/**
 * @typedef {{ type: string; ts: unknown; data?: unknown }} CompactionEntry
 */

/**
 * Registra compaction entry no histórico global.
 *
 * @type {((sessionId: string, entry: CompactionEntry) => void) | undefined}
 */
let _recordCompaction;

/**
 * Injeta a função _recordCompaction (definida em event-collector.js).
 *
 * @param {(sessionId: string, entry: CompactionEntry) => void} fn
 */
export function injectRecordCompaction(fn) {
    _recordCompaction = fn;
}

/**
 * Registra handlers de session.* na sessão SDK.
 *
 * @param {CollectorContext} ctx
 * @returns {(() => void)[]}
 */
export function attachSessionHandlers(ctx) {
    const { session, sessionId, metrics, errorTracker, persist, persistSet, persistEvent } = ctx;
    /** @type {(() => void)[]} */
    const unsubs = [];

    // ── session.error ─────────────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_ERROR, (event) => {
            const errorType = /** @type {string | undefined} */ (event.data?.errorType);
            const message = normalizeSdkMessage(event.data?.message);
            errorTracker?.trackError(new Error(message ?? String(errorType)), {
                source: 'sdk:session.error',
                sessionId,
                metadata: { errorType },
            });
            metrics?.recordSessionError();
            if (persist && persistSet.has('session.error')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, errorType, message });
            }
            log('WARN', `[event-collector] session.error: type=${errorType} msg=${message} session=${sessionId}`);
        }),
    );

    // ── session.usage_info ────────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_USAGE_INFO, (event) => {
            if (persist && persistSet.has('session.usage_info')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );

    // ── session.truncation ────────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_TRUNCATION, (event) => {
            if (persist && persistSet.has('session.truncation')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
            log('INFO', `[event-collector] session.truncation: session=${sessionId}`);
        }),
    );

    // ── session.compaction_start / complete ───────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_COMPACTION_START, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp });
            _recordCompaction?.(sessionId, { type: event.type, ts: event.timestamp });
            log('INFO', `[event-collector] compaction_start session=${sessionId}`);
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_COMPACTION_COMPLETE, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            _recordCompaction?.(sessionId, { type: event.type, ts: event.timestamp, data: event.data });
            log('INFO', `[event-collector] compaction_complete session=${sessionId}`);
        }),
    );

    // ── session.tools_updated / mcp_servers_loaded ────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_TOOLS_UPDATED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            const normalized = normalizeToolsUpdatedEvent(event);
            const namespaced = normalized.tools.filter((tool) => tool.namespacedName !== null).length;
            const withSchema = normalized.tools.filter((tool) => tool.hasParameters === true).length;
            const withInstructions = normalized.tools.filter((tool) => tool.hasInstructions === true).length;
            log(
                'DEBUG',
                `[event-collector] session.tools_updated session=${sessionId} count=${normalized.count} namespaced=${namespaced} schema=${withSchema} instructions=${withInstructions}`,
            );
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_MCP_SERVERS_LOADED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('DEBUG', `[event-collector] session.mcp_servers_loaded session=${sessionId}`);
        }),
    );

    // ── session.mode_changed / model_change / plan_changed ────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_MODE_CHANGED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('INFO', `[event-collector] session.mode_changed session=${sessionId}`);
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_MODEL_CHANGE, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('INFO', `[event-collector] session.model_change session=${sessionId}`);
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_PLAN_CHANGED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );

    // ── session.background_tasks_changed ─────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_BACKGROUND_TASKS_CHANGED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );

    // ── session.warning / idle / shutdown ─────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_WARNING, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('WARN', `[event-collector] session.warning session=${sessionId}`);
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_IDLE, (event) => {
            if (persist && persistSet.has('session.idle'))
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('DEBUG', `[event-collector] session.idle session=${sessionId}`);
        }),
    );
    unsubs.push(
        onSessionEvent(session, SE.SESSION_SHUTDOWN, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('INFO', `[event-collector] session.shutdown session=${sessionId}`);
        }),
    );

    // ── session.task_complete ─────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_TASK_COMPLETE, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('INFO', `[event-collector] session.task_complete session=${sessionId}`);
        }),
    );

    // ── session.start / resume — Fase AP ─────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_START, (event) => {
            const { sessionId: sdkSessionId, copilotVersion, selectedModel, reasoningEffort, context } = event.data;
            metrics?.recordSessionStart();
            metrics?.recordCounter(`model.${selectedModel ?? 'unknown'}`);
            if (persist && persistSet.has('session.start')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    sdkSessionId,
                    copilotVersion,
                    selectedModel,
                    reasoningEffort,
                    context,
                });
            }
            log(
                'INFO',
                `[event-collector] session.start model=${selectedModel ?? 'n/a'} branch=${context?.branch ?? 'n/a'} session=${sessionId}`,
            );
        }),
    );

    unsubs.push(
        onSessionEvent(session, SE.SESSION_RESUME, (event) => {
            const { eventCount, selectedModel, reasoningEffort, context, alreadyInUse } = event.data;
            metrics?.recordCounter('session.resumed');
            if (alreadyInUse) metrics?.recordCounter('session.already_in_use');
            if (persist && persistSet.has('session.resume')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    eventCount,
                    selectedModel,
                    reasoningEffort,
                    alreadyInUse,
                    context,
                });
            }
            log(
                'INFO',
                `[event-collector] session.resume eventCount=${eventCount ?? 0} alreadyInUse=${alreadyInUse ?? false} session=${sessionId}`,
            );
        }),
    );

    // ── session.context_changed / handoff — Fase AT ──────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_CONTEXT_CHANGED, (event) => {
            const { branch, repository, cwd } = event.data;
            if (persist && persistSet.has('session.context_changed')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    branch: branch ?? null,
                    repository: repository ?? null,
                    cwd: cwd ?? null,
                });
            }
            log('INFO', `[event-collector] context_changed branch=${branch ?? 'n/a'} session=${sessionId}`);
        }),
    );

    unsubs.push(
        onSessionEvent(session, SE.SESSION_HANDOFF, (event) => {
            const { handoffTime, sourceType, summary, remoteSessionId } = event.data;
            metrics?.recordCounter('session.handoff');
            metrics?.recordCounter(`session.handoff.source.${sourceType ?? 'unknown'}`);
            if (persist && persistSet.has('session.handoff')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    handoffTime,
                    sourceType,
                    summary: summary ?? null,
                    remoteSessionId: remoteSessionId ?? null,
                });
            }
            log('INFO', `[event-collector] session.handoff source=${sourceType} session=${sessionId}`);
        }),
    );

    // ── session.skills_loaded / extensions_loaded — Fase AU ──────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_SKILLS_LOADED, (event) => {
            const { skills } = event.data;
            const enabledCount = skills.filter((/** @type {{ enabled?: boolean }} */ s) => s.enabled).length;
            metrics?.recordCounter('session.skills_loaded');
            metrics?.recordCounter('skills.enabled', enabledCount);
            if (persist && persistSet.has('session.skills_loaded')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    totalSkills: skills.length,
                    enabledSkills: enabledCount,
                    skills: skills.map((/** @type {{ name?: string; enabled?: boolean; source?: string }} */ s) => ({
                        name: s.name,
                        enabled: s.enabled,
                        source: s.source,
                    })),
                });
            }
            log(
                'INFO',
                `[event-collector] skills_loaded: ${enabledCount}/${skills.length} enabled session=${sessionId}`,
            );
        }),
    );

    unsubs.push(
        onSessionEvent(session, SE.SESSION_EXTENSIONS_LOADED, (event) => {
            const { extensions } = event.data;
            const runningCount = extensions.filter(
                (/** @type {{ status?: string }} */ e) => e.status === 'running',
            ).length;
            if (persist && persistSet.has('session.extensions_loaded')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    total: extensions.length,
                    running: runningCount,
                    extensions: extensions.map((/** @type {{ id?: string; status?: string }} */ e) => ({
                        id: e.id,
                        status: e.status,
                    })),
                });
            }
            log(
                'INFO',
                `[event-collector] extensions_loaded: ${runningCount}/${extensions.length} running session=${sessionId}`,
            );
        }),
    );

    // ── session.mcp_server_status_changed — Fase AV ──────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_MCP_SERVER_STATUS_CHANGED, (event) => {
            const { serverName, status } = event.data;
            metrics?.recordCounter(`mcp.server.status.${status}`);
            if (status === 'failed') {
                metrics?.recordCounter('mcp.server.failed');
                log('WARN', `[event-collector] MCP server failed: ${serverName} session=${sessionId}`);
            } else if (status === 'connected') {
                metrics?.recordCounter('mcp.server.connected');
                log('INFO', `[event-collector] MCP server connected: ${serverName} session=${sessionId}`);
            }
            if (persist && persistSet.has('session.mcp_server_status_changed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName, status });
            }
        }),
    );

    // ── session.title_changed ────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_TITLE_CHANGED, (event) => {
            const { title } = event.data;
            metrics?.recordCounter('session.title_changed');
            if (persist) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, title });
            }
            log('INFO', `[event-collector] session.title_changed title="${title ?? ''}" session=${sessionId}`);
        }),
    );

    // ── session.workspace_file_changed ───────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_WORKSPACE_FILE_CHANGED, (event) => {
            const { path, operation } = event.data;
            metrics?.recordCounter(`session.workspace_file_changed.${operation ?? 'unknown'}`);
            if (persist && persistSet.has('session.workspace_file_changed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, path, operation });
            }
            log('DEBUG', `[event-collector] session.workspace_file_changed op=${operation ?? '?'} path=${path ?? '?'}`);
        }),
    );

    // ── session.snapshot_rewind ──────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_SNAPSHOT_REWIND, (event) => {
            metrics?.recordCounter('session.snapshot_rewind');
            const removed = /** @type {number | undefined} */ (event.data?.eventsRemoved);
            log(
                'INFO',
                `[event-collector] session.snapshot_rewind: eventosRemovidos=${removed ?? '?'}, alvo=${event.data?.upToEventId ?? '?'}`,
            );
            if (persist && persistSet.has('session.snapshot_rewind')) {
                persistEvent({
                    type: 'session.snapshot_rewind',
                    sessionId,
                    ts: event.timestamp,
                    upToEventId: event.data?.upToEventId,
                    eventsRemoved: removed,
                });
            }
        }),
    );

    // ── session.info ─────────────────────────────────────────────────────
    unsubs.push(
        onSessionEvent(session, SE.SESSION_INFO, (event) => {
            metrics?.recordCounter('session.info');
            const infoType = /** @type {string | undefined} */ (event.data?.infoType);
            const logLevel = infoType === 'authentication' || infoType === 'model' ? 'WARN' : 'DEBUG';
            log(logLevel, `[event-collector] session.info[${infoType ?? '?'}]: ${event.data?.message ?? ''}`);
            if (persist && persistSet.has('session.info')) {
                persistEvent({
                    type: 'session.info',
                    sessionId,
                    ts: event.timestamp,
                    infoType,
                    message: event.data?.message,
                    url: event.data?.url,
                });
            }
        }),
    );

    return unsubs;
}
