// @ts-check
/**
 * Local Cloudflare Tunnel CLI for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/cli
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
    buildTemporaryConnectorUrl,
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    extractTryCloudflareUrl,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from './config.js';
import { isProcessAlive, isQuickTunnelState, readQuickTunnelState } from './state.js';

const command = process.argv[2] ?? 'doctor';

try {
    if (command === 'doctor') {
        await runDoctor();
    } else if (command === 'quick') {
        const config = readCloudflareTunnelConfig();
        runQuickTunnel(config);
    } else if (command === 'status') {
        await runStatus();
    } else if (command === 'smoke') {
        await runSmoke();
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
            fixedDomainMode: false,
        },
        temporaryTunnel: await readQuickTunnelState(config.stateFile),
        chatgpt: {
            publicMcpUrl: config.publicMcpUrl ?? 'not-configured',
            publicUrlValidation: publicUrlValidation ?? 'not-configured',
        },
        commands: {
            quick: `TUNNEL_TRANSPORT_PROTOCOL=${config.transportProtocol} cloudflared ${buildQuickTunnelArgs(config).join(' ')}`,
            status: 'npm run copilot:mcp:cloudflare:status',
            smoke: 'npm run copilot:mcp:cloudflare:smoke',
            managed: `TUNNEL_TRANSPORT_PROTOCOL=${config.transportProtocol} cloudflared tunnel --no-autoupdate run --token <redacted>`,
        },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
}

/**
 * @returns {Promise<void>}
 */
async function runStatus() {
    const config = readCloudflareTunnelConfig();
    const state = await readQuickTunnelState(config.stateFile);
    const hasState = isQuickTunnelState(state);
    const processAlive = hasState ? isProcessAlive(state.pid) : false;
    const report = {
        ok: hasState && processAlive,
        stateFile: config.stateFile,
        processAlive,
        state: state ?? 'not-created',
        chatgpt: hasState
            ? {
                  name: state.chatgpt.name,
                  description: state.chatgpt.description,
                  mcpServerUrl: state.connectorUrl,
                  authentication: state.chatgpt.authentication,
              }
            : 'not-created',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
}

/**
 * @returns {Promise<void>}
 */
async function runSmoke() {
    const config = readCloudflareTunnelConfig();
    const state = await readQuickTunnelState(config.stateFile);
    const connectorUrl = config.publicMcpUrl ?? (isQuickTunnelState(state) ? state.connectorUrl : undefined);
    if (!connectorUrl) {
        throw new Error('No temporary Cloudflare connector URL found. Run npm run copilot:mcp:cloudflare:quick first.');
    }
    const baseUrl = connectorUrl.replace(/\/mcp$/, '');
    const health = await probeJson(`${baseUrl}/health`, { method: 'GET' });
    const toolsList = await probeJson(connectorUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const tools = countMcpTools(toolsList.body);
    const report = {
        ok: health.ok && toolsList.ok && tools > 0,
        connectorUrl,
        health: { ok: health.ok, status: health.status, body: health.body },
        toolsList: { ok: toolsList.ok, status: toolsList.status, tools },
        chatgpt: {
            mcpServerUrl: connectorUrl,
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
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }>}
 */
async function probeJson(url, init) {
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
        const text = await response.text();
        let body = undefined;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = text;
        }
        return { ok: response.ok, status: response.status, body };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @returns {void}
 */
function runQuickTunnel(config) {
    const child = spawn('cloudflared', buildQuickTunnelArgs(config), {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, TUNNEL_TRANSPORT_PROTOCOL: config.transportProtocol },
    });
    let capturedUrl = '';
    const onChunk = (/** @type {Buffer | string} */ chunk, /** @type {NodeJS.WriteStream} */ stream) => {
        const text = String(chunk);
        stream.write(text);
        if (capturedUrl) return;
        const publicBaseUrl = extractTryCloudflareUrl(text);
        if (!publicBaseUrl) return;
        capturedUrl = publicBaseUrl;
        void writeQuickTunnelState(config, publicBaseUrl, child.pid ?? null).catch((error) => {
            process.stderr.write(`[copilot-mcp-cloudflare] Failed to write quick tunnel state: ${error.message}\n`);
        });
    };
    child.stdout.on('data', (chunk) => onChunk(chunk, process.stdout));
    child.stderr.on('data', (chunk) => onChunk(chunk, process.stderr));
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
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {string} publicBaseUrl
 * @param {number | null} pid
 * @returns {Promise<void>}
 */
async function writeQuickTunnelState(config, publicBaseUrl, pid) {
    const connectorUrl = buildTemporaryConnectorUrl(publicBaseUrl);
    const state = {
        schemaVersion: 1,
        mode: 'temporary-trycloudflare',
        createdAt: new Date().toISOString(),
        pid,
        originUrl: config.originUrl,
        publicBaseUrl,
        connectorUrl,
        transportProtocol: config.transportProtocol,
        stateFile: config.stateFile,
        chatgpt: {
            name: 'Repo DevContainer MCP',
            description:
                'Conecta o ChatGPT ao repositório aberto no VS Code Dev Container. Permite ler arquivos, buscar no código, inspecionar Git, executar validadores controlados e operar o workspace por tools MCP auditáveis.',
            mcpServerUrl: connectorUrl,
            authentication: 'none-dev',
        },
        smokeCommand: 'npm run copilot:mcp:cloudflare:smoke',
    };
    await mkdir(path.dirname(config.stateFile), { recursive: true });
    await writeFile(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    process.stderr.write(
        `\n[copilot-mcp-cloudflare] Temporary ChatGPT MCP URL: ${connectorUrl}\n` +
            `[copilot-mcp-cloudflare] Session state: ${config.stateFile}\n` +
            '[copilot-mcp-cloudflare] Next terminal: npm run copilot:mcp:cloudflare:smoke\n\n',
    );
}

/**
 * @param {string} stateFile
 * @returns {Promise<unknown | undefined>}
 */
/**
 * @param {unknown} body
 * @returns {number}
 */
function countMcpTools(body) {
    if (!body || typeof body !== 'object') return 0;
    if (!('result' in body) || !body.result || typeof body.result !== 'object') return 0;
    if (!('tools' in body.result) || !Array.isArray(body.result.tools)) return 0;
    return body.result.tools.length;
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
