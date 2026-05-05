// @ts-check
/**
 * @file Gateway: sdk-session.
 *
 *   Wraps all SDK session operations (mode, plan, models, tools, quota, workspace files, compaction, elicitations and UI
 *   interactions). Isolates `presentation/runtime-sdk-session.js`.
 */

import {
    compactAgentSdkSession,
    confirmAgentSdkSessionUi,
    createAgentSdkWorkspaceFile,
    deleteAgentSdkPlan,
    getAgentSdkPendingElicitation,
    getAgentSdkQuota,
    getAgentSdkSessionCapabilities,
    getAgentSdkSessionMode,
    inputAgentSdkSessionUi,
    isAgentSdkSessionUiElicitationAvailable,
    listAgentSdkModels,
    listAgentSdkPendingElicitations,
    listAgentSdkTools,
    listAgentSdkWorkspaceFiles,
    readAgentSdkPlan,
    readAgentSdkSystemPromptProjection,
    readAgentSdkWorkspaceFile,
    requestAgentSdkElicitation,
    resolveAgentSdkPendingElicitation,
    selectAgentSdkSessionUi,
    setAgentSdkSessionMode,
    updateAgentSdkPlan,
} from '../../../presentation/runtime-sdk-session.js';

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkModeResult>}
 */
export async function getTerminalSdkSessionMode(runtimeId) {
    return getAgentSdkSessionMode(runtimeId);
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkModeResult>}
 */
export async function setTerminalSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionMode(mode, runtimeId);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function readTerminalSdkPlan(runtimeId) {
    return readAgentSdkPlan(runtimeId);
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateTerminalSdkPlan(content, runtimeId) {
    return updateAgentSdkPlan(content, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteTerminalSdkPlan(runtimeId) {
    return deleteAgentSdkPlan(runtimeId);
}

// ---------------------------------------------------------------------------
// Models, tools, quota
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkModels(runtimeId) {
    return listAgentSdkModels(runtimeId);
}

/**
 * @param {{ model?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkTools(options, runtimeId) {
    return listAgentSdkTools(options, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getTerminalSdkQuota(runtimeId) {
    return getAgentSdkQuota(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<Awaited<ReturnType<typeof readAgentSdkSystemPromptProjection>>>}
 */
export async function readTerminalSdkSystemPromptProjection(runtimeId) {
    return readAgentSdkSystemPromptProjection(runtimeId);
}

// ---------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkWorkspaceFiles(runtimeId) {
    return listAgentSdkWorkspaceFiles(runtimeId);
}

/**
 * @param {string} path
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readTerminalSdkWorkspaceFile(path, runtimeId) {
    return readAgentSdkWorkspaceFile(path, runtimeId);
}

/**
 * @param {string} path
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function createTerminalSdkWorkspaceFile(path, content, runtimeId) {
    return createAgentSdkWorkspaceFile(path, content, runtimeId);
}

// ---------------------------------------------------------------------------
// Compaction & elicitation
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function compactTerminalSdkSession(runtimeId) {
    return compactAgentSdkSession(runtimeId);
}

/**
 * @param {string} message
 * @param {object} requestedSchema
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function requestTerminalSdkElicitation(message, requestedSchema, runtimeId) {
    return requestAgentSdkElicitation(message, requestedSchema, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../../../presentation/types.js').RuntimeSessionCapabilities}
 */
export function getTerminalSdkSessionCapabilities(runtimeId) {
    return getAgentSdkSessionCapabilities(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function isTerminalSdkSessionUiElicitationAvailable(runtimeId) {
    return isAgentSdkSessionUiElicitationAvailable(runtimeId);
}

// ---------------------------------------------------------------------------
// UI interactions
// ---------------------------------------------------------------------------

/**
 * @param {string} message
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<boolean>}
 */
export async function confirmTerminalSdkSessionUi(message, runtimeId) {
    return confirmAgentSdkSessionUi(message, runtimeId);
}

/**
 * @param {string} message
 * @param {string[]} options
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function selectTerminalSdkSessionUi(message, options, runtimeId) {
    return selectAgentSdkSessionUi(message, options, runtimeId);
}

/**
 * @param {string} message
 * @param {import('../../../presentation/types.js').RuntimeInputOptions | undefined} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function inputTerminalSdkSessionUi(message, options, runtimeId) {
    return inputAgentSdkSessionUi(message, options, runtimeId);
}

// ---------------------------------------------------------------------------
// Pending elicitations
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @param {{ sessionId?: string }} [options]
 * @returns {ReturnType<typeof listAgentSdkPendingElicitations>}
 */
export function listTerminalSdkPendingElicitations(runtimeId, options = {}) {
    return listAgentSdkPendingElicitations(runtimeId, options);
}

/**
 * @param {string} id
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof getAgentSdkPendingElicitation>}
 */
export function getTerminalSdkPendingElicitation(id, runtimeId) {
    return getAgentSdkPendingElicitation(id, runtimeId);
}

/**
 * @param {string} id
 * @param {import('../../../presentation/types.js').RuntimeElicitationResult} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function resolveTerminalSdkPendingElicitation(id, result, runtimeId) {
    return resolveAgentSdkPendingElicitation(id, result, runtimeId);
}
