// @ts-check
/**
 * src/copilot/terminal/frontend/sdk-session-projection.js
 *
 * Projeções e operações vanilla de `mode/plan` da sessão SDK para o terminal.
 *
 * @module copilot/terminal/frontend/sdk-session-projection
 */

import { getLastSdkPlanChangedAt, getLastSdkPlanOperation } from '../state.js';
import {
    deleteTerminalSdkPlan,
    getTerminalSdkSessionMode,
    readTerminalSdkPlan,
    setTerminalSdkSessionMode,
    updateTerminalSdkPlan,
} from './llm-b-runtime.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     currentMode: 'interactive' | 'plan' | 'autopilot';
 *     plan: import('#copilot/sdk/types').PlanReadResult;
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
 *     previousMode: 'interactive' | 'plan' | 'autopilot';
 *     currentMode: 'interactive' | 'plan' | 'autopilot';
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
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
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
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function deleteTerminalSdkPlanProjection(runtimeId) {
    if (runtimeId !== undefined) {
        await deleteTerminalSdkPlan(runtimeId);
    } else {
        await deleteTerminalSdkPlan();
    }
    return readTerminalSdkPlan(runtimeId);
}
