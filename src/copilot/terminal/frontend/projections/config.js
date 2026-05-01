// @ts-check
/**
 * Projection family: config.
 */

import {
    listRuntimeAvailableModelsProjection,
    readRuntimeModelMetadata,
    readRuntimeModelStatsProjection,
    setRuntimeModelProjection,
    setRuntimeReasoningProjection,
} from '../../../presentation/runtime-models.js';
import {
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getSdkSessionMode,
} from '../../../presentation/runtime-ui-state-store.js';
import { readTerminalRuntimeBase } from './shared.js';

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     currentModel: string;
 *     currentReasoningEffort: string;
 *     sdkSessionMode: 'interactive' | 'plan' | 'autopilot' | 'shell' | null;
 *     sdkPlanOperation: 'create' | 'update' | 'delete' | null;
 *     sdkPlanChangedAt: number | null;
 *     modelMeta: {
 *         costTier?: string;
 *         speedTier?: string;
 *         contextWindow?: number;
 *         supportsReasoning?: boolean;
 *         supportsVision?: boolean;
 *     } | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     agentRuntimes: import('./shared.js').TerminalRuntimeBase['agentRuntimes'];
 *     runtimeSessionId: string | null;
 * }}
 */
export function readTerminalConfigProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const currentModel = String(base.model ?? base.snap['model'] ?? 'unknown');
    const currentReasoningEffort = String(base.reasoningEffort ?? base.snap['reasoningEffort'] ?? 'off');
    return {
        currentModel,
        currentReasoningEffort,
        sdkSessionMode: getSdkSessionMode(),
        sdkPlanOperation: getLastSdkPlanOperation(),
        sdkPlanChangedAt: getLastSdkPlanChangedAt(),
        modelMeta: readRuntimeModelMetadata(currentModel),
        binding: base.binding,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        agentRuntimes: base.agentRuntimes,
        runtimeSessionId: base.runtimeSessionId,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ currentModel: string; models: import('../../../presentation/types.js').RuntimeModelInfo[] }>}
 */
export async function listTerminalAvailableModelsProjection(runtimeId) {
    return /** @type {Promise<{ currentModel: string; models: import('../../../presentation/types.js').RuntimeModelInfo[] }>} */ (
        listRuntimeAvailableModelsProjection(runtimeId)
    );
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof readRuntimeModelStatsProjection>}
 */
export function readTerminalModelStatsProjection(runtimeId) {
    return readRuntimeModelStatsProjection(runtimeId);
}

/**
 * @param {string} modelId
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     previousModel: string;
 *     previousReasoningEffort: string;
 *     currentModel: string;
 *     currentReasoningEffort: string;
 *     reasoningAdjusted: boolean;
 *     modelMeta: {
 *         costTier?: string;
 *         speedTier?: string;
 *         contextWindow?: number;
 *         supportsReasoning?: boolean;
 *         supportsVision?: boolean;
 *     } | null;
 *     binding: { hubSessionId: string | null; sdkSessionId: string | null };
 *     runtimeId: string;
 * }}
 */
export function setTerminalModelProjection(modelId, runtimeId) {
    const { binding } = readTerminalRuntimeBase(runtimeId);
    const projected = setRuntimeModelProjection(modelId, runtimeId);
    return {
        ...projected,
        binding,
    };
}

/**
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ previousReasoningEffort: string; currentReasoningEffort: string; runtimeId: string }}
 */
export function setTerminalReasoningProjection(effort, runtimeId) {
    return setRuntimeReasoningProjection(effort, runtimeId);
}
