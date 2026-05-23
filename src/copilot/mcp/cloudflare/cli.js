// @ts-check
/**
 * Local Cloudflare Tunnel CLI for the Copilot MCP endpoint.
 *
 * @module copilot/mcp/cloudflare/cli
 */

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    } else if (command === 'up') {
        await runUp();
    } else if (command === 'down') {
        await runDown();
    } else if (command === 'run') {
        const config = readCloudflareTunnelConfig();
        runCloudflared(
            buildManagedTunnelArgs(process.env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile),
            config.transportProtocol,
        );
    } else {
        fail(`Unknown Cloudflare MCP command "${command}". Use doctor, quick, status, smoke, up, down, or run.`);
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
    const managedProcess = await readPidFileStatus(config.managedTunnelPidFile);
    const mcpHttpProcess = await readPidFileStatus(config.mcpHttpPidFile);
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
            mode: config.mode,
            tunnelName: config.tunnelName,
            zone: config.zone,
            publicHostname: config.publicHostname,
            tokenPresent: config.hasTunnelToken,
            tokenFilePresent: config.hasTunnelTokenFile,
            transportProtocol: config.transportProtocol,
            fixedDomainMode: config.mode === 'named-permanent',
            process: managedProcess,
            mcpHttpProcess,
        },
        temporaryTunnel,
        temporaryTunnelState: buildQuickTunnelStateReport(temporaryState),
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
            managedTokenFile:
                'CLOUDFLARE_TUNNEL_TOKEN_FILE=/run/secrets/cloudflared-token npm run copilot:mcp:cloudflare:run',
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
    const configuredPublicUrlValidation = validateConfiguredPublicUrl(config);
    const permanentOk = config.mode === 'named-permanent' && configuredPublicUrlValidation?.ok === true;
    const managedProcess = await readPidFileStatus(config.managedTunnelPidFile);
    const mcpHttpProcess = await readPidFileStatus(config.mcpHttpPidFile);
    const report = {
        ok:
            (permanentOk && managedProcess.alive === true && mcpHttpProcess.alive === true) ||
            (summary.stateValid && summary.processAlive),
        mode: config.mode,
        tunnelName: config.tunnelName,
        zone: config.zone,
        publicHostname: config.publicHostname,
        configuredPublicUrl: config.publicMcpUrl ?? null,
        configuredPublicUrlValidation: configuredPublicUrlValidation ?? null,
        permanentTunnel: {
            process: managedProcess,
            mcpHttpProcess,
        },
        stateFile: config.stateFile,
        originUrl: config.originUrl,
        localMcpUrl: config.localMcpUrl,
        processAlive: summary.processAlive,
        stalePolicy: {
            staleAfterMs: config.staleAfterMs,
            staleAfterMinutes: Math.round(config.staleAfterMs / 60000),
        },
        summary,
        state: buildQuickTunnelStateReport(state),
        chatgpt: isQuickTunnelState(state)
            ? {
                  name: state.chatgpt.name,
                  description: state.chatgpt.description,
                  mcpServerUrl: config.publicMcpUrl ?? state.connectorUrl,
                  authentication: state.chatgpt.authentication,
              }
            : {
                  name: 'Repo DevContainer MCP',
                  description:
                      'Conecta o ChatGPT ao repositório aberto no VS Code Dev Container por túnel Cloudflare permanente.',
                  mcpServerUrl: config.publicMcpUrl ?? null,
                  authentication: 'none-dev',
              },
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
        throw new Error('No Cloudflare connector URL found. Configure COPILOT_MCP_CLOUDFLARE_PUBLIC_URL or run the quick fallback.');
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
        'repo_root_redaction_status',
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
        'mcp_host_block_diagnostics',
        'mcp_maintenance_plan',
        'mcp_maintenance_apply_safe_fixes',
        'mcp_run_safe_validation_suite',
        'mcp_last_validation_summary',
        'run_copilot_validator',
        'job_list',
        'job_get_output',
        'mcp_runtime_health',
        'mcp_session_profile',
        'mcp_auth_profile',
        'mcp_autonomy_power_score',
        'mcp_oauth_issuer_diagnostics',
        'mcp_smoke_workspace',
        'mcp_tools_status',
        'mcp_tunnel_status',
        'chatgpt_connector_current_url_status',
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
    const stateUpdated =
        isQuickTunnelState(state) && connectorUrl === state.connectorUrl
            ? await updateQuickTunnelLastSmoke(config.stateFile, state, {
                  ...lastSmoke,
                  toolsList: persistedToolsListSummary,
              })
            : false;
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
 * @returns {Promise<void>}
 */
async function runUp() {
    const config = readCloudflareTunnelConfig();
    const mcpHttp = await ensureDetachedProcess({
        name: 'mcp-http',
        command: process.execPath,
        args: ['src/copilot/mcp/index.js', '--transport', 'http'],
        pidFile: config.mcpHttpPidFile,
        logFile: 'src/copilot/.ai/cloudflare/mcp-http.log',
        env: {
            COPILOT_MCP_PUBLIC_URL: config.publicMcpUrl ?? '',
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: config.publicMcpUrl ?? '',
            COPILOT_MCP_CLOUDFLARE_MODE: config.mode,
        },
    });
    const cloudflared = await ensureDetachedProcess({
        name: 'cloudflared',
        command: 'cloudflared',
        args: buildManagedTunnelArgs(process.env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile),
        pidFile: config.managedTunnelPidFile,
        logFile: 'src/copilot/.ai/cloudflare/cloudflared.log',
        env: {
            CLOUDFLARE_TUNNEL_TOKEN_FILE: config.tunnelTokenFile ?? '',
            TUNNEL_TRANSPORT_PROTOCOL: config.transportProtocol,
        },
    });
    process.stdout.write(
        `${JSON.stringify(
            {
                ok: true,
                mode: config.mode,
                publicMcpUrl: config.publicMcpUrl,
                mcpHttp,
                cloudflared,
                next: ['npm run copilot:mcp:cloudflare:status', 'npm run copilot:mcp:cloudflare:smoke'],
            },
            null,
            2,
        )}\n`,
    );
}

/**
 * @returns {Promise<void>}
 */
async function runDown() {
    const config = readCloudflareTunnelConfig();
    const cloudflared = await stopPidFileProcess(config.managedTunnelPidFile);
    const mcpHttp = await stopPidFileProcess(config.mcpHttpPidFile);
    process.stdout.write(`${JSON.stringify({ ok: true, cloudflared, mcpHttp }, null, 2)}\n`);
}

/**
 * @param {{
 *   name: string;
 *   command: string;
 *   args: string[];
 *   pidFile: string;
 *   logFile: string;
 *   env?: Record<string, string>;
 * }} options
 * @returns {Promise<{ name: string; pidFile: string; logFile: string; metadataFile: string; pid: number | null; alreadyRunning: boolean; restarted: boolean; restartReason: string | null }>}
 */
async function ensureDetachedProcess(options) {
    const metadataFile = `${options.pidFile}.json`;
    const signature = buildProcessSignature(options);
    const existing = await readPidFileStatus(options.pidFile);
    if (existing.alive) {
        const metadata = await readProcessMetadata(metadataFile);
        if (metadata?.signature && JSON.stringify(metadata.signature) === JSON.stringify(signature)) {
            return {
                name: options.name,
                pidFile: options.pidFile,
                logFile: options.logFile,
                metadataFile,
                pid: existing.pid,
                alreadyRunning: true,
                restarted: false,
                restartReason: null,
            };
        }
        const stopped = await stopPidFileProcess(options.pidFile);
        if (stopped.wasAlive && !stopped.stopped) {
            throw new Error(`Could not restart ${options.name}: ${stopped.error ?? 'process did not stop'}`);
        }
    }
    await mkdir(path.dirname(options.pidFile), { recursive: true });
    await mkdir(path.dirname(options.logFile), { recursive: true });
    const out = openSync(options.logFile, 'a');
    const child = spawn(options.command, options.args, {
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env, ...(options.env ?? {}) },
    });
    child.unref();
    closeSync(out);
    await writeFile(options.pidFile, `${child.pid ?? 0}\n`, 'utf8');
    await writeFile(
        metadataFile,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                name: options.name,
                pid: child.pid ?? null,
                startedAt: new Date().toISOString(),
                signature,
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    return {
        name: options.name,
        pidFile: options.pidFile,
        logFile: options.logFile,
        metadataFile,
        pid: child.pid ?? null,
        alreadyRunning: false,
        restarted: existing.alive,
        restartReason: existing.alive ? 'configuration-changed-or-metadata-missing' : null,
    };
}

/**
 * @param {string} metadataFile
 * @returns {Promise<{ signature?: unknown } | null>}
 */
async function readProcessMetadata(metadataFile) {
    try {
        const parsed = JSON.parse(await readFile(metadataFile, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * @param {{
 *   name: string;
 *   command: string;
 *   args: string[];
 *   env?: Record<string, string>;
 * }} options
 * @returns {{ name: string; command: string; args: string[]; env: Record<string, string> }}
 */
function buildProcessSignature(options) {
    return {
        name: options.name,
        command: options.command,
        args: redactCommandArgs(options.args),
        env: Object.fromEntries(Object.entries(options.env ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    };
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function redactCommandArgs(args) {
    return args.map((arg, index) => {
        const previous = args[index - 1];
        if (previous === '--token') return '<redacted>';
        if (arg.startsWith('--token=')) return '--token=<redacted>';
        return arg;
    });
}

/**
 * @param {import('./state.js').QuickTunnelState | { error: string } | undefined} state
 * @returns {unknown}
 */
function buildQuickTunnelStateReport(state) {
    if (!state) return 'not-created';
    if (!isQuickTunnelState(state)) return state;
    if (!state.lastSmoke || state.lastSmoke.connectorUrl === state.connectorUrl) return state;
    return {
        ...state,
        lastSmoke: {
            ignored: true,
            reason: 'connector-url-mismatch',
            connectorUrl: state.lastSmoke.connectorUrl,
            expectedConnectorUrl: state.connectorUrl,
        },
    };
}

/**
 * @param {string} pidFile
 * @returns {Promise<{ pidFile: string; pid: number | null; stopped: boolean; wasAlive: boolean; error: string | null }>}
 */
async function stopPidFileProcess(pidFile) {
    const status = await readPidFileStatus(pidFile);
    const metadataFile = `${pidFile}.json`;
    if (!status.pid) {
        await rm(metadataFile, { force: true });
        return { pidFile, pid: null, stopped: false, wasAlive: false, error: status.error };
    }
    if (!status.alive) {
        await rm(pidFile, { force: true });
        await rm(metadataFile, { force: true });
        return { pidFile, pid: status.pid, stopped: false, wasAlive: false, error: status.error };
    }
    try {
        process.kill(status.pid, 'SIGTERM');
        await rm(pidFile, { force: true });
        await rm(metadataFile, { force: true });
        return { pidFile, pid: status.pid, stopped: true, wasAlive: true, error: null };
    } catch (error) {
        return {
            pidFile,
            pid: status.pid,
            stopped: false,
            wasAlive: true,
            error: error instanceof Error ? error.message : String(error),
        };
    }
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
