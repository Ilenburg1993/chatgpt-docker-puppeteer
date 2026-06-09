// @ts-check
/** Cloudflare MCP smoke orchestration. */
import { readMcpAuthConfig } from '#copilot/mcp/control-plane';
import { getCanonicalMcpTools } from '../registry.js';
import { writeConnectorSmokeState } from './state.js';
import { buildToolsListSmokeHeaders, extractAuthorizationServer, probeJsonWithRetry, readSmokeBearerToken, summarizeOAuthReadiness, summarizeProbeEnvelope, summarizeToolsListProbe } from './cli-probe.js';

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_CRITICAL_TOOL_NAMES = ['repo_status', 'repo_tree', 'repo_read_file', 'repo_search_text', 'repo_apply_file_batch', 'mcp_runtime_health', 'mcp_tunnel_status'];

/**
 * @param {{ config?: import('./config.js').CloudflareTunnelConfig; authenticated?: boolean; env?: NodeJS.ProcessEnv }} [input]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runCloudflareSmoke({ config, authenticated = false, env = process.env } = {}) {
    if (!config) throw new Error('Cloudflare smoke requires a resolved tunnel config.');
    const connectorUrl = resolveConnectorUrl(config, env);
    const protocolVersion = String(env['COPILOT_MCP_PROTOCOL_VERSION'] ?? DEFAULT_MCP_PROTOCOL_VERSION).trim();
    const bearerToken = authenticated ? readSmokeBearerToken() : null;
    const health = await probeJsonWithRetry(new URL('/health', connectorUrl).toString(), { attempts: 2 });
    const protectedResource = await probeJsonWithRetry(new URL('/.well-known/oauth-protected-resource', connectorUrl).toString(), { attempts: 2 });
    const authorizationServer = extractAuthorizationServer(protectedResource);
    const authorization = authorizationServer ? await probeJsonWithRetry(new URL('/.well-known/oauth-authorization-server', authorizationServer).toString(), { attempts: 2 }) : { ok: false, error: 'missing-authorization-server' };
    const toolsList = await probeJsonWithRetry(connectorUrl, { method: 'POST', headers: buildToolsListSmokeHeaders(bearerToken, { protocolVersion }), body: JSON.stringify({ jsonrpc: '2.0', id: 'cloudflare-smoke-tools-list', method: 'tools/list', params: {} }), attempts: 3 });
    const tools = summarizeToolsListProbe(toolsList);
    const oauth = summarizeOAuthReadiness(protectedResource, authorization);
    const authConfig = readMcpAuthConfig(env);
    const authChallenge = summarizeExpectedAuthChallenge(toolsList, authConfig, authenticated);
    const criticalTools = authChallenge.ok ? summarizeSkippedCriticalTools(env) : summarizeCriticalTools(tools.toolNames, env);
    const toolsGateOk = tools.ok || authChallenge.ok;
    const report = {
        ok: Boolean(health.ok && protectedResource.ok && oauth.ok && toolsGateOk && criticalTools.ok),
        connectorUrl,
        protocolVersion,
        authenticated,
        authMode: authConfig.mode,
        health: summarizeProbeEnvelope(health),
        oauth,
        tools,
        authChallenge,
        criticalTools,
    };
    try {
        await writeConnectorSmokeState(config.smokeStateFile, {
            connectorUrl,
            checkedAt: new Date().toISOString(),
            health: report.health,
            toolsList: {
                ok: toolsGateOk,
                status: tools.status,
                tools: tools.toolCount,
                expectedLocalTools: getCanonicalMcpTools().length,
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
    return report;
}

/**
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function resolveConnectorUrl(config, env) {
    const explicit = String(env['COPILOT_MCP_SMOKE_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'] ?? config.publicMcpUrl ?? '').trim();
    if (explicit) return explicit;
    throw new Error('Smoke requires COPILOT_MCP_SMOKE_URL, COPILOT_MCP_PUBLIC_URL, or configured public URL.');
}

/**
 * @param {string[]} toolNames
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: boolean; expected: string[]; missing: string[]; unknownExpected: string[] }}
 */
function summarizeCriticalTools(toolNames, env) {
    const expected = readExpectedCriticalTools(env);
    const canonical = new Set(getCanonicalMcpTools().map((tool) => tool.name));
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
        ? String(env['COPILOT_MCP_CRITICAL_TOOLS']).split(',').map((item) => item.trim()).filter(Boolean)
        : DEFAULT_CRITICAL_TOOL_NAMES;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: true; expected: string[]; missing: string[]; unknownExpected: string[]; skipped: true; reason: string }}
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
 * @returns {{ ok: boolean; expected: boolean; status: number | null; wwwAuthenticatePresent: boolean; reason: string | null }}
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
