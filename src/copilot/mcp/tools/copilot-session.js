// @ts-check
/**
 * Read-only MCP tools for Copilot SDK/LLM-B session state.
 *
 * @module copilot/mcp/tools/copilot-session
 */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { errorResult, okResult } from '#copilot/mcp/public/protocol/tools';
import { getActiveSdkSession, listActiveSdkSessions } from '#copilot/sdk/session';
import { z } from 'zod';

/**
 * @param {ReturnType<typeof listActiveSdkSessions>[number]} entry
 * @returns {{ sessionId: string; model: string; createdAt: number; messagesCount: number }}
 */
function publicSessionSummary(entry) {
    return {
        sessionId: entry.sessionId,
        model: entry.model,
        createdAt: entry.createdAt,
        messagesCount: entry.messagesCount,
    };
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const copilotSessionTools = [
    defineMcpRawTool({
        name: 'copilot_sessions',
        title: 'Copilot sessions',
        description:
            'Administrative process-global inspection of active Copilot SDK/LLM-B sessions. Sessions can originate outside MCP, so this surface intentionally does not claim caller ownership.',
        inputSchema: {
            action: z.enum(['list', 'get'])['describe']('Read projection: list or get.'),
            limit: z.number().int().min(1).max(100).optional()['describe']('action=list only: maximum sessions. Default: 50.'),
            sessionId: z.string().min(1).optional()['describe']('action=get only: active Copilot SDK session id.'),
        },

        handler: async ({ action, limit, sessionId }) => {
            if (action === 'list') {
                if (sessionId !== undefined) {
                    return errorResult('sessionId is valid only with action=get.', {
                        code: 'ERR_COPILOT_SESSIONS_INACTIVE_FIELDS',
                        action,
                    });
                }
                const max = typeof limit === 'number' ? limit : 50;
                const sessions = listActiveSdkSessions().slice(0, max).map(publicSessionSummary);
                return okResult({ success: true, count: sessions.length, sessions });
            }
            if (limit !== undefined) {
                return errorResult('limit is valid only with action=list.', {
                    code: 'ERR_COPILOT_SESSIONS_INACTIVE_FIELDS',
                    action,
                });
            }
            if (sessionId === undefined) {
                return errorResult('action=get requires sessionId.', {
                    code: 'ERR_COPILOT_SESSION_ID_REQUIRED',
                    hint: 'Call copilot_sessions action=list first to discover active ids.',
                });
            }
            const entry = getActiveSdkSession(sessionId);
            if (!entry) {
                return errorResult('Copilot session not found.', {
                    code: 'ERR_COPILOT_SESSION_NOT_FOUND',
                    hint: 'Call copilot_sessions action=list first and pass an active sessionId.',
                    sessionId,
                });
            }
            return okResult({
                success: true,
                session: publicSessionSummary({ sessionId, ...entry }),
            });
        },
    }),
];
