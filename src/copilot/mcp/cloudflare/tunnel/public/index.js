// @ts-check
/** Coherent public membrane for Cloudflare tunnel state and origin planning. */

export {
    createCloudflareStateStore,
    isQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '../state.js';
export { applyCloudflareTunnelOriginPlan, buildCloudflareTunnelOriginPlan } from '../tunnel-origin-plan.js';
/** @typedef {import('../state.js').QuickTunnelState} QuickTunnelState */
/** @typedef {import('../state.js').ConnectorSmokeState} ConnectorSmokeState */

export { CONNECTOR_SMOKE_STALE_AFTER_MINUTES, readCloudflareTunnelStatus } from '../status.js';
