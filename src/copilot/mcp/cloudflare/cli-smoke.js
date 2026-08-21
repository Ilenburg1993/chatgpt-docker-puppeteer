// @ts-check
/** Cloudflare MCP smoke orchestration. */
import { readMcpAuthConfig } from '#copilot/mcp/control-plane';
import {
    buildToolsListSmokeHeaders,
    extractAuthorizationServer,
    probeJsonWithRetry,
    readSmokeBearerToken,
    summarizeOAuthReadiness,
    summarizeProbeEnvelope,
    summarizeToolsListProbe,
} from './cli-probe.js';
import { createCloudflareStateStore } from './state.js';

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_SMOKE_ATTEMPTS = 3;
const DEFAULT_SMOKE_DELAY_MS = 1_000;
const DEFAULT_CRITICAL_TOOL_NAMES = [
    'repo_status',
    'repo_tree',
    'repo_read_file',
    'repo_search_text',
    'repo_apply_file_batch',
    'mcp_runtime_health',
    'mcp_tunnel_status',
];

/**
 * @param {{
 *     config?: import('./config.js').CloudflareTunnelConfig;
 *     authenticated?: boolean;
 *     env?: NodeJS.ProcessEnv;
 *     persistState?: boolean;
 *     localToolNames?: string[];
 * }} [input]
 */
export async function runCloudflareSmoke({
    config,
    authenticated = false,
    env = process.env,
    persistState = true,
    localToolNames = [],
} = {}) {
    if (!config) throw new Error('Cloudflare smoke requires a resolved tunnel config.');
    const connectorUrl = resolveConnectorUrl(config, env);
    const protocolVersion = String(env['COPILOT_MCP_PROTOCOL_VERSION'] ?? DEFAULT_MCP_PROTOCOL_VERSION).trim();
    const smokeAttempts = readPositiveIntegerEnv(env, 'COPILOT_MCP_SMOKE_ATTEMPTS', DEFAULT_SMOKE_ATTEMPTS, 1, 20);
    const smokeDelayMs = readPositiveIntegerEnv(env, 'COPILOT_MCP_SMOKE_DELAY_MS', DEFAULT_SMOKE_DELAY_MS, 100, 30_000);
    const probeOptions = { attempts: smokeAttempts, delayMs: smokeDelayMs };
    const bearerToken = authenticated ? readSmokeBearerToken(env) : null;
    if (authenticated && !bearerToken) {
        throw new Error('Authenticated Cloudflare smoke requires a valid COPILOT_MCP_SMOKE_BEARER_TOKEN.');
    }
    const startedAt = Date.now();
    const discoveryStartedAt = Date.now();
    const [health, protectedResource, toolsList] = await Promise.all([
        probeJsonWithRetry(new URL('/health', connectorUrl).toString(), probeOptions),
        probeJsonWithRetry(new URL('/.well-known/oauth-protected-resource', connectorUrl).toString(), probeOptions),
        probeJsonWithRetry(connectorUrl, {
            method: 'POST',
            headers: buildToolsListSmokeHeaders(bearerToken, { protocolVersion }),
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'cloudflare-smoke-tools-list',
                method: 'tools/list',
                params: {},
            }),
            ...probeOptions,
        }),
    ]);
    const discoveryParallelMs = Date.now() - discoveryStartedAt;
    const authorizationServer = extractAuthorizationServer(protectedResource);
    const authorizationStartedAt = Date.now();
    const authorization = authorizationServer
        ? await probeJsonWithRetry(
              new URL('/.well-known/oauth-authorization-server', authorizationServer).toString(),
              probeOptions,
          )
        : { ok: false, error: 'missing-authorization-server' };
    const authorizationServerMs = Date.now() - authorizationStartedAt;
    const tools = summarizeToolsListProbe(toolsList);
    const oauth = summarizeOAuthReadiness(protectedResource, authorization);
    const authConfig = readMcpAuthConfig(env);
    const authChallenge = summarizeExpectedAuthChallenge(toolsList, authConfig, authenticated);
    const criticalTools = authChallenge.ok
        ? summarizeSkippedCriticalTools(env)
        : summarizeCriticalTools(tools.toolNames, env, localToolNames);
    const toolsGateOk = tools.ok || authChallenge.ok;
    const report = {
        ok: Boolean(health.ok && protectedResource.ok && oauth.ok && toolsGateOk && criticalTools.ok),
        connectorUrl,
        protocolVersion,
        authenticated,
        authMode: authConfig.mode,
        probePolicy: { attempts: smokeAttempts, delayMs: smokeDelayMs },
        timings: {
            strategy: 'parallel-health-resource-tools-then-auth-metadata',
            discoveryParallelMs,
            authorizationServerMs,
            totalMs: Date.now() - startedAt,
        },
        health: summarizeProbeEnvelope(health),
        oauth,
        tools,
        authChallenge,
        criticalTools,
    };
    if (persistState) {
        try {
            await createCloudflareStateStore(config).writeConnectorSmokeState({
                connectorUrl,
                checkedAt: new Date().toISOString(),
                health: report.health,
                toolsList: {
                    ok: toolsGateOk,
                    status: tools.status,
                    tools: tools.toolCount,
                    expectedLocalTools: localToolNames.length,
                    toolsMatchLocalRegistry: tools.ok,
                    criticalToolsPresent: criticalTools.ok,
                    missingCriticalTools: criticalTools.missing,
                    missingLocalTools: [],
                    unexpectedRemoteTools: [],
                    authChallenge: authChallenge.ok,
                },
                ok: report.ok,
                oauth,
            });
        } catch {
            /* smoke state persistence is best-effort */
        }
    }
    return report;
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum, maximum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function resolveConnectorUrl(config, env) {
    const explicit = String(
        env['COPILOT_MCP_SMOKE_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'] ?? config.publicMcpUrl ?? '',
    ).trim();
    if (explicit) return explicit;
    throw new Error('Smoke requires COPILOT_MCP_SMOKE_URL, COPILOT_MCP_PUBLIC_URL, or configured public URL.');
}

