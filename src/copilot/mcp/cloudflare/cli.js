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
import { getCanonicalMcpTools } from '../registry.js';
import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    buildTemporaryConnectorUrl,
    extractTryCloudflareUrl,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from './config.js';
import {
    isQuickTunnelState,
    readQuickTunnelState,
    summarizeQuickTunnelState,
    updateQuickTunnelLastSmoke,
} from './state.js';

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
        fail(`Unknown Cloudflare MCP command "${command}". Use doctor, quick, status, smoke, or run.`);
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
    const temporaryState = await readQuickTunnelState(config.stateFile);
    const temporaryTunnel = summarizeQuickTunnelState(temporaryState, Date.now(), config.staleAfterMs);
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
        temporaryTunnel,
        temporaryTunnelState: temporaryState ?? 'not-created',
        stalePolicy: {
            staleAfterMs: config.staleAfterMs,
            staleAfterMinutes: Math.round(config.staleAfterMs / 60000),
        },
        chatgpt: {
            publicMcpUrl: config.publicMcpUrl ?? temporaryTunnel.connectorUrl ?? 'not-configured',
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
    const summary = summarizeQuickTunnelState(state, Date.now(), config.staleAfterMs);
    const report = {
        ok: summary.stateValid && summary.processAlive,
        stateFile: config.stateFile,
        originUrl: config.originUrl,
        localMcpUrl: config.localMcpUrl,
        processAlive: summary.processAlive,
        stalePolicy: {
            staleAfterMs: config.staleAfterMs,
            staleAfterMinutes: Math.round(config.staleAfterMs / 60000),
        },
        summary,
        state: state ?? 'not-created',
        chatgpt: isQuickTunnelState(state)
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
    const remoteToolNames = extractMcpToolNames(toolsList.body);
    const localToolNames = getCanonicalMcpTools()
        .map((tool) => tool.name)
        .sort((left, right) => left.localeCompare(right));
    const criticalToolNames = [
        'repo_status',
        'repo_tree',
        'repo_root_tree',
        'repo_read_file',
        'repo_read_file_chunks',
        'repo_file_stats',
        'repo_search_text',
        'repo_find_symbol_usages',
        'repo_symbol_search',
        'repo_file_outline',
        'repo_patch_plan',
        'repo_create_file_plan',
        'repo_quarantine_file_plan',
        'repo_move_file_plan',
        'repo_index_refresh_plan',
        'mcp_validation_plan',
        'repo_index_status',
        'project_doctor',
        'delegate_to_repo_autonomy_runner',
        'mcp_golden_prompts',
        'mcp_maintenance_plan',
        'mcp_maintenance_apply_safe_fixes',
        'mcp_run_safe_validation_suite',
        'run_copilot_validator',
        'job_list',
        'job_get_output',
        'mcp_runtime_health',
        'mcp_session_profile',
        'mcp_smoke_workspace',
        'mcp_tools_status',
        'mcp_tunnel_status',
    ];
    const missingCriticalTools = criticalToolNames.filter((toolName) => !remoteToolNames.includes(toolName));
    const missingLocalTools = localToolNames.filter((toolName) => !remoteToolNames.includes(toolName));
    const unexpectedRemoteTools = remoteToolNames.filter((toolName) => !localToolNames.includes(toolName));
    const toolsMatchLocalRegistry = missingLocalTools.length === 0 && unexpectedRemoteTools.length === 0;
    const criticalToolsPresent = missingCriticalTools.length === 0;
    const ok =
        health.ok && toolsList.ok && remoteToolNames.length > 0 && toolsMatchLocalRegistry && criticalToolsPresent;
    const healthSummary = {
        ok: health.ok,
        ...(health.status !== undefined ? { status: health.status } : {}),
        ...(health.error ? { error: health.error } : {}),
        body: health.body,
    };
    const toolsListSummary = {
        ok: toolsList.ok,
        ...(toolsList.status !== undefined ? { status: toolsList.status } : {}),
        ...(toolsList.error ? { error: toolsList.error } : {}),
        tools: remoteToolNames.length,
        expectedLocalTools: localToolNames.length,
        toolsMatchLocalRegistry,
        criticalToolsPresent,
        missingCriticalTools,
        missingLocalTools,
        unexpectedRemoteTools,
        remoteToolNames,
    };
    const persistedToolsListSummary = {
        ok: toolsList.ok,
        ...(toolsList.status !== undefined ? { status: toolsList.status } : {}),
        ...(toolsList.error ? { error: toolsList.error } : {}),
        tools: remoteToolNames.length,
        expectedLocalTools: localToolNames.length,
        toolsMatchLocalRegistry,
        criticalToolsPresent,
        missingCriticalTools,
        missingLocalTools,
        unexpectedRemoteTools,
    };
    const lastSmoke = {
        checkedAt: new Date().toISOString(),
        ok,
        connectorUrl,
        health: healthSummary,
        toolsList: toolsListSummary,
    };
    const stateUpdated = await updateQuickTunnelLastSmoke(config.stateFile, state, {
        ...lastSmoke,
        toolsList: persistedToolsListSummary,
    });
    const report = {
        ok,
        connectorUrl,
        stateUpdated,
        health: healthSummary,
        toolsList: toolsListSummary,
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
 * @param {unknown} body
 * @returns {string[]}
 */
function extractMcpToolNames(body) {
    if (!body || typeof body !== 'object') return [];
    if (!('result' in body) || !body.result || typeof body.result !== 'object') return [];
    if (!('tools' in body.result) || !Array.isArray(body.result.tools)) return [];
    return body.result.tools
        .map((tool) => {
            if (!tool || typeof tool !== 'object') return undefined;
            if (!('name' in tool) || typeof tool.name !== 'string') return undefined;
            return tool.name;
        })
        .filter((toolName) => typeof toolName === 'string')
        .sort((left, right) => left.localeCompare(right));
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
