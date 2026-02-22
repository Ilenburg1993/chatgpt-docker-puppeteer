// @ts-check
/**
 * MCP Upstream Manager
 *
 * Imports tools from one or more upstream MCP servers and registers them
 * into the local Tool Registry with prefixes (namespaces).
 *
 * Supported transports:
 * - HTTP JSON-RPC 2.0 (Streamable HTTP fallback)
 * - Stdio (via MCP SDK client + StdioClientTransport)
 *
 * Backwards compatibility:
 * - MCP_UPSTREAM_ENABLED/MCP_UPSTREAM_URL/... (single HTTP upstream)
 * - GitHub proxy preset via MCP_GITHUB_PROXY_ENABLED (+ GITHUB_PERSONAL_ACCESS_TOKEN)
 */

import { createMcpHttpClient } from './upstream-http.mjs';
import { MCPStdioUpstreamClient } from './upstream-stdio-sdk.mjs';
import { computeExponentialBackoffDelay, readPositiveInt } from '../../core/retry_policy.js';

function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function normalizeAlias(alias) {
    const a = String(alias || '').trim();
    if (!a) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(a)) return null;
    return a;
}

function parseJsonObject(value) {
    if (!value) return null;
    const parsed = safeJsonParse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function parseJsonArray(value) {
    if (!value) return null;
    const parsed = safeJsonParse(String(value));
    return Array.isArray(parsed) ? parsed : null;
}

function sanitizeToolMetadata(tool) {
    const description =
        typeof tool?.description === 'string' && tool.description.trim()
            ? tool.description
            : '(no description provided by upstream)';

    const inputSchema =
        tool?.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {} };

    return { description, inputSchema };
}

/**
 * @typedef {object} UpstreamConfig
 * @property {string} alias
 * @property {'http'|'stdio'} transport
 * @property {string} toolPrefix
 * @property {boolean} [required]
 * @property {string} [url]
 * @property {Record<string,string>} [headers]
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {string[]} [envFrom]
 * @property {number} [initTimeoutMs]
 * @property {number} [callTimeoutMs]
 */

/**
 * @typedef {object} UpstreamStatus
 * @property {string} alias
 * @property {'http'|'stdio'} transport
 * @property {string} toolPrefix
 * @property {string} target
 * @property {boolean} enabled
 * @property {boolean} required
 * @property {boolean} ready
 * @property {number} registeredCount
 * @property {string | null} lastInitAt
 * @property {string | null} lastError
 * @property {'ready'|'not-ready'|'disabled'} state
 */

/** @type {{ upstreams: UpstreamStatus[] }} */
const _status = { upstreams: [] };

/** @type {Set<string>} */
const _registeredAliases = new Set();

/** @type {Map<string, MCPStdioUpstreamClient>} */
const _stdioClients = new Map();

/** @type {Map<string, { attempts: number, timer: NodeJS.Timeout | null }>} */
const _retryState = new Map();

/** @type {boolean} */
let _shutdownHookInstalled = false;
const _shutdownHookHandlers = {
    exit: null,
    sigint: null,
    sigterm: null,
};

function ensureShutdownHook() {
    if (_shutdownHookInstalled) return;

    const handler = () => {
        // Best-effort: avoid async waits in signal handler.
        for (const client of _stdioClients.values()) {
            client.close().catch(() => {});
        }
    };

    _shutdownHookHandlers.exit = handler;
    _shutdownHookHandlers.sigint = handler;
    _shutdownHookHandlers.sigterm = handler;

    process.on('exit', _shutdownHookHandlers.exit);
    process.on('SIGINT', _shutdownHookHandlers.sigint);
    process.on('SIGTERM', _shutdownHookHandlers.sigterm);

    _shutdownHookInstalled = true;
}

