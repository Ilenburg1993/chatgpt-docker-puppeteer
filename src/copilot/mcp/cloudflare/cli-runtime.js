// @ts-check
/** Runtime lifecycle helpers for Cloudflare Tunnel + MCP HTTP origin. */
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { probeHealth } from './cli-probe.js';
import { createCloudflareManagedProcessController } from './cli-process.js';
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
    const processes = createCloudflareManagedProcessController(config);
    if (restart) {
        const stopResult = await stopManagedStackWithController(processes);
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
    const mcpHttp = await processes.mcpHttp.ensure({
        name: 'mcp-http',
        command: process.execPath,
        args: ['src/copilot/mcp/cli.js', '--transport', originTransport],
        env: buildMcpHttpEnvironment(config, originTransport, env),
    });
    const cloudflared = await processes.cloudflared.ensure({
        name: 'cloudflared',
        command: 'cloudflared',
        args: buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config),
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
    return stopManagedStackWithController(createCloudflareManagedProcessController(config));
}

/** @param {ReturnType<typeof createCloudflareManagedProcessController>} processes */
async function stopManagedStackWithController(processes) {
    const cloudflared = await processes.cloudflared.stop();
    const mcpHttp = await processes.mcpHttp.stop();
    return { ok: cloudflared.stopped && mcpHttp.stopped, cloudflared, mcpHttp };
}

/**
 * Observe a foreground cloudflared process until Node reports physical `close`.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<{ ok: boolean; exitCode: number | null; signal: NodeJS.Signals | null; error: string | null }>}
 */
export async function observeForegroundCloudflared(child) {
    let error = null;
    child.once('error', (spawnError) => {
        error = spawnError.message;
    });
    const observation = await createAttachedChildProcessSupervisor(child, { processGroup: false }).closed;
    return {
        ok: error === null && observation.exitCode === 0,
        exitCode: observation.exitCode,
        signal: observation.signal,
        error:
            error ??
            (observation.signal
                ? `cloudflared terminated by ${observation.signal}`
                : observation.exitCode === 0
                  ? null
                  : `cloudflared exited with ${String(observation.exitCode)}`),
    };
}

/**
 * @param {string[]} args
 * @param {import('./config.js').CloudflareTunnelTransportProtocol} protocol
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function runCloudflared(args, protocol, env = process.env) {
    const child = spawn('cloudflared', args, {
        stdio: 'inherit',
        env: buildCloudflaredEnvironment({ transportProtocol: protocol }, env),
    });
    return await observeForegroundCloudflared(child);
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ onStdout?: (chunk: string) => void; onConnectorUrl?: (url: string) => void }} [observers]
 */
export async function runQuickTunnel(config, env = process.env, observers = {}) {
    const child = spawn('cloudflared', buildQuickTunnelArgs(config), {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: buildCloudflaredEnvironment(config, env),
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
        const text = String(chunk);
        observers.onStdout?.(text);
        const found = extractTryCloudflareUrl(text);
        if (found) observers.onConnectorUrl?.(`${found}/mcp`);
    });
    return await observeForegroundCloudflared(child);
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

/** @param {import('./config.js').CloudflareTunnelConfig} config */
export function buildCloudflareLogReport(config) {
    return {
        mcpHttpLog: config.mcpHttpLogFile,
        cloudflaredLog: config.managedTunnelLogFile,
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
        logs: buildCloudflareLogReport(config),
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
    return buildMcpChildEnvironment({
        parentEnv: env,
        overrides: {
            TUNNEL_TRANSPORT_PROTOCOL: config.transportProtocol ?? env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'auto',
        },
    }).env;
}
