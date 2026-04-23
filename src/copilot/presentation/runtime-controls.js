// @ts-check
/**
 * @module copilot/presentation/runtime-controls
 * @file Façade compartilhada de mutações/controles do runtime default do agent.
 *
 *   Esta camada concentra operações mutáveis e side-effects de borda (dialog loop, handoff, snapshots e ajustes de
 *   configuração) para que `terminal/`, `server/` e `presentation/*` não importem helpers soltos de `#copilot/agent`
 *   nem reabram o runtime default diretamente em cada arquivo.
 */

import {
    createRuntimeSnapshot,
    getRuntimeHandoffHistory,
    getRuntimeHandoffManager,
    listRuntimeSnapshots,
    loadRuntimeSnapshot,
    saveRuntimeSnapshot,
    setRuntimeBackgroundCompactionThreshold,
    stopAgentDialogLoopAuthorized,
} from '#copilot/agent';
import {
    abortRuntimeCurrentMessage,
    answerRuntimePendingQuestion,
    clearRuntimePendingQuestionShadow,
    offRuntimeEvent,
    onRuntimeEvent,
    onceRuntimeEvent,
    pauseRuntimeDialogLoop,
    readRuntimeControlState,
    resumeRuntimeDialogLoop,
    startRuntime,
} from '../agent/facades/agent-runtime-controls.js';
import {
    getAgentRuntime,
    getDefaultAgentRuntime,
    getDefaultAgentRuntimeId,
    requireAgentRuntime,
} from './agent-runtime.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/always-alive.js').AlwaysAliveAgent}
 */
export function getAgentRuntimeControlsTarget(runtimeId) {
    const resolvedRuntimeId = runtimeId ?? getDefaultAgentRuntimeId();
    if (resolvedRuntimeId === getDefaultAgentRuntimeId()) {
        return getDefaultAgentRuntime();
    }
    return getAgentRuntime(resolvedRuntimeId) ?? requireAgentRuntime(resolvedRuntimeId);
}

/**
 * @returns {import('../agent/always-alive.js').AlwaysAliveAgent}
 */
export function getDefaultAgentRuntimeControlsTarget() {
    return getAgentRuntimeControlsTarget(getDefaultAgentRuntimeId());
}

/**
 * @returns {void}
 */
export function pingDefaultAgentDialogWatchdog() {
    getDefaultAgentRuntimeControlsTarget().pingDialogWatchdog();
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     status: string;
 *     model: string;
 *     reasoningEffort: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 * }}
 */
export function readAgentRuntimeControlState(runtimeId) {
    return readRuntimeControlState(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function startAgentRuntime(runtimeId) {
    await startRuntime(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function abortAgentRuntimeCurrentMessage(runtimeId) {
    await abortRuntimeCurrentMessage(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @param {string} answer
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function answerAgentPendingQuestion(answer, runtimeId) {
    return answerRuntimePendingQuestion(getAgentRuntimeControlsTarget(runtimeId), answer);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function clearAgentPendingQuestionShadow(runtimeId) {
    return clearRuntimePendingQuestionShadow(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onAgentRuntimeEvent(event, handler, runtimeId) {
    onRuntimeEvent(getAgentRuntimeControlsTarget(runtimeId), event, handler);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onceAgentRuntimeEvent(event, handler, runtimeId) {
    onceRuntimeEvent(getAgentRuntimeControlsTarget(runtimeId), event, handler);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function offAgentRuntimeEvent(event, handler, runtimeId) {
    offRuntimeEvent(getAgentRuntimeControlsTarget(runtimeId), event, handler);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function pauseAgentDialogLoop(runtimeId) {
    await pauseRuntimeDialogLoop(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @returns {Promise<void>}
 */
export async function pauseDefaultAgentDialogLoop() {
    await pauseAgentDialogLoop(getDefaultAgentRuntimeId());
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function resumeAgentDialogLoop(runtimeId) {
    await resumeRuntimeDialogLoop(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @returns {Promise<void>}
 */
export async function resumeDefaultAgentDialogLoop() {
    await resumeAgentDialogLoop(getDefaultAgentRuntimeId());
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function stopAgentRuntimeDialogLoopAuthorized(runtimeId) {
    await stopAgentDialogLoopAuthorized(getAgentRuntimeControlsTarget(runtimeId), 'authorized_stop');
}

/**
 * @returns {Promise<void>}
 */
export async function stopDefaultAgentDialogLoopAuthorized() {
    await stopAgentRuntimeDialogLoopAuthorized(getDefaultAgentRuntimeId());
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/infra/handoff-manager.js').HandoffManager | null}
 */
export function getAgentHandoffManager(runtimeId) {
    return getRuntimeHandoffManager(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @returns {import('../agent/infra/handoff-manager.js').HandoffManager | null}
 */
export function getDefaultAgentHandoffManager() {
    return getAgentHandoffManager(getDefaultAgentRuntimeId());
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/infra/handoff-manager.js').HandoffRequest[]}
 */
export function readAgentHandoffHistory(runtimeId) {
    return getRuntimeHandoffHistory(getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @returns {import('../agent/infra/handoff-manager.js').HandoffRequest[]}
 */
export function readDefaultAgentHandoffHistory() {
    return readAgentHandoffHistory(getDefaultAgentRuntimeId());
}

/**
 * @param {number} threshold
 * @returns {void}
 */
export function setDefaultAgentBackgroundCompactionThreshold(threshold) {
    setRuntimeBackgroundCompactionThreshold(threshold);
}

/**
 * @param {Parameters<typeof createRuntimeSnapshot>[0]} data
 * @returns {ReturnType<typeof createRuntimeSnapshot>}
 */
export function createAgentRuntimeSnapshot(data) {
    return createRuntimeSnapshot(data);
}

/**
 * @param {Parameters<typeof saveRuntimeSnapshot>[0]} snapshot
 * @returns {ReturnType<typeof saveRuntimeSnapshot>}
 */
export function saveAgentRuntimeSnapshot(snapshot) {
    return saveRuntimeSnapshot(snapshot);
}

/**
 * @returns {ReturnType<typeof listRuntimeSnapshots>}
 */
export function listAgentRuntimeSnapshots() {
    return listRuntimeSnapshots();
}

/**
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadRuntimeSnapshot>}
 */
export function loadAgentRuntimeSnapshot(snapshotId) {
    return loadRuntimeSnapshot(snapshotId);
}
