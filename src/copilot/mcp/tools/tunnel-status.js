// @ts-check
/**
 * Tunnel status MCP tool for Cloudflare sessions.
 *
 * @module copilot/mcp/tools/tunnel-status
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readCloudflareTunnelConfig, validateConfiguredPublicUrl } from '../cloudflare/config.js';
import {
    readConnectorSmokeState,
    readQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '../cloudflare/state.js';
import { formatChatGptConnectorAuthentication } from '../connection/profile.js';
import { boundedWriteAnnotations, readOnlyAnnotations } from '../control-plane/annotations.js';
import { readMcpAuthConfig } from '../control-plane/auth.js';
import { errorResult, okResult } from '../control-plane/result.js';

const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
const CONNECTOR_SMOKE_TIMEOUT_MS = 45_000;
const CONNECTOR_SMOKE_OUTPUT_LIMIT = 256_000;
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
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { ok: response.ok, status: response.status };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @returns {Promise<{
 *     logFile: string;
 *     originUsesLocalhost: boolean;
 *     originUsesLoopbackIp: boolean;
 *     recentOriginErrors: string[];
 *     recommendation: string | null;
 * }>}
 */
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
            recommendation: 'cloudflared log not found yet; run make copilot-mcp-restart and smoke after startup.',
        };
    }
    const recentOriginErrors = text
        .split(/\r?\n/u)
        .filter((line) => /origin|localhost:3333|\[::1\]:3333|connection refused|502|1033/iu.test(line))
        .slice(-8);
    const originUsesLocalhost = /http:\/\/localhost:3333|\[::1\]:3333/iu.test(text);
    const originUsesLoopbackIp = /http:\/\/127\.0\.0\.1:3333/iu.test(text);
    return {
        logFile: CLOUDFLARED_LOG_FILE,
        originUsesLocalhost,
        originUsesLoopbackIp,
        recentOriginErrors,
        recommendation: originUsesLocalhost
            ? 'Prefer Cloudflare public hostname service http://127.0.0.1:3333 instead of http://localhost:3333 to avoid IPv6 ::1 origin misses.'
            : null,
    };
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
    if (toolsList && typeof toolsList === 'object' && !Array.isArray(toolsList) && !includeRemoteToolNames) {
        const toolsListRecord = /** @type {Record<string, unknown>} */ (toolsList);
        delete toolsListRecord['remoteToolNames'];
        toolsListRecord['remoteToolNamesSuppressed'] = true;
    }
    return { ...report, toolsList };
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
    const child = spawn(process.execPath, ['src/copilot/mcp/cloudflare/cli.js', 'smoke'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            COPILOT_MCP_AUTH_MODE: process.env['COPILOT_MCP_AUTH_MODE'] ?? 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: process.env['COPILOT_MCP_AUTH_ENFORCEMENT'] ?? 'all',
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: config.publicMcpUrl,
            COPILOT_MCP_SMOKE_COMPACT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    /**
     * @param {string} current
     * @param {Buffer | string} chunk
     * @returns {string}
     */
    const appendBounded = (current, chunk) => `${current}${String(chunk)}`.slice(-CONNECTOR_SMOKE_OUTPUT_LIMIT);
    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
    }, CONNECTOR_SMOKE_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout.on('data', (chunk) => {
        stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
        stderr = appendBounded(stderr, chunk);
    });
    const exit = await new Promise((resolve) => {
        child.on('error', (error) => resolve({ code: null, signal: null, error }));
        child.on('close', (code, signal) => resolve({ code, signal, error: null }));
    });
    clearTimeout(timeout);
    if (timedOut) {
        return errorResult('Cloudflare connector smoke refresh timed out.', {
            code: 'ERR_CONNECTOR_SMOKE_TIMEOUT',
            timeoutMs: CONNECTOR_SMOKE_TIMEOUT_MS,
            connectorUrl: config.publicMcpUrl,
            stderrTail: stderr.slice(-8000),
        });
    }
    if (exit.error instanceof Error) {
        return errorResult('Cloudflare connector smoke refresh failed to start.', {
            code: 'ERR_CONNECTOR_SMOKE_START_FAILED',
            error: exit.error.message,
        });
    }
    let parsed;
    try {
        parsed = parseConnectorSmokeJsonOutput(stdout);
    } catch (error) {
        return errorResult('Cloudflare connector smoke refresh did not return JSON.', {
            code: 'ERR_CONNECTOR_SMOKE_INVALID_JSON',
            exitCode: exit.code,
            connectorUrl: config.publicMcpUrl,
            parseError: error instanceof Error ? error.message : String(error),
            stdoutTail: stdout.slice(-8000),
            stderrTail: stderr.slice(-8000),
        });
    }
    const compact = compactSmokeReport(parsed, includeRemoteToolNames);
    const ok = exit.code === 0 && Boolean(/** @type {Record<string, unknown>} */ (parsed)['ok']);
    if (!ok) {
        return errorResult('Cloudflare connector smoke refresh completed with failures.', {
            code: 'ERR_CONNECTOR_SMOKE_FAILED',
            exitCode: exit.code,
            signal: exit.signal,
            report: compact,
            stderrTail: stderr.slice(-8000),
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
        const connectorSmokeFresh =
            connectorSmoke.ok === true &&
            typeof connectorSmoke.ageMinutes === 'number' &&
            connectorSmoke.ageMinutes <= CONNECTOR_SMOKE_STALE_AFTER_MINUTES;
        const [mcpHttpProcess, cloudflaredProcess, localHealth] = await Promise.all([
            readPidFileStatus(config.mcpHttpPidFile),
            readPidFileStatus(config.managedTunnelPidFile),
            probeHealth(config.healthUrl),
        ]);
        const originDiagnostics = await readCloudflaredOriginDiagnostics();
        const permanentUrlReady =
            config.mode === 'named-permanent' && Boolean(config.publicMcpUrl) && publicUrlValidation?.ok === true;
        const ready =
            permanentUrlReady &&
            mcpHttpProcess.alive &&
            cloudflaredProcess.alive &&
            localHealth.ok &&
            connectorSmokeFresh;
        const nextActions = [];
        if (!permanentUrlReady)
            nextActions.push('Fix COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or public hostname configuration.');
        if (!mcpHttpProcess.alive || !cloudflaredProcess.alive || !localHealth.ok) {
            nextActions.push('Run make copilot-mcp-restart.');
        }
        if (!connectorSmokeFresh)
            nextActions.push('Run mcp_connector_smoke_refresh or make copilot-mcp-smoke-refresh.');
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
            originDiagnostics,
            connectorSmoke: {
                ...connectorSmoke,
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