function cleanupShutdownHook() {
    if (!_shutdownHookInstalled) return;

    if (_shutdownHookHandlers.exit) {
        process.removeListener('exit', _shutdownHookHandlers.exit);
        _shutdownHookHandlers.exit = null;
    }
    if (_shutdownHookHandlers.sigint) {
        process.removeListener('SIGINT', _shutdownHookHandlers.sigint);
        _shutdownHookHandlers.sigint = null;
    }
    if (_shutdownHookHandlers.sigterm) {
        process.removeListener('SIGTERM', _shutdownHookHandlers.sigterm);
        _shutdownHookHandlers.sigterm = null;
    }

    _shutdownHookInstalled = false;
}

function envFlag(raw, fallback = false) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = String(raw).trim().toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
    return fallback;
}

function setStatus(next) {
    _status.upstreams = next;
}

function setOneStatus(next) {
    const idx = _status.upstreams.findIndex(u => u.alias === next.alias);
    if (idx >= 0) {
        _status.upstreams[idx] = next;
        return;
    }
    _status.upstreams.push(next);
}

/** Função exportada: getUpstreamStatus. */
export function getUpstreamStatus() {
    // Return a shallow clone to avoid accidental mutation
    return { upstreams: _status.upstreams.map(u => ({ ...u })) };
}

/**
 * Parse upstreams from ENV.
 *
 * @param {Record<string, any>} env
 * @returns {UpstreamConfig[]}
 */
export function parseUpstreamsFromEnv(env = process.env) {
    /** @type {UpstreamConfig[]} */
    const upstreams = [];

    // 1) New multi-upstream config
    const upstreamsJson = String(env.MCP_UPSTREAMS_JSON || '').trim();
    if (upstreamsJson) {
        const arr = parseJsonArray(upstreamsJson);
        if (arr) {
            for (const raw of arr) {
                if (!raw || typeof raw !== 'object') continue;
                const alias = normalizeAlias(raw.alias);
                const transport = raw.transport === 'stdio' ? 'stdio' : raw.transport === 'http' ? 'http' : null;
                if (!alias || !transport) continue;

                const toolPrefix = String(raw.toolPrefix || `mcp_${alias}__`);
                const required = Boolean(raw.required || false);

                if (transport === 'http') {
                    const url = String(raw.url || '').trim();
                    if (!url) continue;
                    const headers =
                        raw.headers && typeof raw.headers === 'object'
                            ? raw.headers
                            : parseJsonObject(raw.headersJson) || undefined;

                    upstreams.push({ alias, transport, url, toolPrefix, required, headers });
                } else {
                    const command = String(raw.command || '').trim();
                    const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
                    if (!command) continue;
                    const envFrom = Array.isArray(raw.envFrom) ? raw.envFrom.map(String) : [];

                    const initTimeoutMs = raw.initTimeoutMs ? Number(raw.initTimeoutMs) : undefined;
                    const callTimeoutMs = raw.callTimeoutMs ? Number(raw.callTimeoutMs) : undefined;

                    upstreams.push({
                        alias,
                        transport,
                        command,
                        args,
                        envFrom,
                        toolPrefix,
                        required,
                        initTimeoutMs,
                        callTimeoutMs,
                    });
                }
            }
        }
    }

    // 2) Legacy single HTTP upstream
    if (!upstreamsJson && String(env.MCP_UPSTREAM_ENABLED || '') === 'true') {
        const url = String(env.MCP_UPSTREAM_URL || '').trim();
        const alias = normalizeAlias(env.MCP_UPSTREAM_ALIAS || 'upstream') || 'upstream';
        const toolPrefix = String(env.MCP_UPSTREAM_TOOL_PREFIX || `mcp_${alias}__`);
        const headers = parseJsonObject(env.MCP_UPSTREAM_HEADERS_JSON) || undefined;
        if (url) {
            upstreams.push({ alias, transport: 'http', url, toolPrefix, headers, required: false });
        }
    }

    // 3) GitHub proxy preset (stdio)
    if (String(env.MCP_GITHUB_PROXY_ENABLED || '') === 'true') {
        const alias = 'github';
        const toolPrefix = String(env.MCP_GITHUB_TOOL_PREFIX || 'mcp_github__');

        const command = String(env.MCP_GITHUB_COMMAND || 'npx');
        const args = parseJsonArray(env.MCP_GITHUB_ARGS_JSON) || ['-y', '@modelcontextprotocol/server-github'];

        upstreams.push({
            alias,
            transport: 'stdio',
            command,
            args,
            envFrom: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
            toolPrefix,
            required: false,
        });
    }

    // Enforce unique aliases (first wins)
    const seen = new Set();
    return upstreams.filter(u => {
        if (seen.has(u.alias)) return false;
        seen.add(u.alias);
        return true;
    });
}

