// @ts-check
/**
 * src/copilot/terminal/frontend/projections/sdk-session-vanilla.js
 *
 * Projeções e operações vanilla de `mode/plan` da sessão SDK para o terminal.
 *
 * @module copilot/terminal/frontend/projections/sdk-session-vanilla
 */

import { getLastSdkPlanChangedAt, getLastSdkPlanOperation } from '../../../presentation/runtime-ui-state-store.js';
import {
    deleteTerminalSdkPlan,
    getTerminalSdkSessionMode,
    readTerminalSdkPlan,
    setTerminalSdkSessionMode,
    updateTerminalSdkPlan,
} from '../gateways/index.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     currentMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 *     plan: import('../../../presentation/types.js').RuntimeSdkPlanReadResult;
 *     lastObservedPlanOperation: 'create' | 'update' | 'delete' | null;
 *     lastObservedPlanChangedAt: number | null;
 * }>}
 */
export async function readTerminalSdkSessionProjection(runtimeId) {
    const modeResult =
        runtimeId !== undefined ? await getTerminalSdkSessionMode(runtimeId) : await getTerminalSdkSessionMode();
    const plan = runtimeId !== undefined ? await readTerminalSdkPlan(runtimeId) : await readTerminalSdkPlan();
    return {
        currentMode: modeResult.mode,
        plan,
        lastObservedPlanOperation: getLastSdkPlanOperation(),
        lastObservedPlanChangedAt: getLastSdkPlanChangedAt(),
    };
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     previousMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 *     currentMode: import('../../../presentation/types.js').RuntimeSdkMode | string;
 * }>}
 */
export async function setTerminalSdkModeProjection(mode, runtimeId) {
    const previous =
        runtimeId !== undefined ? await getTerminalSdkSessionMode(runtimeId) : await getTerminalSdkSessionMode();
    const current =
        runtimeId !== undefined
            ? await setTerminalSdkSessionMode(mode, runtimeId)
            : await setTerminalSdkSessionMode(mode);
    return {
        previousMode: previous.mode,
        currentMode: current.mode,
    };
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function updateTerminalSdkPlanProjection(content, runtimeId) {
    if (runtimeId !== undefined) {
        await updateTerminalSdkPlan(content, runtimeId);
    } else {
        await updateTerminalSdkPlan(content);
    }
    return readTerminalSdkPlan(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/types.js').RuntimeSdkPlanReadResult>}
 */
export async function deleteTerminalSdkPlanProjection(runtimeId) {
    if (runtimeId !== undefined) {
        await deleteTerminalSdkPlan(runtimeId);
    } else {
        await deleteTerminalSdkPlan();
    }
    return readTerminalSdkPlan(runtimeId);
}
