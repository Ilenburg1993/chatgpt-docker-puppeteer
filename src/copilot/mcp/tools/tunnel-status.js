// @ts-check
/**
 * Tunnel status MCP tool for Cloudflare sessions.
 *
 * @module copilot/mcp/tools/tunnel-status
 */

import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { z } from 'zod';
import {
    isCloudflaredActionableOriginErrorLine,
    isCloudflaredBenignClientOrStreamCancellationLine,
    readCloudflareTunnelConfig,
    runCanonicalConnectorSmoke,
    readConnectorSmokeState,
    readQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
    validateConfiguredPublicUrl,
} from '#copilot/mcp/cloudflare';
import { formatChatGptConnectorAuthentication } from '#copilot/mcp/connection';
import {
    boundedWriteAnnotations,
    errorResult,
    okResult,
    readMcpAuthConfig,
    readMcpHttpStatefulSessionPolicy,
    readMcpReloadState,
    readOnlyAnnotations,
    summarizeMcpReloadState,
} from '#copilot/mcp/control-plane';

const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
const CLOUDFLARED_LOG_FILE = 'src/copilot/.ai/cloudflare/cloudflared.log';

/**
 * @param {string} pidFile
 * @returns {Promise<{ pidFile: string; pid: number | null; alive: boolean; error: string | null }>}
 */