function buildChildEnv(env, envFrom) {
    const base = { ...process.env };
    for (const key of envFrom || []) {
        const v = String(env[key] || '').trim();
        if (v) base[key] = v;
    }
    return base;
}

function getRestartConfig(env) {
    const enabled = envFlag(env.MCP_UPSTREAM_RESTART_ENABLED, false);
    const baseBackoffMs = readPositiveInt(env.MCP_UPSTREAM_RESTART_BACKOFF_MS || env.BOOT_RETRY_BASE_MS, 5000);
    const maxBackoffMs = readPositiveInt(env.MCP_UPSTREAM_RESTART_MAX_BACKOFF_MS || env.BOOT_RETRY_MAX_MS, 60000);
    const rawMax = Number(env.MCP_UPSTREAM_RESTART_MAX ?? 10);
    const maxRetries = !Number.isFinite(rawMax) ? 10 : rawMax === 0 ? Infinity : Math.max(0, rawMax);

    return {
        enabled,
        baseBackoffMs,
        maxBackoffMs,
        maxRetries,
    };
}

function clearRetry(alias) {
    const entry = _retryState.get(alias);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    _retryState.delete(alias);
}

/**
 * @param {UpstreamConfig} cfg
 * @param {import('../tool-registry.mjs').ToolRegistry} registry
 * @param {Record<string, any>} env
 * @param {{ refresh: boolean, force: boolean, restart: ReturnType<typeof getRestartConfig> }} options
 */
function scheduleRetry(cfg, registry, env, options) {
    const { restart } = options;
    if (!restart.enabled) return;

    const alias = cfg.alias;
    const existing = _retryState.get(alias) || { attempts: 0, timer: null };
    if (existing.timer) return; // already scheduled

    if (existing.attempts >= restart.maxRetries) return;

    existing.attempts += 1;
    const delayMs = computeExponentialBackoffDelay(existing.attempts, restart.baseBackoffMs, restart.maxBackoffMs);

    existing.timer = setTimeout(async () => {
        existing.timer = null;
        _retryState.set(alias, existing);
        try {
            const { status } = await registerOneUpstream(cfg, registry, env, {
                refresh: options.refresh,
                force: options.force,
                restart,
            });
            setOneStatus(status);
        } catch {
            // ignore; registerOneUpstream already sets status + lastError
        }
    }, delayMs);

    _retryState.set(alias, existing);
}

/**
 * @param {UpstreamConfig} cfg
 * @param {import('../tool-registry.mjs').ToolRegistry} registry
 * @param {Record<string, any>} env
 * @param {{ refresh: boolean, force: boolean, restart: ReturnType<typeof getRestartConfig> }} options
 * @returns {Promise<{ status: UpstreamStatus }>}
 */