/**
 * @param {string[]} toolNames
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} localToolNames
 * @returns {{ ok: boolean; expected: string[]; missing: string[]; unknownExpected: string[] }}
 */
function summarizeCriticalTools(toolNames, env, localToolNames) {
    const expected = readExpectedCriticalTools(env);
    const canonical = new Set(localToolNames);
    const advertised = new Set(toolNames);
    const missing = expected.filter((name) => !advertised.has(name));
    const unknownExpected = expected.filter((name) => !canonical.has(name));
    return { ok: missing.length === 0, expected, missing, unknownExpected };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function readExpectedCriticalTools(env) {
    return String(env['COPILOT_MCP_CRITICAL_TOOLS'] ?? '').trim()
        ? String(env['COPILOT_MCP_CRITICAL_TOOLS'])
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
        : DEFAULT_CRITICAL_TOOL_NAMES;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *     ok: true;
 *     expected: string[];
 *     missing: string[];
 *     unknownExpected: string[];
 *     skipped: true;
 *     reason: string;
 * }}
 */
function summarizeSkippedCriticalTools(env) {
    return {
        ok: true,
        expected: readExpectedCriticalTools(env),
        missing: [],
        unknownExpected: [],
        skipped: true,
        reason: 'tools/list is OAuth-protected; unauthenticated smoke verified the expected 401 challenge instead.',
    };
}

/**
 * @param {{ status?: number; headers?: Record<string, string> }} probe
 * @param {ReturnType<typeof readMcpAuthConfig>} authConfig
 * @param {boolean} authenticated
 * @returns {{
 *     ok: boolean;
 *     expected: boolean;
 *     status: number | null;
 *     wwwAuthenticatePresent: boolean;
 *     reason: string | null;
 * }}
 */
function summarizeExpectedAuthChallenge(probe, authConfig, authenticated) {
    const protectedByOauth = authConfig.mode !== 'none-dev' && authConfig.enforcement !== 'off';
    const status = probe.status ?? null;
    const wwwAuthenticate = String(probe.headers?.['www-authenticate'] ?? '').trim();
    const wwwAuthenticatePresent = wwwAuthenticate.length > 0;
    const expected = !authenticated && protectedByOauth;
    const ok = expected && status === 401 && /bearer|resource_metadata|authorization_uri/iu.test(wwwAuthenticate);
    return {
        ok,
        expected,
        status,
        wwwAuthenticatePresent,
        reason: ok ? 'oauth-challenge-accepted' : expected ? 'oauth-challenge-missing-or-invalid' : null,
    };
}
