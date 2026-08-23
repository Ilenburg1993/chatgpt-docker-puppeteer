// @ts-check
/**
 * src/copilot/agent/facades/sdk/quota.js
 *
 * Sub-facade: quota monitoring, rate-limit e recovery policy.
 *
 * @module copilot/agent/facades/sdk/quota
 */

import {
    classifySdkError,
    classifySdkRateLimitScope,
    getSdkRecoveryPolicy,
    isSdkQuotaOrRateLimitError,
} from '#copilot/sdk/errors';
import { accountGetQuota } from '#copilot/sdk/rpc';
import { usageGetMetrics } from '#copilot/sdk/rpc/experimental';
import { createQuotaMonitor } from '#copilot/sdk/telemetry';
import { requireClient, requireSession } from './core/index.js';

/**
 * @param {import('#copilot/sdk/types').QuotaMonitorOptions} options
 * @returns {import('#copilot/sdk/types').QuotaMonitor}
 */
export function createAgentSdkQuotaMonitor(options) {
    return createQuotaMonitor(options);
}

/**
 * @param {{
 *     client: import('#copilot/sdk/types').CopilotClient;
 *     intervalMs: number;
 *     warningThreshold: number;
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/types').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/types').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/types').QuotaMonitor}
 */
export function startAgentSdkQuotaMonitor(options) {
    const monitor = createQuotaMonitor(options);
    monitor.start();
    return monitor;
}

/**
 * @param {{
 *     client: import('#copilot/sdk/types').CopilotClient;
 *     intervalMs: number;
 *     warningThreshold: number;
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/types').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/types').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/types').QuotaMonitor}
 */
export function startAgentSdkBootQuotaBridge(options) {
    return startAgentSdkQuotaMonitor(options);
}

/** @param {unknown} error */
export function classifyAgentSdkError(error) {
    return classifySdkError(error);
}

/** @param {unknown} error */
export function classifyAgentSdkRateLimitScope(error) {
    return classifySdkRateLimitScope(error);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAgentSdkQuotaOrRateLimitError(error) {
    return isSdkQuotaOrRateLimitError(error);
}

/**
 * @param {unknown} error
 * @param {'connection' | 'session'} [scope]
 * @returns {import('#copilot/sdk/types').SdkRecoveryPolicy}
 */
export function getAgentSdkRecoveryPolicy(error, scope) {
    return getSdkRecoveryPolicy(error, scope);
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof accountGetQuota>>>}
 */
export async function getSdkQuota(ctx) {
    return accountGetQuota(requireClient(ctx, 'getSdkQuota'));
}

/**
 * @param {unknown} ctx
 * @returns {Promise<Awaited<ReturnType<typeof usageGetMetrics>>>}
 */
export async function getSdkUsageMetrics(ctx) {
    return usageGetMetrics(requireSession(ctx, 'getSdkUsageMetrics'));
}
