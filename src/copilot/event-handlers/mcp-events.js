// @ts-check
/**
 * @module copilot/event-handlers/mcp-events
 * @see EventBus
 * Faixa B2: Handlers dedicados para MCP server status e OAuth events.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/events/sdk-events';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireMcpEvents(session, { emit }) {
    return [
        // ── session.mcp_server_status_changed ────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SESSION_MCP_SERVER_STATUS_CHANGED, (evt) => {
            const { serverName, status } = evt?.data ?? {};
            const statusStr = /** @type {string} */ (status ?? 'unknown');
            const serverStr = /** @type {string} */ (serverName ?? 'unknown');

            if (statusStr === 'failed') {
                log('WARN', `[mcp-events] MCP server failed: ${serverStr}`);
            } else if (statusStr === 'connected') {
                log('INFO', `[mcp-events] MCP server connected: ${serverStr}`);
            } else {
                log('DEBUG', `[mcp-events] MCP server status: ${serverStr} → ${statusStr}`);
            }
            emit('mcp.server.status_changed', {
                serverName: serverStr,
                status: statusStr,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── mcp.oauth_required ───────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.MCP_OAUTH_REQUIRED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const serverName = /** @type {string | undefined} */ (data['serverName']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('WARN', `[mcp-events] OAuth required: server=${serverName ?? '?'} requestId=${requestId ?? '?'}`);
            emit('mcp.oauth.required', { serverName, requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── mcp.oauth_completed ──────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.MCP_OAUTH_COMPLETED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const requestId = data['requestId'];
            log('INFO', `[mcp-events] OAuth completed: requestId=${requestId ?? '?'}`);
            emit('mcp.oauth.completed', { requestId, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
