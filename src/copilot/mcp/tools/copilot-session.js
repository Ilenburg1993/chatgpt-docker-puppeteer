// @ts-check
/**
 * Read-only MCP tools for Copilot SDK/LLM-B session state.
 *
 * @module copilot/mcp/tools/copilot-session
 */

import { errorResult, okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';
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
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const copilotSessionTools = [
    {
        name: 'copilot_sessions_list',
        title: 'List Copilot sessions',
        description: 'List active Copilot SDK/LLM-B sessions known in this process without starting a new session.',
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional()['describe']('Maximum sessions to return. Default: 50.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ limit }) => {
            const max = typeof limit === 'number' ? limit : 50;
            const sessions = listActiveSdkSessions().slice(0, max).map(publicSessionSummary);
            return okResult({
                success: true,
                count: sessions.length,
                sessions,
            });
        },
    },
    {
        name: 'copilot_session_get',
        title: 'Get Copilot session',
        description: 'Return read-only metadata for one active Copilot SDK/LLM-B session by id.',
        inputSchema: {
            sessionId: z.string().min(1)['describe']('Copilot SDK session id.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ sessionId }) => {
            const entry = getActiveSdkSession(sessionId);
            if (!entry) {
                return errorResult('Copilot session not found.', {
                    code: 'ERR_COPILOT_SESSION_NOT_FOUND',
                    hint: 'Call copilot_sessions_list first and pass an active sessionId.',
                    sessionId,
                });
            }
            return okResult({
                success: true,
                session: publicSessionSummary({ sessionId, ...entry }),
            });
        },
    },
];
