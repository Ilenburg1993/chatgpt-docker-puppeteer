// @ts-check
/** Runtime lifecycle helpers for Cloudflare Tunnel + MCP HTTP origin. */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { buildManagedTunnelArgs, buildQuickTunnelArgs, extractTryCloudflareUrl } from './config.js';
import { ensureDetachedProcess, readPidFileStatus, readProcessMetadata, stopPidFileProcess } from './cli-process.js';
import { probeHealth } from './cli-probe.js';

export function selectMcpOriginTransport(config, env = process.env) {
    const explicit = String(env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '').trim().toLowerCase();
    if (['http', 'http1', 'http1.1'].includes(explicit)) return 'http';
    if (['http2', 'h2', 'https-h2'].includes(explicit)) return 'http2';
    return config.originTransport;
}

export async function startManagedStack({ config, env = process.env, restart = false }) {
    const originTransport = selectMcpOriginTransport(config, env);
    if (restart) await stopManagedStack(config);
    const mcpHttp = await ensureDetachedProcess({ name: 'mcp-http', command: process.execPath, args: ['src/copilot/mcp/cli.js', '--transport', originTransport], pidFile: config.mcpHttpPidFile, logFile: 'src/copilot/.ai/cloudflare/mcp-http.log', env: buildMcpHttpEnvironment(config, originTransport, env) });
    const cloudflared = await ensureDetachedProcess({ name: 'cloudflared', command: 'cloudflared', args: buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config), pidFile: config.managedTunnelPidFile, logFile: 'src/copilot/.ai/cloudflare/cloudflared.log', env: buildCloudflaredEnvironment(config, env) });
    return { ok: true, mode: config.mode, publicMcpUrl: config.publicMcpUrl, originTransport, mcpHttp, cloudflared, runtime: buildRuntimeReport(config, originTransport, env) };
}

export async function stopManagedStack(config) {
    return { ok: true, cloudflared: await stopPidFileProcess(config.managedTunnelPidFile), mcpHttp: await stopPidFileProcess(config.mcpHttpPidFile) };
}

export function runCloudflared(args, protocol, env = process.env) {
    const child = spawn('cloudflared', args, { stdio: 'inherit', env: buildCloudflaredEnvironment({ transportProtocol: protocol }, env) });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

export function runQuickTunnel(config, env = process.env) {
    const child = spawn('cloudflared', buildQuickTunnelArgs(config), { stdio: ['ignore', 'pipe', 'inherit'], env: buildCloudflaredEnvironment(config, env) });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        const found = extractTryCloudflareUrl(String(chunk));
        if (found) process.stderr.write(`[copilot-mcp-cloudflare] quick tunnel URL: ${found}/mcp\n`);
    });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

export async function readRuntimeOriginSummary(config, env = process.env) {
    const originTransport = selectMcpOriginTransport(config, env);
    const health = await probeHealth(config.healthUrl);
    return { ok: health.ok, originTransport, health, report: buildRuntimeReport(config, originTransport, env) };
}

export async function buildOriginRuntimeReport(config, originTransport = selectMcpOriginTransport(config), env = process.env) {
    return buildRuntimeReport(config, originTransport, env);
}

export function buildCloudflareLogReport() {
    return { mcpHttpLog: 'src/copilot/.ai/cloudflare/mcp-http.log', cloudflaredLog: 'src/copilot/.ai/cloudflare/cloudflared.log' };
}

export function buildCloudflareMetricsReport(config) {
    return { enabled: Boolean(config.metricsAddr), address: config.metricsAddr ?? null, url: config.metricsAddr ? `http://${config.metricsAddr}/metrics` : null };
}

function buildRuntimeReport(config, originTransport, env) {
    return { originUrl: config.originUrl, healthUrl: config.healthUrl, localMcpUrl: config.localMcpUrl, publicMcpUrl: config.publicMcpUrl ?? null, originTransport, edgeTransportProtocol: config.transportProtocol, metrics: buildCloudflareMetricsReport(config), logs: buildCloudflareLogReport(), authMode: env['COPILOT_MCP_AUTH_MODE'] ?? null };
}

function buildMcpHttpEnvironment(config, originTransport, env) {
    return { ...env, COPILOT_MCP_ORIGIN_TRANSPORT: originTransport, COPILOT_MCP_HTTP_PORT: new URL(config.originUrl).port || '3333' };
}

function buildCloudflaredEnvironment(config, env) {
    return { ...env, TUNNEL_TRANSPORT_PROTOCOL: config.transportProtocol ?? env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'http2' };
}

export { readPidFileStatus, readProcessMetadata };
