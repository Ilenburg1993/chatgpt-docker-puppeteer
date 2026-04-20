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
 * @returns {Promise<{
 *     currentMode: 'interactive' | 'plan' | 'autopilot';
 *     plan: import('#copilot/sdk/types').PlanReadResult;
 *     lastObservedPlanOperation: 'create' | 'update' | 'delete' | null;
 *     lastObservedPlanChangedAt: number | null;
 * }>}
 */
export async function readTerminalSdkSessionProjection() {
    const modeResult = await getTerminalSdkSessionMode();
    const plan = await readTerminalSdkPlan();
    return {
        currentMode: modeResult.mode,
        plan,
        lastObservedPlanOperation: getLastSdkPlanOperation(),
        lastObservedPlanChangedAt: getLastSdkPlanChangedAt(),
    };
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<{
 *     previousMode: 'interactive' | 'plan' | 'autopilot';
 *     currentMode: 'interactive' | 'plan' | 'autopilot';
 * }>}
 */
export async function setTerminalSdkModeProjection(mode) {
    const previous = await getTerminalSdkSessionMode();
    const current = await setTerminalSdkSessionMode(mode);
    return {
        previousMode: previous.mode,
        currentMode: current.mode,
    };
}

/**
 * @param {string} content
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function updateTerminalSdkPlanProjection(content) {
    await updateTerminalSdkPlan(content);
    return readTerminalSdkPlan();
}

/**
 * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
 */
export async function deleteTerminalSdkPlanProjection() {
    await deleteTerminalSdkPlan();
    return readTerminalSdkPlan();
}
