// @ts-check
/**
 * MCP runtime health and metrics tools.
 *
 * @module copilot/mcp/tools/runtime-health
 */

import { getIoIndexStats } from '#copilot/infra/public/indexing';
import { readCloudflareTunnelConfig } from '../cloudflare/config.js';
import {
    readConnectorSmokeState,
    readQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '../cloudflare/state.js';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { readMcpIndexAutoBuildState } from '../control-plane/index-auto-build.js';
import { readMcpMetricsSnapshot } from '../control-plane/metrics.js';
import { getMcpWorkspaceRoot } from '../control-plane/paths.js';
import { okResult } from '../control-plane/result.js';
import { readMcpWorkspaceSmokeSummary } from '../control-plane/smoke-state.js';
import { repoStatusHandler } from './repo-status.js';

const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;

/**
 * @param {unknown} stats
 * @returns {{
 *     available: boolean;
 *     enabled: boolean;
 *     files: number | null;
 *     empty: boolean;
 *     degraded: boolean;
 *     reason: string | null;
 * }}
 */
function summarizeIndexHealth(stats) {
    const record = /** @type {Record<string, unknown>} */ (stats && typeof stats === 'object' ? stats : {});
    const available = record['available'] === true;
    const enabled = record['enabled'] !== false;
    const files = typeof record['files'] === 'number' ? record['files'] : null;
    const empty = available && files === 0;
    return {
        available,
        enabled,
        files,
        empty,
        degraded: !available || empty,
        reason: !available ? 'index-unavailable' : empty ? 'index-empty' : null,
    };
}

/**
 * @returns {Promise<{ dirty: boolean | null; branch: string | null; head: string | null; error: string | null }>}
 */
async function summarizeWorkspaceStatus() {
    try {
        const result = await repoStatusHandler();
        if (result.isError === true) {
            return {
                dirty: null,
                branch: null,
                head: null,
                error: String(result.structuredContent?.['error'] ?? 'repo_status failed'),
            };
        }
        return {
            dirty: result.structuredContent?.['dirty'] === true,
            branch:
                typeof result.structuredContent?.['branch'] === 'string' ? result.structuredContent['branch'] : null,
            head: typeof result.structuredContent?.['head'] === 'string' ? result.structuredContent['head'] : null,
            error: null,
        };
    } catch (error) {
        return {
            dirty: null,
            branch: null,
            head: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpRuntimeHealthTool = {
    name: 'mcp_runtime_health',
    title: 'MCP runtime health',
    description: 'Return MCP runtime health, workspace root, uptime and per-tool metrics.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const metrics = readMcpMetricsSnapshot();
        const tunnelConfig = readCloudflareTunnelConfig();
        const tunnelState = await readQuickTunnelState(tunnelConfig.stateFile);
        const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
        const connectorSmoke = summarizeConnectorSmokeState(
            await readConnectorSmokeState(tunnelConfig.smokeStateFile),
            tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl,
        );
        const permanentMode = tunnelConfig.mode === 'named-permanent';
        const workspace = await summarizeWorkspaceStatus();
        const indexStats = getIoIndexStats();
        const index = summarizeIndexHealth(indexStats);
        const indexAutoBuild = readMcpIndexAutoBuildState();
        const lastWorkspaceSmoke = readMcpWorkspaceSmokeSummary();
        const warnings = [];
        const critical = [];
        const informational = [];
        if (workspace.error) warnings.push(`Unable to read repository status: ${workspace.error}`);
        if (workspace.dirty === true) informational.push('Workspace has uncommitted or untracked changes.');
        if (!index.available) warnings.push('Shared IO index is unavailable; run or auto-run repo_index_build.');
        else if (index.empty)
            warnings.push('Shared IO index is available but empty; refresh it before indexed search.');
        if (indexAutoBuild.status === 'failed') critical.push('MCP index auto-build failed.');
        if (indexAutoBuild.status === 'running') warnings.push('MCP index auto-build is currently running.');
        if (tunnelConfig.mode === 'temporary-quick' && !tunnel.configured) {
            warnings.push('No saved Cloudflare quick tunnel state; start a temporary tunnel for ChatGPT.');
        }
        if (tunnelConfig.mode === 'temporary-quick' && tunnel.configured && !tunnel.processAlive) {
            warnings.push('Saved Cloudflare quick tunnel process is not alive; start a fresh temporary tunnel.');
        }
        if (tunnelConfig.mode === 'temporary-quick' && tunnel.stale) {
            warnings.push('Temporary Cloudflare tunnel is stale; run cloudflare smoke before reuse.');
        }
        if (connectorSmoke.ok === null)
            warnings.push('No Cloudflare smoke result is recorded for the current connector URL.');
        if (connectorSmoke.ok === false) critical.push('Last Cloudflare smoke failed.');
        if (
            connectorSmoke.ok === true &&
            typeof connectorSmoke.ageMinutes === 'number' &&
            connectorSmoke.ageMinutes > CONNECTOR_SMOKE_STALE_AFTER_MINUTES
        ) {
            warnings.push(
                `Cloudflare connector smoke is ${connectorSmoke.ageMinutes} minutes old; refresh smoke after tunnel, auth or DNS changes.`,
            );
        }
        if (!lastWorkspaceSmoke) warnings.push('No in-process mcp_smoke_workspace result has been recorded.');
        if (lastWorkspaceSmoke?.success === false) critical.push('Last mcp_smoke_workspace failed.');
        for (const [toolName, metric] of Object.entries(metrics.tools)) {
            const calls = Number(metric.calls ?? 0);
            const errors = Number(metric.errors ?? 0);
            if (calls >= 3 && errors / calls >= 0.5) {
                warnings.push(`High MCP error rate for ${toolName}.`);
            }
        }
        const status = critical.length > 0 ? 'failed' : warnings.length > 0 ? 'degraded' : 'ok';
        return okResult({
            success: true,
            ok: true,
            status,
            warnings,
            critical,
            informational,
            workspaceRoot: getMcpWorkspaceRoot(),
            operationalSignals: {
                workspace,
                index,
                indexAutoBuild,
                lastWorkspaceSmoke,
                tunnel: {
                    mode: tunnelConfig.mode,
                    publicMcpUrl: tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl ?? null,
                    tunnelName: tunnelConfig.tunnelName,
                    configured: permanentMode ? Boolean(tunnelConfig.publicMcpUrl) : tunnel.configured,
                    processAlive: permanentMode ? null : tunnel.processAlive,
                    stale: permanentMode ? false : tunnel.stale,
                    recommendedAction:
                        tunnelConfig.mode === 'named-permanent' ? 'use-permanent-hostname' : tunnel.recommendedAction,
                    lastSmokeOk: connectorSmoke.ok,
                    lastSmokeAgeMinutes: connectorSmoke.ageMinutes,
                    lastSmokeCheckedAt: connectorSmoke.checkedAt,
                    smokeStateFile: tunnelConfig.smokeStateFile,
                },
                temporaryFallbackTunnel: {
                    ...tunnel,
                    ignoredForOperationalReadiness: permanentMode,
                },
            },
            indexStats,
            metrics,
            tunnel: permanentMode
                ? {
                      mode: 'named-permanent',
                      publicMcpUrl: tunnelConfig.publicMcpUrl ?? null,
                      lastSmoke: connectorSmoke,
                      temporaryFallback: {
                          ...tunnel,
                          ignoredForOperationalReadiness: true,
                      },
                  }
                : tunnel,
        });
    },
};
