// @ts-check
/**
 * Projection family: config.
 */

import {
    BYOK_ENV_KEYS,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokSummary,
} from '#copilot/config';
import {
    buildEnvByokModelGatewaySnapshot,
    buildModelGatewayOperatorProjection,
    materializeModelGatewayActiveByokProfileEnv,
    readModelGatewayByokProfileSummaries,
    toCopilotModelInfoList,
} from '#copilot/model-gateway';
import {
    listRuntimeAvailableModelsProjection,
    observeRuntimeModelChangeProjection,
    readRuntimeAutoModelPolicyProjection,
    readRuntimeModelMetadata,
    readRuntimeModelStatsProjection,
    setRuntimeModelProjection,
    setRuntimeReasoningProjection,
    switchRuntimeModelProjection,
    switchRuntimeRouteProjection,
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
 *     permissionMode: 'approve_all' | 'audit_only' | 'selective';
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
 *     modelGatewayProjection: ReturnType<typeof buildModelGatewayOperatorProjection>;
 *     agentRuntimes: import('./shared.js').TerminalRuntimeBase['agentRuntimes'];
 *     runtimeSessionId: string | null;
 * }}
 */
export function readTerminalConfigProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const currentModel = String(base.model ?? base.snap['model'] ?? 'unknown');
    const currentReasoningEffort = String(base.reasoningEffort ?? base.snap['reasoningEffort'] ?? 'off');
    const permissionMode =
        base.snap['permissionMode'] === 'audit_only' || base.snap['permissionMode'] === 'selective'
            ? /** @type {'audit_only' | 'selective'} */ (base.snap['permissionMode'])
            : 'approve_all';
    const autoModelPolicy = readRuntimeAutoModelPolicyProjection(base.runtimeId);
    const modelGateway = buildEnvByokModelGatewaySnapshot();
    const modelGatewayActiveRoute =
        base.snap['modelGatewayActiveRoute'] && typeof base.snap['modelGatewayActiveRoute'] === 'object'
            ? /** @type {Record<string, unknown>} */ (base.snap['modelGatewayActiveRoute'])
            : null;
    return {
        currentModel,
        currentReasoningEffort,
        permissionMode,
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
        modelGateway,
        modelGatewayProjection: buildModelGatewayOperatorProjection(modelGateway, {
            activeRoute: modelGatewayActiveRoute,
        }),
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
 *     gatewayModels: ReturnType<typeof toCopilotModelInfoList>;
 *     profiles: ReturnType<typeof readModelGatewayByokProfileSummaries>;
 *     envKeys: readonly string[];
 *     modelGateway: ReturnType<typeof buildEnvByokModelGatewaySnapshot>;
 *     modelGatewayProjection: ReturnType<typeof buildModelGatewayOperatorProjection>;
 * }}
 */
export function readTerminalByokProjection() {
    const materialized = materializeModelGatewayActiveByokProfileEnv(process.env);
    const summary = {
        ...readConfiguredByokSummary(materialized.env),
        profile: materialized.profile?.name ?? process.env['COPILOT_BYOK_PROFILE'] ?? null,
    };
    const modelGateway = buildEnvByokModelGatewaySnapshot(materialized.env);
    return {
        summary,
        models: readConfiguredByokModelsFromEnv(materialized.env, {
            model: summary.model,
            contextWindowTokens: summary.capabilities.contextWindowTokens,
            supportsReasoning: summary.capabilities.reasoningEffort,
            supportsVision: summary.capabilities.vision,
        }),
        gatewayModels: toCopilotModelInfoList(modelGateway.models),
        profiles: readModelGatewayByokProfileSummaries(),
        envKeys: BYOK_ENV_KEYS,
        modelGateway,
        modelGatewayProjection: buildModelGatewayOperatorProjection(modelGateway),
    };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *     modelGateway: ReturnType<typeof buildEnvByokModelGatewaySnapshot>;
 *     modelGatewayProjection: ReturnType<typeof buildModelGatewayOperatorProjection>;
 *     gatewayModels: ReturnType<typeof toCopilotModelInfoList>;
 * }}
 */
export function readTerminalByokGatewayProjectionFromEnv(env = process.env) {
    const modelGateway = buildEnvByokModelGatewaySnapshot(env);
    return {
        modelGateway,
        modelGatewayProjection: buildModelGatewayOperatorProjection(modelGateway),
        gatewayModels: toCopilotModelInfoList(modelGateway.models),
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
 * @param {string} modelId
 * @param {string | null | undefined} [runtimeId]
 * @param {{ idempotencyKey?: string; source?: string }} [options]
 */
export async function switchTerminalModelProjection(modelId, runtimeId, options = {}) {
    const { binding } = readTerminalRuntimeBase(runtimeId);
    const projected = await switchRuntimeModelProjection(modelId, runtimeId, options);
    return {
        ...projected,
        binding,
    };
}

/**
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
export async function switchTerminalRouteProjection(route, runtimeId, options = {}) {
    const { binding } = readTerminalRuntimeBase(runtimeId);
    const projected = await switchRuntimeRouteProjection(route, runtimeId, options);
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
