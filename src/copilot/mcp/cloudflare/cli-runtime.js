// @ts-check
/** Runtime lifecycle helpers for Cloudflare Tunnel + MCP HTTP origin. */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { probeHealth } from './cli-probe.js';
import { ensureDetachedProcess, readPidFileStatus, readProcessMetadata, stopPidFileProcess } from './cli-process.js';
import { buildManagedTunnelArgs, buildQuickTunnelArgs, extractTryCloudflareUrl } from './config.js';

/**
 * @param {import('./config.js').CloudflareTunnelConfig | { originTransport?: import('./config.js').McpOriginTransport }} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./config.js').McpOriginTransport}
 */
export function selectMcpOriginTransport(config, env = process.env) {
    const explicit = String(env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '')
        .trim()
        .toLowerCase();
    if (['http', 'http1', 'http1.1'].includes(explicit)) return 'http';
    if (['http2', 'h2', 'https-h2'].includes(explicit)) return 'http2';
    return config.originTransport ?? 'http2';
}

/**
 * @param {{ config: import('./config.js').CloudflareTunnelConfig; env?: NodeJS.ProcessEnv; restart?: boolean }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function startManagedStack({ config, env = process.env, restart = false }) {
    const originTransport = selectMcpOriginTransport(config, env);
    if (restart) {
        const stopResult = await stopManagedStack(config);
        if (stopResult['ok'] !== true) {
            return {
                ok: false,
                mode: config.mode,
                publicMcpUrl: config.publicMcpUrl,
                originTransport,
                stopped: stopResult,
                error: 'managed-stack-stop-failed',
            };
        }
    }
    const mcpHttp = await ensureDetachedProcess({
        name: 'mcp-http',
        command: process.execPath,
        args: ['src/copilot/mcp/cli.js', '--transport', originTransport],
        pidFile: config.mcpHttpPidFile,
        logFile: 'src/copilot/.ai/cloudflare/mcp-http.log',
        env: buildMcpHttpEnvironment(config, originTransport, env),
    });
    const cloudflared = await ensureDetachedProcess({
        name: 'cloudflared',
        command: 'cloudflared',
        args: buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config),
        pidFile: config.managedTunnelPidFile,
        logFile: 'src/copilot/.ai/cloudflare/cloudflared.log',
        env: buildCloudflaredEnvironment(config, env),
    });
    return {
        ok: true,
        mode: config.mode,
        publicMcpUrl: config.publicMcpUrl,
        originTransport,
        mcpHttp,
        cloudflared,
        runtime: buildRuntimeReport(config, originTransport, env),
    };
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
export async function stopManagedStack(config) {
    const cloudflared = await stopPidFileProcess(config.managedTunnelPidFile);
    const mcpHttp = await stopPidFileProcess(config.mcpHttpPidFile);
    return { ok: cloudflared.stopped && mcpHttp.stopped, cloudflared, mcpHttp };
}

/**
 * @param {string[]} args
 * @param {import('./config.js').CloudflareTunnelTransportProtocol} protocol
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function runCloudflared(args, protocol, env = process.env) {
    const child = spawn('cloudflared', args, {
        stdio: 'inherit',
        env: buildCloudflaredEnvironment({ transportProtocol: protocol }, env),
    });
    child.on('exit', (code) => {
        process.exitCode = code ?? 1;
    });
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function runQuickTunnel(config, env = process.env) {
    const child = spawn('cloudflared', buildQuickTunnelArgs(config), {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: buildCloudflaredEnvironment(config, env),
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        const found = extractTryCloudflareUrl(String(chunk));
        if (found) process.stderr.write(`[copilot-mcp-cloudflare] quick tunnel URL: ${found}/mcp\n`);
    });
    child.on('exit', (code) => {
        process.exitCode = code ?? 1;
    });
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readRuntimeOriginSummary(config, env = process.env) {
    const originTransport = selectMcpOriginTransport(config, env);
    const health = await probeHealth(config.healthUrl, buildLocalOriginHealthProbeOptions(config));
    return { ok: health.ok, originTransport, health, report: buildRuntimeReport(config, originTransport, env) };
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {import('./config.js').McpOriginTransport} [originTransport]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildOriginRuntimeReport(
    config,
    originTransport = selectMcpOriginTransport(config),
    env = process.env,
) {
    return buildRuntimeReport(config, originTransport, env);
}

/** @returns {{ mcpHttpLog: string; cloudflaredLog: string }} */
export function buildCloudflareLogReport() {
    return {
        mcpHttpLog: 'src/copilot/.ai/cloudflare/mcp-http.log',
        cloudflaredLog: 'src/copilot/.ai/cloudflare/cloudflared.log',
    };
}

/**
 * @param {{ metricsAddr?: string | undefined }} config
 * @returns {{ enabled: boolean; address: string | null; url: string | null }}
 */
export function buildCloudflareMetricsReport(config) {
    return {
        enabled: Boolean(config.metricsAddr),
        address: config.metricsAddr ?? null,
        url: config.metricsAddr ? `http://${config.metricsAddr}/metrics` : null,
    };
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @returns {{ allowInsecureHttps?: true; servername?: string }}
 */
function buildLocalOriginHealthProbeOptions(config) {
    return config.originUrl.startsWith('https://127.0.0.1') || config.originUrl.startsWith('https://localhost')
        ? { allowInsecureHttps: true, servername: config.originServerName ?? config.publicHostname }
        : {};
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {import('./config.js').McpOriginTransport} originTransport
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, unknown>}
 */
function buildRuntimeReport(config, originTransport, env) {
    return {
        originUrl: config.originUrl,
        healthUrl: config.healthUrl,
        localMcpUrl: config.localMcpUrl,
        publicMcpUrl: config.publicMcpUrl ?? null,
        originTransport,
        edgeTransportProtocol: config.transportProtocol,
        metrics: buildCloudflareMetricsReport(config),
        logs: buildCloudflareLogReport(),
        authMode: env['COPILOT_MCP_AUTH_MODE'] ?? null,
    };
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {import('./config.js').McpOriginTransport} originTransport
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function buildMcpHttpEnvironment(config, originTransport, env) {
    return {
        ...env,
        COPILOT_MCP_ORIGIN_TRANSPORT: originTransport,
        COPILOT_MCP_HTTP_PORT: new URL(config.originUrl).port || '3333',
    };
}

/**
 * @param {{ transportProtocol?: import('./config.js').CloudflareTunnelTransportProtocol }} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function buildCloudflaredEnvironment(config, env) {
    return {
        ...env,
        TUNNEL_TRANSPORT_PROTOCOL: config.transportProtocol ?? env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'auto',
    };
}

export { readPidFileStatus, readProcessMetadata };
