// @ts-check
/**
 * src/copilot/agent/facades/sdk/sessions.js
 *
 * Sub-facade: CRUD de sessões SDK via client e operações ctx-wrapped de sessão.
 *
 * @module copilot/agent/facades/sdk/sessions
 */

import { toError } from '#copilot/core';
import {
    createSession,
    deleteSession,
    getConfiguredSessionFsHandler,
    listSessions,
    resumeOrCreate,
} from '#copilot/sdk/session';
import { log } from '../../ports/index.js';
import { requireClient } from './core/index.js';

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
 * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
 */
export async function listAgentSdkSessionsByClient(client, filter) {
    return listSessions(client, filter);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {(string | null | undefined)[]} [seedIds]
 * @returns {Promise<string[]>}
 */
export async function listAgentSdkProtectedSessionIdsByClient(client, seedIds = []) {
    /** @type {Set<string>} */
    const ids = new Set();
    for (const id of seedIds) {
        if (typeof id === 'string' && id.length > 0) {
            ids.add(id);
        }
    }

    try {
        const foregroundSessionId = await client.getForegroundSessionId?.();
        if (typeof foregroundSessionId === 'string' && foregroundSessionId.length > 0) {
            ids.add(foregroundSessionId);
        }
    } catch (error) {
        log(
            'DEBUG',
            `[sdk/sessions] getForegroundSessionId indisponível para cleanup defensivo: ${toError(error).message}`,
        );
    }

    try {
        const lastSessionId = await client.getLastSessionId?.();
        if (typeof lastSessionId === 'string' && lastSessionId.length > 0) {
            ids.add(lastSessionId);
        }
    } catch (error) {
        log('DEBUG', `[sdk/sessions] getLastSessionId indisponível para cleanup defensivo: ${toError(error).message}`);
    }

    return [...ids];
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteAgentSdkSessionByClient(client, sessionId) {
    await deleteSession(client, sessionId);
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {Record<string, unknown>} options
 * @returns {Promise<Awaited<ReturnType<typeof createSession>>>}
 */
export async function createAgentSdkSessionByClient(client, options) {
    return createSession(client, options);
}

/**
 * @returns {import('#copilot/sdk/types').CreateSessionFsHandler | undefined}
 */
export function getAgentConfiguredSessionFsHandler() {
    return getConfiguredSessionFsHandler();
}

/**
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {string | null | undefined} sessionId
 * @param {Record<string, unknown>} options
 * @returns {Promise<Awaited<ReturnType<typeof resumeOrCreate>>>}
 */
export async function resumeOrCreateAgentSdkSession(client, sessionId, options) {
    return resumeOrCreate(client, sessionId ?? null, options);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<string | undefined>}
 */
export async function getLastSdkSessionId(ctx) {
    return requireClient(ctx, 'getLastSdkSessionId').getLastSessionId();
}

/**
 * @param {unknown} ctx
 * @returns {Promise<string | undefined>}
 */
export async function getForegroundSdkSessionId(ctx) {
    return requireClient(ctx, 'getForegroundSdkSessionId').getForegroundSessionId();
}

/**
 * @param {unknown} ctx
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function setForegroundSdkSessionId(ctx, sessionId) {
    await requireClient(ctx, 'setForegroundSdkSessionId').setForegroundSessionId(sessionId);
}

/**
 * @param {unknown} ctx
 * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
 * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
 */
export async function listSdkSessions(ctx, filter) {
    return requireClient(ctx, 'listSdkSessions').listSessions(filter);
}

/**
 * Remove permanentemente uma sessão persistida conhecida pelo client SDK atual.
 *
 * A proteção para não apagar a sessão viva pertence ao cockpit terminal, que tem o inventário operacional completo.
 *
 * @param {unknown} ctx
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteSdkSession(ctx, sessionId) {
    await requireClient(ctx, 'deleteSdkSession').deleteSession(sessionId);
}
