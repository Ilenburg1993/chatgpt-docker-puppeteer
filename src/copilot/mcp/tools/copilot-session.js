// @ts-check
/**
 * Read-only MCP tools for Copilot SDK/LLM-B session state.
 *
 * @module copilot/mcp/tools/copilot-session
 */

import { getActiveSdkSession, listActiveSdkSessions } from '#copilot/sdk/session';
import { z } from 'zod';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { errorResult, okResult } from '../control-plane/result.js';

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
            limit: z.number().int().min(1).max(100).optional().describe('Maximum sessions to return. Default: 50.'),
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
            sessionId: z.string().min(1).describe('Copilot SDK session id.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ sessionId }) => {
            const entry = getActiveSdkSession(sessionId);
            if (!entry) return errorResult('Copilot session not found.', { sessionId });
            return okResult({
                success: true,
                session: publicSessionSummary({ sessionId, ...entry }),
            });
        },
    },
];