async function registerOneUpstream(cfg, registry, env, options) {
    const { refresh, restart } = options;

    const already = _registeredAliases.has(cfg.alias);
    if (already && !refresh && !options.force) {
        const prev = _status.upstreams.find(u => u.alias === cfg.alias);
        if (prev) {
            return {
                status: {
                    ...prev,
                    toolPrefix: prev.toolPrefix || cfg.toolPrefix,
                    required: typeof prev.required === 'boolean' ? prev.required : Boolean(cfg.required || false),
                    state: prev.state || (prev.ready ? 'ready' : 'not-ready'),
                },
            };
        }
        return {
            status: {
                alias: cfg.alias,
                transport: cfg.transport,
                toolPrefix: cfg.toolPrefix,
                target:
                    cfg.transport === 'http'
                        ? String(cfg.url || '')
                        : `${cfg.command} ${(cfg.args || []).join(' ')}`.trim(),
                enabled: true,
                required: Boolean(cfg.required || false),
                ready: true,
                registeredCount: 0,
                lastInitAt: null,
                lastError: null,
                state: 'ready',
            },
        };
    }

    const target =
        cfg.transport === 'http' ? String(cfg.url || '') : `${cfg.command} ${(cfg.args || []).join(' ')}`.trim();

    /** @type {UpstreamStatus} */
    const st = {
        alias: cfg.alias,
        transport: cfg.transport,
        toolPrefix: cfg.toolPrefix,
        target,
        enabled: true,
        required: Boolean(cfg.required || false),
        ready: false,
        registeredCount: 0,
        lastInitAt: new Date().toISOString(),
        lastError: null,
        state: 'not-ready',
    };
    const prev = _status.upstreams.find(u => u.alias === cfg.alias);
    if (!refresh && prev && typeof prev.registeredCount === 'number') {
        st.registeredCount = prev.registeredCount;
    }

    try {
        let tools = [];

        if (cfg.transport === 'http') {
            const client = createMcpHttpClient({ url: cfg.url, headers: cfg.headers });
            const toolList = await client.listTools();
            tools = Array.isArray(toolList?.tools) ? toolList.tools : [];

            for (const tool of tools) {
                if (!tool?.name || typeof tool.name !== 'string') continue;
                const { description, inputSchema } = sanitizeToolMetadata(tool);
                const upstreamName = tool.name;
                const localName = `${cfg.toolPrefix}${upstreamName}`;
                if (!refresh && registry.has(localName)) continue;

                registry.register(
                    localName,
                    { description: `[Upstream:${cfg.alias}] ${description}`, inputSchema },
                    async (params = {}, execOptions = {}) => {
                        try {
                            return await client.callTool({
                                name: upstreamName,
                                arguments: params,
                                signal: execOptions.signal,
                            });
                        } catch (err) {
                            markUpstreamCallFailure(cfg, err, registry, env, restart);
                            throw err;
                        }
                    }
                );
                if (refresh || !prev) st.registeredCount += 1;
            }
        } else {
            const token = String(env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
            if (cfg.alias === 'github' && String(env.MCP_GITHUB_PROXY_ENABLED || '') === 'true' && !token) {
                throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is missing (required for GitHub proxy)');
            }

            const envFrom = Array.isArray(cfg.envFrom) ? cfg.envFrom : [];
            const childEnv = buildChildEnv(env, envFrom);

            let client = _stdioClients.get(cfg.alias);
            if (client && refresh) {
                await client.close().catch(() => {});
                _stdioClients.delete(cfg.alias);
                client = null;
            }

            if (!client) {
                client = new MCPStdioUpstreamClient({
                    alias: cfg.alias,
                    command: cfg.command,
                    args: cfg.args || [],
                    env: childEnv,
                    initTimeoutMs: cfg.initTimeoutMs || Number(env.MCP_UPSTREAM_INIT_TIMEOUT_MS || 30000),
                    callTimeoutMs: cfg.callTimeoutMs || Number(env.MCP_TOOL_TIMEOUT || 90000),
                });
                _stdioClients.set(cfg.alias, client);
            }

            await client.connect();
            const toolList = await client.listTools();
            tools = Array.isArray(toolList?.tools) ? toolList.tools : [];

            for (const tool of tools) {
                if (!tool?.name || typeof tool.name !== 'string') continue;
                const { description, inputSchema } = sanitizeToolMetadata(tool);
                const upstreamName = tool.name;
                const localName = `${cfg.toolPrefix}${upstreamName}`;
                if (!refresh && registry.has(localName)) continue;

                registry.register(
                    localName,
                    { description: `[Upstream:${cfg.alias}] ${description}`, inputSchema },
                    async (params = {}, execOptions = {}) => {
                        try {
                            return await client.callTool({
                                name: upstreamName,
                                arguments: params,
                                signal: execOptions.signal,
                            });
                        } catch (err) {
                            markUpstreamCallFailure(cfg, err, registry, env, restart);
                            throw err;
                        }
                    }
                );
                if (refresh || !prev) st.registeredCount += 1;
            }
        }

        st.ready = true;
        st.state = 'ready';
        _registeredAliases.add(cfg.alias);
        clearRetry(cfg.alias);
    } catch (err) {
        st.ready = false;
        st.state = 'not-ready';
        st.lastError = err && err.message ? err.message : String(err);

        // Best-effort: schedule retry without crashing the server.
        scheduleRetry(cfg, registry, env, { refresh, force: true, restart });
    }

    return { status: st };
}

function markUpstreamCallFailure(cfg, err, registry, env, restart) {
    const prev = _status.upstreams.find(u => u.alias === cfg.alias);
    const next = {
        alias: cfg.alias,
        transport: cfg.transport,
        toolPrefix: cfg.toolPrefix,
        target:
            prev?.target ||
            (cfg.transport === 'http' ? String(cfg.url || '') : `${cfg.command} ${(cfg.args || []).join(' ')}`.trim()),
        enabled: true,
        required: Boolean(cfg.required || false),
        ready: false,
        registeredCount: typeof prev?.registeredCount === 'number' ? prev.registeredCount : 0,
        lastInitAt: prev?.lastInitAt || new Date().toISOString(),
        lastError: err && err.message ? err.message : String(err),
        state: 'not-ready',
    };
    setOneStatus(next);

    // Background probe to flip ready back if upstream recovers.
    scheduleRetry(cfg, registry, env, { refresh: false, force: true, restart });
}

/**
 * Register tools from all enabled upstreams into the local registry.
 *
 * @param {import('../tool-registry.mjs').ToolRegistry} registry
 * @param {{ env?: Record<string, any>, installShutdownHook?: boolean }} [options]
 * @returns {Promise<{upstreams: UpstreamStatus[]}>}
 */
export async function registerUpstreams(registry, options = {}) {
    const env = options.env || process.env;
    const refresh = String(env.MCP_UPSTREAM_REFRESH || '') === 'true';
    const restart = getRestartConfig(env);
    const installShutdownHook = options.installShutdownHook ?? envFlag(env.MCP_UPSTREAM_INSTALL_GLOBAL_HOOK, true);

    const configs = parseUpstreamsFromEnv(env);
    if (configs.length === 0) {
        cleanupShutdownHook();
        setStatus([]);
        return getUpstreamStatus();
    }

    if (installShutdownHook) {
        ensureShutdownHook();
    } else {
        cleanupShutdownHook();
    }

    /** @type {UpstreamStatus[]} */
    const statuses = [];

    for (const cfg of configs) {
        const { status } = await registerOneUpstream(cfg, registry, env, { refresh, force: false, restart });
        statuses.push(status);
    }

    setStatus(statuses);
    return getUpstreamStatus();
}

/** Função exportada: shutdownUpstreams. */
export async function shutdownUpstreams() {
    for (const entry of _retryState.values()) {
        if (entry.timer) clearTimeout(entry.timer);
    }
    _retryState.clear();

    for (const client of _stdioClients.values()) {
        await client.close().catch(() => {});
    }
    _stdioClients.clear();
    _registeredAliases.clear();
    setStatus([]);
    cleanupShutdownHook();
}
