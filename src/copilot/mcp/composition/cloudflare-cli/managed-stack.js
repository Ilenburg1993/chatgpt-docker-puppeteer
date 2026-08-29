// @ts-check
/** Cross-owner managed stack composition for Cloudflare Tunnel + MCP HTTP origin. */
import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    extractTryCloudflareUrl,
} from '#copilot/mcp/public/cloudflare/config';
import { probeHealth } from '#copilot/mcp/public/cloudflare/observability';
import { createCloudflareManagedProcessController } from '#copilot/mcp/public/cloudflare/process';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/infra/public/process/supervision';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { buildMcpServerChildEnvironment } from './server-child-environment.js';

const DEFAULT_MANAGED_ORIGIN_READY_TIMEOUT_MS = 180_000;
const DEFAULT_MANAGED_PUBLIC_READY_TIMEOUT_MS = 45_000;
const DEFAULT_MANAGED_READY_POLL_INTERVAL_MS = 250;
const DEFAULT_MANAGED_READY_PROBE_TIMEOUT_MS = 2_000;

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig | { originTransport?: import('#copilot/mcp/public/cloudflare/config').McpOriginTransport }} config
 * @returns {import('#copilot/mcp/public/cloudflare/config').McpOriginTransport}
 */
export function selectMcpOriginTransport(config) {
    return config.originTransport ?? 'http2';
}

/**
 * @param {{ config: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig; env: NodeJS.ProcessEnv; restart?: boolean }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function startManagedStack({ config, env, restart = false }) {
    if (!env) throw new TypeError('Managed Cloudflare stack requires explicit env.');
    const originTransport = selectMcpOriginTransport(config);
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
        args: ['src/copilot/mcp/cli/index.js', '--transport', originTransport],
        env: buildMcpHttpEnvironment(config, originTransport, env),
    });
    const originReadiness = await waitForManagedHealthReady(config.healthUrl, {
        timeoutMs: DEFAULT_MANAGED_ORIGIN_READY_TIMEOUT_MS,
        probeOptions: buildLocalOriginHealthProbeOptions(config),
    });
    if (!originReadiness.ok) {
        const cleanup = mcpHttp.alreadyRunning ? null : await processes.mcpHttp.stop();
        return {
            ok: false,
            mode: config.mode,
            publicMcpUrl: config.publicMcpUrl,
            originTransport,
            mcpHttp,
            originReadiness,
            cleanup,
            error: 'managed-origin-not-ready',
        };
    }

    const cloudflared = await processes.cloudflared.ensure({
        name: 'cloudflared',
        command: 'cloudflared',
        args: buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config),
        env: buildCloudflaredEnvironment(config, env),
    });
    const publicHealthUrl = resolveManagedPublicHealthUrl(config);
    const publicReadiness = publicHealthUrl
        ? await waitForManagedHealthReady(publicHealthUrl, { timeoutMs: DEFAULT_MANAGED_PUBLIC_READY_TIMEOUT_MS })
        : {
              ok: true,
              skipped: true,
              reason: 'public-health-url-unavailable',
              attempts: 0,
              durationMs: 0,
              lastProbe: null,
          };
    return {
        ok: publicReadiness.ok,
        mode: config.mode,
        publicMcpUrl: config.publicMcpUrl,
        originTransport,
        mcpHttp,
        cloudflared,
        originReadiness,
        publicReadiness,
        ...(publicReadiness.ok ? {} : { error: 'managed-public-endpoint-not-ready' }),
        runtime: buildRuntimeReport(config, originTransport, env),
    };
}

/**
 * Wait until one managed health endpoint is actually reachable. Process existence is intentionally insufficient:
 * detached Node startup can spend significant time preparing the process host before the listener binds.
 *
 * @param {string} url
 * @param {{
 *     timeoutMs?: number;
 *     pollIntervalMs?: number;
 *     probeTimeoutMs?: number;
 *     probeOptions?: { allowInsecureHttps?: boolean; servername?: string };
 *     probe?: typeof probeHealth;
 *     sleep?: (delayMs: number) => Promise<void>;
 *     now?: () => number;
 * }} [options]
 */
