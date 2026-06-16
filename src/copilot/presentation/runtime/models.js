// @ts-check
/**
 * @module copilot/presentation/runtime-models
 * @file Projeções de modelos do runtime para bordas.
 *
 *   O SDK fornece catálogo/estatísticas vanilla; o agent mantém o modelo efetivo do runtime vivo. Esta camada une os dois
 *   para terminal/server sem expor chamadas SDK diretamente às bordas.
 * @typedef {import('../contracts/index.js').RuntimeModelInfo} RuntimeModelInfo
 */

import {
    listSdkCatalogModels,
    observeRuntimeModelChange,
    readRuntimeAutoModelPolicy,
    readRuntimeModelSelection,
    readSdkModelMetadata,
    readSdkModelStats,
    setRuntimeModel,
    setRuntimeReasoningEffort,
    switchRuntimeModelTransactional,
    switchRuntimeRouteTransactional,
} from '#copilot/agent/facades';
import { requireAgentRuntimeSelection } from '#copilot/presentation/agent/runtime';

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
    const selection = requireAgentRuntimeSelection(runtimeId);
    const currentModel = readRuntimeModelSelection(selection.runtime).model;
    return { currentModel, models: await listSdkCatalogModels() };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ currentModel: string; stats: ReturnType<typeof readSdkModelStats> }}
 */
export function readRuntimeModelStatsProjection(runtimeId) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    return {
        currentModel: readRuntimeModelSelection(selection.runtime).model,
        stats: readSdkModelStats(),
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof readRuntimeAutoModelPolicy>}
 */
export function readRuntimeAutoModelPolicyProjection(runtimeId) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    return readRuntimeAutoModelPolicy(selection.runtime);
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
    const selection = requireAgentRuntimeSelection(runtimeId);
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
 * @param {string} modelId
 * @param {string | null | undefined} [runtimeId]
 * @param {{ idempotencyKey?: string; source?: string }} [options]
 */
export async function switchRuntimeModelProjection(modelId, runtimeId, options = {}) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    const agent = selection.runtime;
    const before = readRuntimeModelSelection(agent);
    const modelMeta = readRuntimeModelMetadata(modelId);
    const operation = await switchRuntimeModelTransactional(agent, modelId, options);
    const committed = operation['state'] === 'committed';
    let reasoningAdjusted = false;
    if (committed && modelMeta?.supportsReasoning === false && before.reasoningEffort !== undefined) {
        setRuntimeReasoningEffort(agent, undefined);
        reasoningAdjusted = true;
    }
    const after = readRuntimeModelSelection(agent);
    return {
        previousModel: before.model,
        previousReasoningEffort: String(before.reasoningEffort ?? 'off'),
        currentModel: after.model,
        currentReasoningEffort: String(after.reasoningEffort ?? 'off'),
        reasoningAdjusted,
        modelMeta,
        runtimeId: selection.runtimeId,
        operation,
    };
}

/**
 * Rebinda provider/model preservando o sessionId do runtime selecionado.
 *
 * @param {Record<string, unknown>} route
 * @param {string | null | undefined} [runtimeId]
 * @param {{
 *     idempotencyKey?: string;
 *     timeoutMs?: number;
 *     source?: string;
 *     allowActiveDialogLoopReattach?: boolean;
 *     forceApplyDeferred?: boolean;
 * }} [options]
 */
export async function switchRuntimeRouteProjection(route, runtimeId, options = {}) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    const before = readRuntimeModelSelection(selection.runtime);
    const operation = await switchRuntimeRouteTransactional(selection.runtime, route, options);
    const after = readRuntimeModelSelection(selection.runtime);
    return {
        runtimeId: selection.runtimeId,
        previousModel: before.model,
        currentModel: after.model,
        route,
        operation,
    };
}

/**
 * Registra no runtime uma confirmação de modelo emitida pelo SDK, sem disparar nova troca de modelo.
 *
 * @param {{ previousModel?: string | null; newModel: string; reasoningEffort?: string | null; ts?: number }} event
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ runtimeId: string; configuredModel: string; observedModel: string }}
 */
export function observeRuntimeModelChangeProjection(event, runtimeId) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    observeRuntimeModelChange(selection.runtime, event);
    const after = readRuntimeModelSelection(selection.runtime);
    return {
        runtimeId: selection.runtimeId,
        configuredModel: after.model,
        observedModel: event.newModel,
    };
}

/**
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ previousReasoningEffort: string; currentReasoningEffort: string; runtimeId: string }}
 */
export function setRuntimeReasoningProjection(effort, runtimeId) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    const agent = selection.runtime;
    const previousReasoningEffort = String(readRuntimeModelSelection(agent).reasoningEffort ?? 'off');
    setRuntimeReasoningEffort(agent, effort);
    return {
        previousReasoningEffort,
        currentReasoningEffort: String(effort ?? 'off'),
        runtimeId: selection.runtimeId,
    };
}
