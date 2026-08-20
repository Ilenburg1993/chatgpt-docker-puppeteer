// @ts-check
/**
 * src/copilot/agent/facades/sdk/models.js
 *
 * Sub-facade: model registry, catálogo, stats e experimental.
 *
 * @module copilot/agent/facades/sdk/models
 */

import { DEFAULT_MODEL } from '#copilot/sdk/constants';
import { isExperimentalEnabled } from '#copilot/sdk/feature-flags';
import { listModels, modelRegistry, modelStatsTracker } from '#copilot/sdk/models';

/** @type {string} */
export const AGENT_SDK_DEFAULT_MODEL = DEFAULT_MODEL;

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
export function readAgentSdkModelRegistryEntry(modelId) {
    const rawMeta = modelRegistry.get(modelId);
    return rawMeta
        ? {
              costTier: rawMeta.costTier,
              speedTier: rawMeta.speedTier,
              contextWindow: rawMeta.contextWindow,
              supportsReasoning: rawMeta.supportsReasoning,
              supportsVision: rawMeta.supportsVision,
          }
        : null;
}

/**
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listAgentSdkCatalogModels() {
    return listModels();
}

/**
 * @returns {ReturnType<typeof modelStatsTracker.allStats>}
 */
export function readAgentSdkModelStats() {
    return modelStatsTracker.allStats();
}

/**
 * @param {Parameters<typeof isExperimentalEnabled>[0]} featureName
 * @returns {boolean}
 */
export function isAgentSdkExperimentalEnabled(featureName) {
    return isExperimentalEnabled(featureName);
}

/**
 * @returns {{
 *     record: (
 *         model: string,
 *         stats: { latencyMs: number; success: boolean; inputTokens?: number; outputTokens?: number },
 *     ) => void;
 * }}
 */
export function getAgentSdkModelStatsTracker() {
    return modelStatsTracker;
}