async function readPidFileStatus(pidFile) {
    try {
        const raw = (await readFile(pidFile, 'utf8')).trim();
        const pid = Number(raw);
        if (!Number.isInteger(pid) || pid <= 0) {
            return { pidFile, pid: null, alive: false, error: 'PID file does not contain a positive integer.' };
        }
        try {
            process.kill(pid, 0);
            return { pidFile, pid, alive: true, error: null };
        } catch (error) {
            return { pidFile, pid, alive: false, error: error instanceof Error ? error.message : String(error) };
        }
    } catch (error) {
        return { pidFile, pid: null, alive: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean; status?: number; error?: string }>}
 */
async function probeHealth(url) {
    try {
        if (String(url).startsWith('https://127.0.0.1') || String(url).startsWith('https://localhost')) {
            return await probeLocalInsecureHttpsHealth(url);
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { ok: response.ok, status: response.status };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean; status?: number; error?: string; tlsVerification: string }>}
 */
function probeLocalInsecureHttpsHealth(url) {
    return new Promise((resolve) => {
        const request = https.request(url, { method: 'GET', rejectUnauthorized: false }, (response) => {
            response.resume();
            response.on('end', () => {
                resolve({
                    ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
                    tlsVerification: 'disabled-local-origin-diagnostic',
                    ...(response.statusCode === undefined ? {} : { status: response.statusCode }),
                });
            });
        });
        request.setTimeout(3000, () => request.destroy(new Error('health probe timed out')));
        request.on('error', (error) => resolve({ ok: false, error: error.message, tlsVerification: 'disabled-local-origin-diagnostic' }));
        request.end();
    });
}

/** @returns {Promise<Record<string, unknown>>} */
async function readCloudflaredOriginDiagnostics() {
    let text;
    try {
        text = (await readFile(CLOUDFLARED_LOG_FILE, 'utf8')).slice(-64_000);
    } catch {
        return {
            logFile: CLOUDFLARED_LOG_FILE,
            originUsesLocalhost: false,
            originUsesLoopbackIp: false,
            recentOriginErrors: [],
            recentBenignOriginCancellations: [],
            recommendation: 'cloudflared log not found yet; run make copilot-mcp-restart and smoke after startup.',
        };
    }
    const logLines = text.split(/\r?\n/u);
    const recentOriginErrorCandidates = logLines.filter(isCloudflaredOriginErrorLine);
    const recentOriginErrors = recentOriginErrorCandidates.filter(isCloudflaredActionableOriginErrorLine).slice(-8);
    const recentBenignOriginCancellations = recentOriginErrorCandidates
        .filter(isCloudflaredBenignClientOrStreamCancellationLine)
        .slice(-8);
    const recentTunnelTransportErrors = logLines.filter(isCloudflaredTunnelTransportErrorLine).slice(-8);
    const recentMetricsBindErrors = logLines.filter(isCloudflaredMetricsBindErrorLine).slice(-4);
    const originUsesLocalhost = /http:\/\/localhost:3333|\[::1\]:3333/iu.test(text);
    const originUsesLoopbackIp = /http:\/\/127\.0\.0\.1:3333/iu.test(text);
    return {
        logFile: CLOUDFLARED_LOG_FILE,
        originUsesLocalhost,
        originUsesLoopbackIp,
        recentOriginErrors,
        recentBenignOriginCancellations,
        recentTunnelTransportErrors,
        recentMetricsBindErrors,
        recommendation: originUsesLocalhost
            ? 'Prefer Cloudflare public hostname service http://127.0.0.1:3333 instead of http://localhost:3333 to avoid IPv6 ::1 origin misses.'
            : null,
    };
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isCloudflaredOriginErrorLine(line) {
    return /\bERR\b|\bWRN\b|error=/iu.test(line) &&
        /origin service|originService=|first record does not look like a TLS handshake|connection refused|502|1033/iu.test(line);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isCloudflaredTunnelTransportErrorLine(line) {
    return /\bERR\b|\bWRN\b|error=/iu.test(line) &&
        /failed to accept QUIC stream|failed to run the datagram handler|no recent network activity|accept stream listener|Serve tunnel error|Connection terminated|Failed to dial a quic connection/iu.test(line);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isCloudflaredMetricsBindErrorLine(line) {
    return /Error opening metrics server listener|failed to bind to address|bind: address already in use/iu.test(line);
}

/**
 * @param {string} stdout
 * @returns {unknown}
 */
export function parseConnectorSmokeJsonOutput(stdout) {
    const candidates = [stdout.trim()];
    const jsonStart = /\{\s*"ok"\s*:/u.exec(stdout)?.index;
    if (typeof jsonStart === 'number' && jsonStart > 0) {
        candidates.push(stdout.slice(jsonStart).trim());
    }
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return JSON.parse(candidate);
        } catch {
            // Try the next candidate. The smoke CLI may emit startup logs before the final JSON report.
        }
    }
    throw new Error('No parseable smoke JSON object found in stdout.');
}

/**
 * @param {unknown} value
 * @param {boolean} includeRemoteToolNames
 * @returns {unknown}
 */
function compactSmokeReport(value, includeRemoteToolNames) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const report = /** @type {Record<string, unknown>} */ (value);
    const toolsList =
        report['toolsList'] && typeof report['toolsList'] === 'object' && !Array.isArray(report['toolsList'])
            ? { .../** @type {Record<string, unknown>} */ (report['toolsList']) }
            : report['toolsList'];
    /** @type {Record<string, unknown> | null} */
    const authenticatedOAuthSmoke =
        report['authenticatedOAuthSmoke'] &&
        typeof report['authenticatedOAuthSmoke'] === 'object' &&
        !Array.isArray(report['authenticatedOAuthSmoke'])
            ? { .../** @type {Record<string, unknown>} */ (report['authenticatedOAuthSmoke']) }
            : null;
    const authenticatedToolsList =
        authenticatedOAuthSmoke &&
        typeof authenticatedOAuthSmoke === 'object' &&
        !Array.isArray(authenticatedOAuthSmoke) &&
        authenticatedOAuthSmoke['authenticatedToolsList'] &&
        typeof authenticatedOAuthSmoke['authenticatedToolsList'] === 'object' &&
        !Array.isArray(authenticatedOAuthSmoke['authenticatedToolsList'])
            ? { .../** @type {Record<string, unknown>} */ (authenticatedOAuthSmoke['authenticatedToolsList']) }
            : null;
    if (!includeRemoteToolNames) {
        if (toolsList && typeof toolsList === 'object' && !Array.isArray(toolsList)) {
            const toolsListRecord = /** @type {Record<string, unknown>} */ (toolsList);
            if ('remoteToolNames' in toolsListRecord) {
                delete toolsListRecord['remoteToolNames'];
                toolsListRecord['remoteToolNamesSuppressed'] = true;
            }
        }
        if (authenticatedToolsList) {
            if ('remoteToolNames' in authenticatedToolsList) {
                delete authenticatedToolsList['remoteToolNames'];
                authenticatedToolsList['remoteToolNamesSuppressed'] = true;
            }
            if (authenticatedOAuthSmoke && typeof authenticatedOAuthSmoke === 'object' && !Array.isArray(authenticatedOAuthSmoke)) {
                authenticatedOAuthSmoke['authenticatedToolsList'] = authenticatedToolsList;
            }
        }
    }
    return { ...report, toolsList, authenticatedOAuthSmoke };
}

/**
 * @param {{ includeRemoteToolNames?: boolean }} input
 * @returns {Promise<import('../control-plane/result.js').StructuredCallToolResult>}
 */
async function runConnectorSmokeRefresh(input) {
    const config = readCloudflareTunnelConfig();
    if (!config.publicMcpUrl) {
        return errorResult('Permanent MCP connector URL is not configured.', {
            code: 'ERR_MCP_PUBLIC_URL_NOT_CONFIGURED',
            hint: 'Configure COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or COPILOT_MCP_PUBLIC_URL.',
        });
    }
    const includeRemoteToolNames = input.includeRemoteToolNames === true;
    let report;
    try {
        report = await runCanonicalConnectorSmoke({
            config,
            env: {
                ...process.env,
                COPILOT_MCP_AUTH_MODE: process.env['COPILOT_MCP_AUTH_MODE'] ?? 'oauth',
                COPILOT_MCP_AUTH_ENFORCEMENT: process.env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? 'all',
                COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: config.publicMcpUrl,
            },
            persistState: true,
        });
    } catch (error) {
        return errorResult('Cloudflare connector smoke refresh failed.', {
            code: 'ERR_CONNECTOR_SMOKE_FAILED',
            connectorUrl: config.publicMcpUrl,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    const compact = compactSmokeReport(report, includeRemoteToolNames);
    if (report['ok'] !== true) {
        return errorResult('Cloudflare connector smoke refresh completed with failures.', {
            code: 'ERR_CONNECTOR_SMOKE_FAILED',
            connectorUrl: config.publicMcpUrl,
            report: compact,
        });
    }
    return okResult({
        success: true,
        connectorUrl: config.publicMcpUrl,
        smokeStateFile: config.smokeStateFile,
        refreshedAt: new Date().toISOString(),
        report: compact,
        next: [
            'Call mcp_tunnel_status to confirm lastSmokeFresh=true.',
            'Use the ChatGPT connector URL https://mcp.aurelin.org/mcp.',
        ],
    });
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpTunnelStatusTool = {
    name: 'mcp_tunnel_status',
    title: 'MCP tunnel status',
    description:
        'Return the current Cloudflare tunnel mode, permanent connector URL, temporary fallback state and recovery guidance.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const config = readCloudflareTunnelConfig();
        const state = await readQuickTunnelState(config.stateFile);
        const auth = readMcpAuthConfig();
        const quickTunnel = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
        const publicUrlValidation = validateConfiguredPublicUrl(config) ?? null;
        const permanentReady =
            config.mode === 'named-permanent' && publicUrlValidation?.ok === true && Boolean(config.publicMcpUrl);
        const connectorSmoke = summarizeConnectorSmokeState(
            await readConnectorSmokeState(config.smokeStateFile),
            config.publicMcpUrl ?? null,
        );
        const originDiagnostics = await readCloudflaredOriginDiagnostics();
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
        return okResult({
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
            temporaryFallback: {
                ...quickTunnel,
                ignoredForOperationalReadiness: permanentReady,
            },
            temporaryTunnel: {
                ...quickTunnel,
                ignoredForOperationalReadiness: permanentReady,
            },
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
            chatgpt: {
                mcpServerUrl: config.publicMcpUrl ?? quickTunnel.connectorUrl ?? null,
                preferredMcpServerUrl: config.publicMcpUrl ?? quickTunnel.connectorUrl ?? null,
                authentication: formatChatGptConnectorAuthentication(auth),
            },
        });
    },
};

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpConnectorSmokeRefreshTool = {
    name: 'mcp_connector_smoke_refresh',
    title: 'Refresh MCP connector smoke',
    description:
        'Run the canonical Cloudflare/OAuth connector smoke for the permanent MCP URL and persist the compact readiness state.',
    inputSchema: {
        includeRemoteToolNames: z
            .boolean()
            .optional()
            .describe(
                'Include the full remote tool-name list in the response. Default: false to keep ChatGPT streams compact.',
            ),
    },
    annotations: boundedWriteAnnotations(),
    handler: runConnectorSmokeRefresh,
};

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpPostRestartReadinessTool = {
    name: 'mcp_post_restart_readiness',
    title: 'MCP post-restart readiness',
    description:
        'Return a compact post-restart readiness snapshot for the permanent Cloudflare MCP connector before ChatGPT starts heavier work.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const config = readCloudflareTunnelConfig();
        const publicUrlValidation = validateConfiguredPublicUrl(config) ?? null;
        const connectorSmoke = summarizeConnectorSmokeState(
            await readConnectorSmokeState(config.smokeStateFile),
            config.publicMcpUrl ?? null,
        );
        const reload = summarizeMcpReloadState(await readMcpReloadState(), connectorSmoke.checkedAt);
        const connectorSmokeAgeFresh =
            connectorSmoke.ok === true &&
            typeof connectorSmoke.ageMinutes === 'number' &&
            connectorSmoke.ageMinutes <= CONNECTOR_SMOKE_STALE_AFTER_MINUTES;
        const connectorSmokeFresh = connectorSmokeAgeFresh && reload.reconciledWithConnectorSmoke === true;
        const publicHealthUrl = config.publicMcpUrl ? new URL('/health', config.publicMcpUrl).toString() : null;
        const [mcpHttpProcess, cloudflaredProcess, localHealth, publicHealth] = await Promise.all([
            readPidFileStatus(config.mcpHttpPidFile),
            readPidFileStatus(config.managedTunnelPidFile),
            probeHealth(config.healthUrl),
            publicHealthUrl ? probeHealth(publicHealthUrl) : Promise.resolve({ ok: false, error: 'public MCP URL not configured' }),
        ]);
        const originDiagnostics = await readCloudflaredOriginDiagnostics();
        const statefulPolicy = {
            ...readMcpHttpStatefulSessionPolicy(),
            postSessionContractEnforced: process.env['COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT'] === 'true',
            sessionIdHashSecretPresent:
                typeof process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'] === 'string' &&
                process.env['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET'].trim().length >= 32,
        };
        const permanentUrlReady =
            config.mode === 'named-permanent' && Boolean(config.publicMcpUrl) && publicUrlValidation?.ok === true;
        const healthReady = localHealth.ok || publicHealth.ok;
        const ready =
            permanentUrlReady &&
            mcpHttpProcess.alive &&
            cloudflaredProcess.alive &&
            healthReady &&
            connectorSmokeFresh;
        const nextActions = [];
        if (!permanentUrlReady)
            nextActions.push('Fix COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or public hostname configuration.');
        if (!mcpHttpProcess.alive || !cloudflaredProcess.alive || !healthReady) {
            nextActions.push('Run make copilot-mcp-restart.');
        } else if (!localHealth.ok && publicHealth.ok) {
            nextActions.push('Local HTTPS health probe failed, but public connector health is OK; inspect SNI/local TLS only if origin debugging is needed.');
        }
        if (reload.inFlight) {
            nextActions.push('Wait for mcp_reload_status to leave the in-flight state before trusting post-restart readiness.');
        } else if (reload.failed) {
            nextActions.push('Inspect mcp_reload_status: the latest controlled MCP reload did not complete successfully.');
        }
        if (!connectorSmokeFresh) {
            if (reload.completedSuccessfully && reload.smokeAfterReload !== true) {
                nextActions.push('Run mcp_connector_smoke_refresh after the latest completed reload to reconcile the new process/tunnel generation.');
            } else {
                nextActions.push('Run mcp_connector_smoke_refresh or make copilot-mcp-smoke-refresh.');
            }
        }
        if (ready) {
            nextActions.push('Start with mcp_session_profile, mcp_validation_dashboard and repo_status.');
        }
        return okResult({
            success: true,
            ready,
            mode: config.mode,
            connectorUrl: config.publicMcpUrl ?? null,
            publicUrlValidation,
            processes: {
                mcpHttp: mcpHttpProcess,
                cloudflared: cloudflaredProcess,
            },
            localHealth,
            publicHealth,
            healthReady,
            originDiagnostics,
            statefulPolicy,
            reload,
            connectorSmoke: {
                ...connectorSmoke,
                ageFresh: connectorSmokeAgeFresh,
                fresh: connectorSmokeFresh,
                staleAfterMinutes: CONNECTOR_SMOKE_STALE_AFTER_MINUTES,
            },
            chatgpt: {
                authentication: formatChatGptConnectorAuthentication(readMcpAuthConfig()),
                recommendedFirstCalls: ready
                    ? ['mcp_session_profile', 'mcp_validation_dashboard', 'repo_status']
                    : ['mcp_tunnel_status', 'mcp_connector_smoke_refresh'],
            },
            nextActions,
        });
    },
};
