// @ts-check
/**
 * @file Gateway: sdk-session.
 *
 *   Wraps all SDK session operations (mode, plan, models, tools, quota, workspace files, compaction, elicitations and UI
 *   interactions). Isolates `presentation/runtime/index.js`.
 */

import {
    classifyPermissionDecision,
    classifyUserInputQuestionKind,
    getPendingStructuredUserInputCount,
    hasPendingStructuredUserInputRequests,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
} from '#copilot/sdk/session';
import {
    compactAgentSdkSession,
    confirmAgentSdkSessionUi,
    createAgentSdkWorkspaceFile,
    deleteAgentSdkPlan,
    getAgentSdkPendingElicitation,
    getAgentSdkQuota,
    getAgentSdkSessionCapabilities,
    getAgentSdkSessionMode,
    handleAgentSdkPendingPermission,
    inputAgentSdkSessionUi,
    isAgentSdkSessionUiElicitationAvailable,
    listAgentSdkModels,
    listAgentSdkPendingElicitations,
    listAgentSdkPendingPermissions,
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
} from '../../../presentation/runtime/index.js';

// ---------------------------------------------------------------------------
// Vanilla session helpers exposed as terminal-owned semantics
// ---------------------------------------------------------------------------

/**
 * @returns {number}
 */
export function getTerminalPendingStructuredUserInputCount() {
    return getPendingStructuredUserInputCount();
}

/**
 * @returns {boolean}
 */
export function hasTerminalPendingStructuredUserInputRequests() {
    return hasPendingStructuredUserInputRequests();
}

/**
 * @param {string | null | undefined} kind
 * @param {boolean | null | undefined} granted
 * @returns {ReturnType<typeof classifyPermissionDecision>}
 */
export function classifyTerminalPermissionDecision(kind, granted) {
    return classifyPermissionDecision(kind, granted);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeElicitationPendingEvent>}
 */
export function normalizeTerminalElicitationPendingEvent(evt) {
    return normalizeElicitationPendingEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeElicitationCompletedEvent>}
 */
export function normalizeTerminalElicitationCompletedEvent(evt) {
    return normalizeElicitationCompletedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizePermissionRequestedEvent>}
 */
export function normalizeTerminalPermissionRequestedEvent(evt) {
    return normalizePermissionRequestedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizePermissionCompletedEvent>}
 */
export function normalizeTerminalPermissionCompletedEvent(evt) {
    return normalizePermissionCompletedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeUserInputRequestedEvent>}
 */
export function normalizeTerminalUserInputRequestedEvent(evt) {
    return normalizeUserInputRequestedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeUserInputCompletedEvent>}
 */
export function normalizeTerminalUserInputCompletedEvent(evt) {
    return normalizeUserInputCompletedEvent(evt);
}

/**
 * @param {string} question
 * @returns {ReturnType<typeof classifyUserInputQuestionKind>}
 */
export function classifyTerminalUserInputQuestionKind(question) {
    return classifyUserInputQuestionKind(question);
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkModeResult>}
 */
export async function getTerminalSdkSessionMode(runtimeId) {
    return getAgentSdkSessionMode(runtimeId);
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkModeResult>}
 */
export async function setTerminalSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionMode(mode, runtimeId);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkPlanReadResult>}
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
 * @returns {import('../../../presentation/contracts/index.js').RuntimeSessionCapabilities}
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
 * @param {import('../../../presentation/contracts/index.js').RuntimeInputOptions | undefined} [options]
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
 * @param {import('../../../presentation/contracts/index.js').RuntimeElicitationResult} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function resolveTerminalSdkPendingElicitation(id, result, runtimeId) {
    return resolveAgentSdkPendingElicitation(id, result, runtimeId);
}

/**
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function handleTerminalSdkPendingPermission(requestId, result, runtimeId) {
    return handleAgentSdkPendingPermission(requestId, result, runtimeId);
}

/**
 * Lista permissões pendentes via RPC quando disponível na sessão SDK.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
 */
export async function listTerminalSdkPendingPermissions(runtimeId) {
    return listAgentSdkPendingPermissions(runtimeId);
}
