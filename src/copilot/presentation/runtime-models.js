// @ts-check
/**
 * @module copilot/presentation/runtime-models
 * @file Projeções de modelos do runtime para bordas.
 *
 *   O SDK fornece catálogo/estatísticas vanilla; o agent mantém o modelo efetivo do runtime vivo. Esta camada une os dois
 *   para terminal/server sem expor chamadas SDK diretamente às bordas.
 * @typedef {import('./types.js').RuntimeModelInfo} RuntimeModelInfo
 */

import {
    listSdkCatalogModels,
    readRuntimeModelSelection,
    readSdkModelMetadata,
    readSdkModelStats,
    setRuntimeModel,
    setRuntimeReasoningEffort,
} from '#copilot/agent';
import { resolveAgentRuntimeSelection } from './agent-runtime.js';

/**
 * @param {string} modelId
 * @returns {{
 *     costTier?: string;
 *     speedTier?: string;
 *     contextWindow?: number;
 *     supportsReasoning?: boolean;
 *     supportsVision?: boolean;
 * } | null}
 */
export function readRuntimeModelMetadata(modelId) {
    return readSdkModelMetadata(modelId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ currentModel: string; models: RuntimeModelInfo[] }>}
 */
export async function listRuntimeAvailableModelsProjection(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    const currentModel = readRuntimeModelSelection(selection.runtime).model;
    return { currentModel, models: await listSdkCatalogModels() };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ currentModel: string; stats: ReturnType<typeof readSdkModelStats> }}
 */
export function readRuntimeModelStatsProjection(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        currentModel: readRuntimeModelSelection(selection.runtime).model,
        stats: readSdkModelStats(),
    };
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
 *     modelMeta: ReturnType<typeof readRuntimeModelMetadata>;
 *     runtimeId: string;
 * }}
 */
export function setRuntimeModelProjection(modelId, runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    const agent = selection.runtime;
    const before = readRuntimeModelSelection(agent);
    const previousModel = before.model;
    const previousReasoningEffort = String(before.reasoningEffort ?? 'off');
    const modelMeta = readRuntimeModelMetadata(modelId);
    setRuntimeModel(agent, modelId);
    let reasoningAdjusted = false;
    if (modelMeta?.supportsReasoning === false && before.reasoningEffort !== undefined) {
        setRuntimeReasoningEffort(agent, undefined);
        reasoningAdjusted = true;
    }
    const after = readRuntimeModelSelection(agent);
    return {
        previousModel,
        previousReasoningEffort,
        currentModel: modelId,
        currentReasoningEffort: reasoningAdjusted ? 'off' : String(after.reasoningEffort ?? 'off'),
        reasoningAdjusted,
        modelMeta,
        runtimeId: selection.runtimeId,
    };
}

/**
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ previousReasoningEffort: string; currentReasoningEffort: string; runtimeId: string }}
 */
export function setRuntimeReasoningProjection(effort, runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    const agent = selection.runtime;
    const previousReasoningEffort = String(readRuntimeModelSelection(agent).reasoningEffort ?? 'off');
    setRuntimeReasoningEffort(agent, effort);
    return {
        previousReasoningEffort,
        currentReasoningEffort: String(effort ?? 'off'),
        runtimeId: selection.runtimeId,
    };
}
