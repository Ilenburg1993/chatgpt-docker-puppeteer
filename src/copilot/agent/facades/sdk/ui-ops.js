// @ts-check
/**
 * src/copilot/agent/facades/sdk/ui-ops.js
 *
 * Sub-facade: UI elicitation, confirmações, inputs, permissões pendentes e tool calls.
 *
 * @module copilot/agent/facades/sdk/ui-ops
 */

import {
    commandsHandlePending,
    permissionsHandlePending,
    permissionsListPending,
    permissionsResetSessionApprovals,
    toolsHandlePendingCall,
    uiElicitation,
} from '#copilot/sdk/rpc';
import { mcpOauthLogin } from '#copilot/sdk/rpc/experimental';
import {
    getSessionCapabilities,
    isSessionUiElicitationAvailable,
    normalizeElicitationResultWithSchema,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
} from '#copilot/sdk/session';
import { getSdkElicitationRef, requireSession } from './core/index.js';

/**
 * @param {unknown} value
 * @param {unknown} schema
 * @param {{ context?: string }} [options]
 */
export function normalizeAgentSdkElicitationResult(value, schema, options) {
    return normalizeElicitationResultWithSchema(
        value,
        /** @type {Parameters<typeof normalizeElicitationResultWithSchema>[1]} */ (schema),
        options,
    );
}

/**
 * @param {unknown} ctx
 * @param {string} message
 * @param {object} requestedSchema
 * @returns {Promise<Awaited<ReturnType<typeof uiElicitation>>>}
 */
export async function requestSdkElicitation(ctx, message, requestedSchema) {
    const session = requireSession(ctx, 'requestSdkElicitation');
    if (session.ui || session.capabilities?.ui?.elicitation) {
        return sessionUiElicitation(session, {
            message,
            requestedSchema: /** @type {import('#copilot/sdk/types').ElicitationSchema} */ (
                /** @type {unknown} */ (requestedSchema)
            ),
        });
    }
    return uiElicitation(session, message, requestedSchema);
}

/**
 * @param {unknown} ctx
 * @returns {import('#copilot/sdk/types').SessionCapabilities}
 */
export function getSdkSessionCapabilities(ctx) {
    return getSessionCapabilities(requireSession(ctx, 'getSdkSessionCapabilities'));
}

/**
 * @param {unknown} ctx
 * @returns {boolean}
 */
export function isSdkSessionUiElicitationAvailable(ctx) {
    return isSessionUiElicitationAvailable(requireSession(ctx, 'isSdkSessionUiElicitationAvailable'));
}

/**
 * @param {unknown} ctx
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmSdkSessionUi(ctx, message) {
    return sessionUiConfirm(requireSession(ctx, 'confirmSdkSessionUi'), message);
}

/**
 * @param {unknown} ctx
 * @param {string} message
 * @param {string[]} options
 * @returns {Promise<string | null>}
 */
export async function selectSdkSessionUi(ctx, message, options) {
    return sessionUiSelect(requireSession(ctx, 'selectSdkSessionUi'), message, options);
}

/**
 * @param {unknown} ctx
 * @param {string} message
 * @param {import('#copilot/sdk/types').InputOptions} [options]
 * @returns {Promise<string | null>}
 */
export async function inputSdkSessionUi(ctx, message, options) {
    return sessionUiInput(requireSession(ctx, 'inputSdkSessionUi'), message, options);
}

/**
 * @param {unknown} ctx
 * @param {string} [sessionId]
 * @returns {any[]}
 */
export function listPendingSdkElicitations(ctx, sessionId) {
    return getSdkElicitationRef(ctx)?.listPending?.({ ...(sessionId ? { sessionId } : {}) }) ?? [];
}

/**
 * @param {unknown} ctx
 * @param {string} id
 * @returns {any}
 */
export function getPendingSdkElicitation(ctx, id) {
    return getSdkElicitationRef(ctx)?.getPending?.(id) ?? null;
}

/**
 * @param {unknown} ctx
 * @param {string} id
 * @param {import('#copilot/sdk/types').ElicitationResult} result
 * @returns {boolean}
 */
export function resolvePendingSdkElicitation(ctx, id, result) {
    return getSdkElicitationRef(ctx)?.resolvePending?.(id, result) ?? false;
}

/**
 * @param {unknown} ctx
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result
 * @returns {Promise<Awaited<ReturnType<typeof permissionsHandlePending>>>}
 */
export async function handleSdkPendingPermission(ctx, requestId, result) {
    return permissionsHandlePending(requireSession(ctx, 'handleSdkPendingPermission'), requestId, result);
}

/**
 * Lista permissões pendentes via superfície RPC da sessão, quando disponível.
 *
 * @param {unknown} ctx
 * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
 */
export async function listPendingSdkPermissions(ctx) {
    return permissionsListPending(requireSession(ctx, 'listPendingSdkPermissions'));
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof permissionsResetSessionApprovals>>>}
 */
export async function resetSdkSessionApprovals(ctx) {
    return permissionsResetSessionApprovals(requireSession(ctx, 'resetSdkSessionApprovals'));
}

/**
 * @param {unknown} ctx
 * @param {string} serverName
 * @returns {Promise<Awaited<ReturnType<typeof mcpOauthLogin>>>}
 */
export async function loginSdkMcpOauth(ctx, serverName) {
    return mcpOauthLogin(requireSession(ctx, 'loginSdkMcpOauth'), serverName);
}

/**
 * @param {unknown} ctx
 * @param {string} requestId
 * @param {{ result?: string | { textResultForLlm: string; resultType?: string; error?: string }; error?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof toolsHandlePendingCall>>>}
 */
export async function handleSdkPendingToolCall(ctx, requestId, options) {
    return toolsHandlePendingCall(requireSession(ctx, 'handleSdkPendingToolCall'), requestId, options);
}

/**
 * @param {unknown} ctx
 * @param {string} requestId
 * @param {{ error?: string }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof commandsHandlePending>>>}
 */
export async function handleSdkPendingCommand(ctx, requestId, options) {
    return commandsHandlePending(requireSession(ctx, 'handleSdkPendingCommand'), requestId, options);
}
