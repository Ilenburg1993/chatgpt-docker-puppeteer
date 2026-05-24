// @ts-check
/**
 * Projection family: config.
 */

import {
    BYOK_ENV_KEYS,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokSummary,
} from '#copilot/config';
import { buildEnvByokModelGatewaySnapshot } from '#copilot/model-gateway';
import {
    listRuntimeAvailableModelsProjection,
    observeRuntimeModelChangeProjection,
    readRuntimeAutoModelPolicyProjection,
    readRuntimeModelMetadata,
    readRuntimeModelStatsProjection,
    setRuntimeModelProjection,
    setRuntimeReasoningProjection,
} from '../../../presentation/runtime/index.js';
import {
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getSdkSessionMode,
} from '../../../presentation/state/index.js';
import { readTerminalRuntimeBase } from './shared.js';

/**
 * @param {'interactive' | 'plan' | 'autopilot' | 'shell' | null} storedMode
 * @param {{ sdkSessionId: string | null }} binding
 * @returns {'interactive' | 'plan' | 'autopilot' | 'shell' | null}
 */
function resolveSdkSessionModeProjection(storedMode, binding) {
    if (storedMode) return storedMode;
    return binding.sdkSessionId ? 'interactive' : null;
}

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
 *     autoModelPolicy: ReturnType<typeof readRuntimeAutoModelPolicyProjection>;
 *     observedModelMeta: {
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
 *     byok: ReturnType<typeof readConfiguredByokSummary>;
 *     modelGateway: ReturnType<typeof buildEnvByokModelGatewaySnapshot>;
 *     agentRuntimes: import('./shared.js').TerminalRuntimeBase['agentRuntimes'];
 *     runtimeSessionId: string | null;
 * }}
 */
export function readTerminalConfigProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const currentModel = String(base.model ?? base.snap['model'] ?? 'unknown');
    const currentReasoningEffort = String(base.reasoningEffort ?? base.snap['reasoningEffort'] ?? 'off');
    const autoModelPolicy = readRuntimeAutoModelPolicyProjection(base.runtimeId);
    return {
        currentModel,
        currentReasoningEffort,
        sdkSessionMode: resolveSdkSessionModeProjection(getSdkSessionMode(), base.binding),
        sdkPlanOperation: getLastSdkPlanOperation(),
        sdkPlanChangedAt: getLastSdkPlanChangedAt(),
        modelMeta: readRuntimeModelMetadata(currentModel),
        autoModelPolicy,
        observedModelMeta: autoModelPolicy.observedModel
            ? readRuntimeModelMetadata(autoModelPolicy.observedModel)
            : null,
        binding: base.binding,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        byok: readConfiguredByokSummary(),
        modelGateway: buildEnvByokModelGatewaySnapshot(),
        agentRuntimes: base.agentRuntimes,
        runtimeSessionId: base.runtimeSessionId,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ currentModel: string; models: import('../../../presentation/contracts/index.js').RuntimeModelInfo[] }>}
 */
export async function listTerminalAvailableModelsProjection(runtimeId) {
    return /** @type {Promise<{ currentModel: string; models: import('../../../presentation/contracts/index.js').RuntimeModelInfo[] }>} */ (
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
 * @returns {{
 *     summary: ReturnType<typeof readConfiguredByokSummary>;
 *     models: ReturnType<typeof readConfiguredByokModelsFromEnv>;
 *     profiles: ReturnType<typeof readConfiguredByokProfileSummaries>;
 *     envKeys: readonly string[];
 *     modelGateway: ReturnType<typeof buildEnvByokModelGatewaySnapshot>;
 * }}
 */
export function readTerminalByokProjection() {
    const summary = readConfiguredByokSummary();
    return {
        summary,
        models: readConfiguredByokModelsFromEnv(process.env, {
            model: summary.model,
            contextWindowTokens: summary.capabilities.contextWindowTokens,
            supportsReasoning: summary.capabilities.reasoningEffort,
            supportsVision: summary.capabilities.vision,
        }),
        profiles: readConfiguredByokProfileSummaries(),
        envKeys: BYOK_ENV_KEYS,
        modelGateway: buildEnvByokModelGatewaySnapshot(),
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
 * @param {{ previousModel?: string | null; newModel: string; reasoningEffort?: string | null; ts?: number }} event
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof observeRuntimeModelChangeProjection>}
 */
export function observeTerminalModelChangeProjection(event, runtimeId) {
    return observeRuntimeModelChangeProjection(event, runtimeId);
}

/**
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ previousReasoningEffort: string; currentReasoningEffort: string; runtimeId: string }}
 */
export function setTerminalReasoningProjection(effort, runtimeId) {
    return setRuntimeReasoningProjection(effort, runtimeId);
}
