// @ts-check
/** Connector-smoke refresh orchestration owned by the connection domain. */

import {
    compactSmokeReport,
    runCanonicalConnectorSmoke,
    summarizeConnectorSmokeReport,
} from '#copilot/mcp/public/cloudflare/observability';
import { readMcpPostRestartReadiness, summarizeMcpPostRestartReadiness } from './readiness.js';

/**
 * @typedef {{
 *     config: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig;
 *     authority: import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority;
 *     localToolNames: readonly string[];
 *     localToolFingerprints?: Readonly<Record<string,string>>;
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     authConfig: import('#copilot/mcp/public/auth').McpAuthConfig;
 * }} McpConnectorSmokeRuntime
 */

/**
 * @param {{ includeRemoteToolNames?: boolean | undefined; includeDetails?: boolean | undefined }} input
 * @param {McpConnectorSmokeRuntime} runtime
 * @returns {Promise<
 *     | { ok: false; message: string; details: Record<string, unknown> }
 *     | { ok: true; value: Record<string, unknown> }
 * >}
 */
export async function refreshMcpConnectorSmoke(input, runtime) {
    const { config } = runtime;
    if (!config.publicMcpUrl) {
        return {
            ok: false,
            message: 'Permanent MCP connector URL is not configured.',
            details: {
                code: 'ERR_MCP_PUBLIC_URL_NOT_CONFIGURED',
                hint: 'Configure COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or COPILOT_MCP_PUBLIC_URL.',
            },
        };
    }
    const includeRemoteToolNames = input.includeRemoteToolNames === true;
    const includeDetails = input.includeDetails === true || includeRemoteToolNames;
    let report;
    try {
        report = await runCanonicalConnectorSmoke({
            config,
            authority: runtime.authority,
            persistState: true,
            localToolNames: [...runtime.localToolNames],
            ...(runtime.localToolFingerprints ? { localToolFingerprints: runtime.localToolFingerprints } : {}),
        });
    } catch (error) {
        return {
            ok: false,
            message: 'Cloudflare connector smoke refresh failed.',
            details: {
                code: 'ERR_CONNECTOR_SMOKE_FAILED',
                connectorUrl: config.publicMcpUrl,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
    const detailedReport = compactSmokeReport(report, includeRemoteToolNames);
    const reportSummary = summarizeConnectorSmokeReport(detailedReport);
    if (report['ok'] !== true) {
        return {
            ok: false,
            message: 'Cloudflare connector smoke refresh completed with failures.',
            details: {
                code: 'ERR_CONNECTOR_SMOKE_FAILED',
                connectorUrl: config.publicMcpUrl,
                report: includeDetails ? detailedReport : reportSummary,
                detailsAvailable: !includeDetails,
            },
        };
    }
    const readiness = await readMcpPostRestartReadiness(runtime.workspace, config, runtime.authConfig, {
        includeDiagnostics: false,
    });
    const readinessSummary = summarizeMcpPostRestartReadiness(readiness);
    return {
        ok: true,
        value: {
            success: true,
            connectorUrl: config.publicMcpUrl,
            smokeStateFile: config.smokeStateFile,
            refreshedAt: new Date().toISOString(),
            report: includeDetails ? detailedReport : reportSummary,
            postRestartReadiness: readinessSummary,
            detailsAvailable: !includeDetails,
            next:
                readinessSummary['ready'] === true
                    ? [
                          'Post-restart readiness is reconciled in this response; no separate reload_status/readiness call is needed.',
                          'Use the ChatGPT connector URL https://mcp.aurelin.org/mcp.',
                      ]
                    : Array.isArray(readinessSummary['nextActions'])
                      ? readinessSummary['nextActions']
                      : [],
        },
    };
}
