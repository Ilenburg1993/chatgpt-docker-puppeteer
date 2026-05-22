// @ts-check
/**
 * Local Cloudflare Tunnel CLI for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/cli
 */

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from './config.js';

const command = process.argv[2] ?? 'doctor';

try {
    if (command === 'doctor') {
        await runDoctor();
    } else if (command === 'quick') {
        const config = readCloudflareTunnelConfig();
        runCloudflared(buildQuickTunnelArgs(config), config.transportProtocol);
    } else if (command === 'run') {
        const config = readCloudflareTunnelConfig();
        runCloudflared(buildManagedTunnelArgs(process.env['CLOUDFLARE_TUNNEL_TOKEN']), config.transportProtocol);
    } else {
        fail(`Unknown Cloudflare MCP command "${command}". Use doctor, quick, or run.`);
    }
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}

/**
 * @returns {Promise<void>}
 */
async function runDoctor() {
    const config = readCloudflareTunnelConfig();
    const cloudflared = readCloudflaredVersion();
    const health = await probeHealth(config.healthUrl);
    const publicUrlValidation = validateConfiguredPublicUrl(config);
    const report = {
        ok: cloudflared.ok && health.ok && publicUrlValidation?.ok !== false,
        cloudflared,
        localOrigin: {
            originUrl: config.originUrl,
            healthUrl: config.healthUrl,
            localMcpUrl: config.localMcpUrl,
            health,
        },
        managedTunnel: {
            tokenPresent: config.hasTunnelToken,
            transportProtocol: config.transportProtocol,
        },
        chatgpt: {
            publicMcpUrl: config.publicMcpUrl ?? 'not-configured',
            publicUrlValidation: publicUrlValidation ?? 'not-configured',
        },
        commands: {
            quick: `TUNNEL_TRANSPORT_PROTOCOL=${config.transportProtocol} cloudflared ${buildQuickTunnelArgs(config).join(' ')}`,
            managed: `TUNNEL_TRANSPORT_PROTOCOL=${config.transportProtocol} cloudflared tunnel --no-autoupdate run --token <redacted>`,
        },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
}

/**
 * @returns {{ ok: boolean; version?: string; error?: string }}
 */
function readCloudflaredVersion() {
    const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
        return { ok: false, error: result.stderr.trim() || `cloudflared exited with status ${result.status}` };
    }
    return { ok: true, version: result.stdout.trim() };
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
 * @param {string[]} args
 * @param {'auto' | 'http2' | 'quic'} transportProtocol
 * @returns {void}
 */
function runCloudflared(args, transportProtocol) {
    const child = spawn('cloudflared', args, {
        stdio: 'inherit',
        env: { ...process.env, TUNNEL_TRANSPORT_PROTOCOL: transportProtocol },
    });
    child.on('error', (error) => fail(error.message));
    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exitCode = code ?? 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(/** @type {NodeJS.Signals} */ (signal), () => child.kill(/** @type {NodeJS.Signals} */ (signal)));
    }
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
    process.stderr.write(`[copilot-mcp-cloudflare] ${message}\n`);
    process.exit(1);
}
