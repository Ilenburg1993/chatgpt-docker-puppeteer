// @ts-check
/**
 * Local HTTP smoke test for the canonical Copilot MCP server.
 *
 * @module copilot/mcp/scripts/smoke-http
 */

import { readBoundedResponseText } from '#copilot/infra/public/http-response';
import { normalizeMcpUrl } from '#copilot/mcp/connection';
import { readMcpAuthConfig } from '#copilot/mcp/control-plane';
import { pathToFileURL } from 'node:url';
import { getCanonicalMcpTools } from '../registry.js';

const DEFAULT_LOCAL_MCP_URL = 'http://127.0.0.1:3333/mcp';

/**
 * @typedef {object} ProbeResult
 * @property {boolean} ok
 * @property {number} [status]
 * @property {unknown} [body]
 * @property {Record<string, string>} [headers]
 * @property {string} [error]
 * @property {boolean} [skipped]
 * @property {string} [reason]
 */

/**
 * @param {{ mcpUrl?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runMcpHttpSmoke(options = {}) {
    const mcpUrl = normalizeMcpUrl(options.mcpUrl ?? process.env['COPILOT_MCP_SMOKE_URL'] ?? DEFAULT_LOCAL_MCP_URL);
    const originUrl = mcpUrl.replace(/\/mcp$/, '');
    const authConfig = readMcpAuthConfig();
    const bearerToken = readSmokeBearerToken();
    const health = await probeJson(`${originUrl}/health`, { method: 'GET' });
    const toolsList = await callJsonRpc(mcpUrl, 1, 'tools/list', {});
    const runtimeHealth =
        authConfig.enforcement !== 'off' && !bearerToken
            ? {
                  ok: true,
                  skipped: true,
                  reason: 'auth-required',
              }
            : await callJsonRpc(
                  mcpUrl,
                  2,
                  'tools/call',
                  {
                      name: 'mcp_runtime_health',
                      arguments: {},
                  },
                  bearerToken,
              );
    const remoteToolNames = extractMcpToolNames(toolsList.body);
    const expectedToolNames = getCanonicalMcpTools()
        .map((tool) => tool.name)
        .sort((left, right) => left.localeCompare(right));
    const comparison = compareToolNames(remoteToolNames, expectedToolNames);
    const runtimeToolOk = runtimeHealth.ok && !hasJsonRpcError(runtimeHealth.body);
    const report = {
        ok: health.ok && toolsList.ok && comparison.matches && runtimeToolOk,
        mcpUrl,
        originUrl,
        health,
        protocol: extractProtocolReport(health),
        toolsList: {
            ok: toolsList.ok,
            status: toolsList.status ?? null,
            tools: remoteToolNames.length,
            expectedTools: expectedToolNames.length,
            ...comparison,
        },
        runtimeHealth: {
            ok: runtimeToolOk,
            status: runtimeHealth.status ?? null,
            hasJsonRpcError: hasJsonRpcError(runtimeHealth.body),
            skipped: 'skipped' in runtimeHealth ? runtimeHealth.skipped : false,
            reason: 'reason' in runtimeHealth ? runtimeHealth.reason : null,
        },
    };
    return report;
}

/**
 * @param {string[]} remoteToolNames
 * @param {string[]} expectedToolNames
 * @returns {{ matches: boolean; missingTools: string[]; unexpectedTools: string[]; remoteToolNames: string[] }}
 */
export function compareToolNames(remoteToolNames, expectedToolNames) {
    const missingTools = expectedToolNames.filter((toolName) => !remoteToolNames.includes(toolName));
    const unexpectedTools = remoteToolNames.filter((toolName) => !expectedToolNames.includes(toolName));
    return {
        matches: missingTools.length === 0 && unexpectedTools.length === 0,
        missingTools,
        unexpectedTools,
        remoteToolNames,
    };
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
export function extractMcpToolNames(body) {
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
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<ProbeResult>}
 */
async function probeJson(url, init) {
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
        const text = await readBoundedResponseText(response, {
            maxBytes: 2 * 1024 * 1024,
            label: 'MCP smoke response',
        });
        let body = undefined;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = text;
        }
        return { ok: response.ok, status: response.status, body, headers: extractTelemetryHeaders(response.headers) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} mcpUrl
 * @param {number} id
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {string | undefined} [bearerToken]
 * @returns {Promise<ProbeResult>}
 */
async function callJsonRpc(mcpUrl, id, method, params, bearerToken) {
    return probeJson(mcpUrl, {
        method: 'POST',
        headers: {
            ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
}

/**
 * @returns {string | undefined}
 */
function readSmokeBearerToken() {
    const raw = process.env['COPILOT_MCP_SMOKE_BEARER_TOKEN'] ?? process.env['COPILOT_MCP_STATIC_BEARER_TOKEN'];
    const token = String(raw ?? '').trim();
    return token || undefined;
}

/**
 * @param {unknown} body
 * @returns {boolean}
 */
function hasJsonRpcError(body) {
    return Boolean(body && typeof body === 'object' && 'error' in body && body.error);
}

/**
 * @param {ProbeResult} health
 * @returns {Record<string, unknown>}
 */
function extractProtocolReport(health) {
    const body = health.body;
    const bodyProtocol =
        body &&
        typeof body === 'object' &&
        'http' in body &&
        body.http &&
        typeof body.http === 'object' &&
        'protocol' in body.http
            ? body.http.protocol
            : null;
    return {
        headers: health.headers ?? {},
        health: bodyProtocol,
    };
}

/**
 * @param {Headers} headers
 * @returns {Record<string, string>}
 */
function extractTelemetryHeaders(headers) {
    return {
        originProtocolMode: headers.get('x-mcp-origin-protocol-mode') ?? '',
        originHttpVersion: headers.get('x-mcp-origin-http-version') ?? '',
        originAlpn: headers.get('x-mcp-origin-alpn') ?? '',
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runMcpHttpSmoke();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report['ok']) process.exitCode = 1;
}
