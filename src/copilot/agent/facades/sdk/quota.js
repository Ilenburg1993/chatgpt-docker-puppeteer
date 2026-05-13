// @ts-check
/**
 * src/copilot/agent/facades/sdk/quota.js
 *
 * Sub-facade: quota monitoring, rate-limit e recovery policy.
 *
 * @module copilot/agent/facades/sdk/quota
 */

import { accountGetQuota, createQuotaMonitor, getSdkRecoveryPolicy, isSdkQuotaOrRateLimitError } from '#copilot/sdk';
import { requireClient } from './core/index.js';

/**
 * @param {import('#copilot/sdk/quota-monitor').QuotaMonitorOptions} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
 */
export function createAgentSdkQuotaMonitor(options) {
    return createQuotaMonitor(options);
}

/**
 * @param {{
 *     client: import('#copilot/sdk/types').CopilotClient;
 *     intervalMs: number;
 *     warningThreshold: number;
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/quota-monitor').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/quota-monitor').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
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
 *     onWarning?: (quotaId: string, snapshot: import('#copilot/sdk/quota-monitor').QuotaSnapshot) => void;
 *     onUpdate?: (snapshots: Record<string, import('#copilot/sdk/quota-monitor').QuotaSnapshot>) => void;
 * }} options
 * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor}
 */
export function startAgentSdkBootQuotaBridge(options) {
    return startAgentSdkQuotaMonitor(options);
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