export async function waitForManagedHealthReady(url, options = {}) {
    const timeoutMs = normalizeManagedReadyDuration(
        options.timeoutMs,
        DEFAULT_MANAGED_ORIGIN_READY_TIMEOUT_MS,
        1,
        10 * 60 * 1000,
    );
    const pollIntervalMs = normalizeManagedReadyDuration(
        options.pollIntervalMs,
        DEFAULT_MANAGED_READY_POLL_INTERVAL_MS,
        1,
        10_000,
    );
    const probeTimeoutMs = normalizeManagedReadyDuration(
        options.probeTimeoutMs,
        DEFAULT_MANAGED_READY_PROBE_TIMEOUT_MS,
        1,
        30_000,
    );
    const probe = options.probe ?? probeHealth;
    const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    const now = options.now ?? Date.now;
    const startedAt = now();
    let attempts = 0;
    /** @type {Awaited<ReturnType<typeof probeHealth>>} */
    let lastProbe;

    while (true) {
        const elapsedBeforeProbe = Math.max(0, now() - startedAt);
        const remainingBeforeProbe = Math.max(1, timeoutMs - elapsedBeforeProbe);
        attempts += 1;
        lastProbe = await probe(url, {
            ...(options.probeOptions ?? {}),
            timeoutMs: Math.min(probeTimeoutMs, remainingBeforeProbe),
        });
        const durationMs = Math.max(0, now() - startedAt);
        if (lastProbe.ok) return { ok: true, attempts, durationMs, lastProbe };
        if (durationMs >= timeoutMs) return { ok: false, attempts, durationMs, lastProbe };
        await sleep(Math.min(pollIntervalMs, timeoutMs - durationMs));
    }
}

/** @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config */
export function resolveManagedPublicHealthUrl(config) {
    if (config.publicMcpUrl) return new URL('/health', config.publicMcpUrl).toString();
    const hostname = String(config.publicHostname ?? '').trim();
    return hostname ? `https://${hostname}/health` : null;
}

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function normalizeManagedReadyDuration(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
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
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelTransportProtocol} protocol
 * @param {NodeJS.ProcessEnv} env
 */
export async function runCloudflared(args, protocol, env) {
    if (!env) throw new TypeError('Foreground cloudflared execution requires explicit env.');
    const child = spawn('cloudflared', args, {
        stdio: 'inherit',
        env: buildCloudflaredEnvironment({ transportProtocol: protocol }, env),
    });
    return await observeForegroundCloudflared(child);
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @param {{ onStdout?: (chunk: string) => void; onConnectorUrl?: (url: string) => void }} [observers]
 */
export async function runQuickTunnel(config, env, observers = {}) {
    if (!env) throw new TypeError('Quick tunnel execution requires explicit env.');
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
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readRuntimeOriginSummary(config, env) {
    if (!env) throw new TypeError('Runtime origin summary requires explicit env.');
    const originTransport = selectMcpOriginTransport(config);
    const health = await probeHealth(config.healthUrl, buildLocalOriginHealthProbeOptions(config));
    return { ok: health.ok, originTransport, health, report: buildRuntimeReport(config, originTransport, env) };
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {import('#copilot/mcp/public/cloudflare/config').McpOriginTransport} originTransport
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildOriginRuntimeReport(config, originTransport, env) {
    if (!env) throw new TypeError('Origin runtime report requires explicit env.');
    return buildRuntimeReport(config, originTransport, env);
}

/** @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config */
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
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @returns {{ allowInsecureHttps?: true; servername?: string }}
 */
function buildLocalOriginHealthProbeOptions(config) {
    return config.originUrl.startsWith('https://127.0.0.1') || config.originUrl.startsWith('https://localhost')
        ? { allowInsecureHttps: true, servername: config.originServerName ?? config.publicHostname }
        : {};
}

/**
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {import('#copilot/mcp/public/cloudflare/config').McpOriginTransport} originTransport
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
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {import('#copilot/mcp/public/cloudflare/config').McpOriginTransport} originTransport
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function buildMcpHttpEnvironment(config, originTransport, env) {
    return buildMcpServerChildEnvironment(env, {
        COPILOT_MCP_ORIGIN_TRANSPORT: originTransport,
        COPILOT_MCP_PORT: new URL(config.originUrl).port || '3333',
    });
}

/**
 * @param {{ transportProtocol?: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelTransportProtocol }} config
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
