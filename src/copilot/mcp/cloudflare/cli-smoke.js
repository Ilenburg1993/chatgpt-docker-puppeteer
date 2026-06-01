// @ts-check
/** Cloudflare MCP smoke orchestration. */
import { readMcpAuthConfig } from '#copilot/mcp/control-plane';
import { getCanonicalMcpTools } from '../registry.js';
import { writeConnectorSmokeState } from './state.js';
import { buildToolsListSmokeHeaders, compactPersistedToolsListSummary, extractAuthorizationServer, probeJsonWithRetry, readSmokeBearerToken, summarizeOAuthReadiness, summarizeProbeEnvelope, summarizeToolsListProbe } from './cli-probe.js';

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_CRITICAL_TOOL_NAMES = ['repo_status', 'repo_tree', 'repo_read_file', 'repo_search_text', 'repo_apply_file_batch', 'mcp_runtime_health', 'mcp_tunnel_status'];

export async function runCloudflareSmoke({ config, authenticated = false, env = process.env } = {}) {
    const connectorUrl = resolveConnectorUrl(config, env);
    const protocolVersion = String(env['COPILOT_MCP_PROTOCOL_VERSION'] ?? DEFAULT_MCP_PROTOCOL_VERSION).trim();
    const bearerToken = authenticated ? readSmokeBearerToken() : null;
    const health = await probeJsonWithRetry(new URL('/health', connectorUrl).toString(), { attempts: 2 });
    const protectedResource = await probeJsonWithRetry(new URL('/.well-known/oauth-protected-resource', connectorUrl).toString(), { attempts: 2 });
    const authorizationServer = extractAuthorizationServer(protectedResource);
    const authorization = authorizationServer ? await probeJsonWithRetry(new URL('/.well-known/oauth-authorization-server', authorizationServer).toString(), { attempts: 2 }) : { ok: false, error: 'missing-authorization-server' };
    const toolsList = await probeJsonWithRetry(connectorUrl, { method: 'POST', headers: buildToolsListSmokeHeaders(bearerToken, { protocolVersion }), body: JSON.stringify({ jsonrpc: '2.0', id: 'cloudflare-smoke-tools-list', method: 'tools/list', params: {} }), attempts: 3 });
    const tools = summarizeToolsListProbe(toolsList);
    const criticalTools = summarizeCriticalTools(tools.toolNames, env);
    const oauth = summarizeOAuthReadiness(protectedResource, authorization);
    const authConfig = readMcpAuthConfig(env);
    const report = { ok: Boolean(health.ok && protectedResource.ok && (!authenticated || tools.ok) && criticalTools.ok), connectorUrl, protocolVersion, authenticated, authMode: authConfig.mode, health: summarizeProbeEnvelope(health), oauth, tools, criticalTools };
    try { await writeConnectorSmokeState(config.smokeStateFile, { connectorUrl, checkedAt: new Date().toISOString(), health: report.health, toolsList: { ok: tools.ok, status: tools.status, tools: tools.toolCount, expectedLocalTools: getCanonicalMcpTools().length, toolsMatchLocalRegistry: true, criticalToolsPresent: criticalTools.ok, missingCriticalTools: criticalTools.missing, missingLocalTools: [], unexpectedRemoteTools: [] }, ok: report.ok, oauth }); } catch {}
    return report;
}

function resolveConnectorUrl(config, env) {
    const explicit = String(env['COPILOT_MCP_SMOKE_URL'] ?? env['COPILOT_MCP_PUBLIC_URL'] ?? config.publicMcpUrl ?? '').trim();
    if (explicit) return explicit;
    throw new Error('Smoke requires COPILOT_MCP_SMOKE_URL, COPILOT_MCP_PUBLIC_URL, or configured public URL.');
}

function summarizeCriticalTools(toolNames, env) {
    const expected = String(env['COPILOT_MCP_CRITICAL_TOOLS'] ?? '').trim() ? String(env['COPILOT_MCP_CRITICAL_TOOLS']).split(',').map((item) => item.trim()).filter(Boolean) : DEFAULT_CRITICAL_TOOL_NAMES;
    const canonical = new Set(getCanonicalMcpTools().map((tool) => tool.name));
    const advertised = new Set(toolNames);
    const missing = expected.filter((name) => !advertised.has(name));
    const unknownExpected = expected.filter((name) => !canonical.has(name));
    return { ok: missing.length === 0, expected, missing, unknownExpected };
}
