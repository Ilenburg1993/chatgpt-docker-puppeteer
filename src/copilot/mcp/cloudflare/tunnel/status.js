// @ts-check
/** Canonical Cloudflare tunnel status independent from MCP tool presentation. */

import { validateConfiguredPublicUrl } from '../config.js';
import { readCloudflaredOriginDiagnostics } from '../process/public/index.js';
import { createCloudflareStateStore, summarizeConnectorSmokeState, summarizeQuickTunnelState } from './state.js';

export const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;

/**
 * @param {import('../config.js').CloudflareTunnelConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readCloudflareTunnelStatus(config) {
    const stateStore = createCloudflareStateStore(config);
    const [state, connectorSmokeState, originDiagnostics] = await Promise.all([
        stateStore.readQuickTunnelState(),
        stateStore.readConnectorSmokeState(),
        readCloudflaredOriginDiagnostics(config),
    ]);
    const quickTunnel = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
    const publicUrlValidation = validateConfiguredPublicUrl(config) ?? null;
    const permanentReady =
        config.mode === 'named-permanent' && publicUrlValidation?.ok === true && Boolean(config.publicMcpUrl);
    const connectorSmoke = summarizeConnectorSmokeState(connectorSmokeState, config.publicMcpUrl ?? null);
    const connectorSmokeFresh =
        connectorSmoke.ok === true &&
        typeof connectorSmoke.ageMinutes === 'number' &&
        connectorSmoke.ageMinutes <= CONNECTOR_SMOKE_STALE_AFTER_MINUTES;
    const permanentRecommendedAction = !permanentReady
        ? 'fix-permanent-url'
        : connectorSmoke.ok !== true
          ? 'run-connector-smoke'
          : connectorSmokeFresh
            ? 'use-permanent-hostname'
            : 'refresh-connector-smoke';
    return {
        success: true,
        mode: config.mode,
        tunnelName: config.tunnelName,
        zone: config.zone,
        publicHostname: config.publicHostname,
        permanentTunnel: {
            publicMcpUrl: config.publicMcpUrl ?? null,
            validation: publicUrlValidation,
            tokenPresent: config.hasTunnelToken,
            tokenFilePresent: config.hasTunnelTokenFile,
            transportProtocol: config.transportProtocol,
            lastSmoke: connectorSmoke,
            lastSmokeFresh: connectorSmokeFresh,
            lastSmokeStaleAfterMinutes: CONNECTOR_SMOKE_STALE_AFTER_MINUTES,
            recommendedAction: permanentRecommendedAction,
            originDiagnostics,
        },
        temporaryFallback: { ...quickTunnel, ignoredForOperationalReadiness: permanentReady },
        temporaryTunnel: { ...quickTunnel, ignoredForOperationalReadiness: permanentReady },
        configuredPublicUrl: config.publicMcpUrl ?? null,
        configuredPublicUrlValidation: publicUrlValidation,
        originUrl: config.originUrl,
        localMcpUrl: config.localMcpUrl,
        stateFile: config.stateFile,
        smokeStateFile: config.smokeStateFile,
        transportProtocol: config.transportProtocol,
        stalePolicy: {
            staleAfterMs: config.staleAfterMs,
            staleAfterMinutes: Math.round(config.staleAfterMs / 60000),
        },
        connectorUrl: config.publicMcpUrl ?? quickTunnel.connectorUrl ?? null,
    };
}
