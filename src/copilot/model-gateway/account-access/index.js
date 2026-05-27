// @ts-check
/**
 * Account-scoped access resolution.
 *
 * @module copilot/model-gateway/account-access
 */

export { explainModelGatewayAccountAccess } from './explain.js';
export {
    MODEL_GATEWAY_ACCOUNT_OVERLAY_FRESHNESS_STATUS,
    evaluateModelGatewayAccountOverlayFreshness,
    resolveModelGatewayAccountOverlayFreshnessPolicy,
    summarizeModelGatewayAccountOverlayFreshness,
} from './freshness.js';
export { MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS, normalizeModelGatewayAccountLimitState } from './limits.js';
export { MODEL_GATEWAY_SDK_QUOTA_STATUS, summarizeModelGatewaySdkQuotaSnapshots } from './sdk-quota.js';
export { explainModelGatewayAccountLimitOverlays, summarizeModelGatewayAccountOverlays } from './summary.js';
export {
    listModelGatewayProviderQuotaCapabilities,
    summarizeModelGatewayProviderQuotaCapabilities,
} from './provider-quota-capabilities.js';
export {
    deriveModelGatewayRuntimeAccountOverlayFromHealth,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    summarizeModelGatewayRuntimeAccountOverlays,
} from './runtime-overlays.js';
export {
    MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE,
    MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS,
    MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS,
    resolveModelGatewayAccountAccess,
} from './resolver.js';
