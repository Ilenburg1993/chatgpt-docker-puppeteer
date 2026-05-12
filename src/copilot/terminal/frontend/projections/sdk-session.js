// @ts-check
/**
 * Projection family: sdk-session.
 */

import {
    deleteTerminalSdkPlanProjection as deleteTerminalSdkPlanProjectionImpl,
    readTerminalSdkSessionProjection as readTerminalSdkSessionProjectionImpl,
    setTerminalSdkModeProjection as setTerminalSdkModeProjectionImpl,
    updateTerminalSdkPlanProjection as updateTerminalSdkPlanProjectionImpl,
} from './sdk-session-vanilla.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     currentMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 *     plan: import('../../../presentation/types.js').RuntimeSdkPlanReadResult;
 *     lastObservedPlanOperation: 'create' | 'update' | 'delete' | null;
 *     lastObservedPlanChangedAt: number | null;
 * }>}
 */
export async function readTerminalPlanProjection(runtimeId) {
    return readTerminalSdkSessionProjectionImpl(runtimeId);
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     previousMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 *     currentMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 * }>}
 */
export async function setTerminalPlanModeProjection(mode, runtimeId) {
    return setTerminalSdkModeProjectionImpl(mode, runtimeId);
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function updateTerminalPlanProjection(content, runtimeId) {
    return updateTerminalSdkPlanProjectionImpl(content, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function deleteTerminalPlanProjection(runtimeId) {
    return deleteTerminalSdkPlanProjectionImpl(runtimeId);
}
