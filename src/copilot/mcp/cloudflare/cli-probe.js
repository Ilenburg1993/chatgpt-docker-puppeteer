// @ts-check
/** HTTP, OAuth and MCP probe helpers for Cloudflare MCP CLI. */
import { mcpFetchStatus, mcpFetchText, mcpFetchTextWithRetry } from '#copilot/mcp/control-plane';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 10_000;
const localInsecureHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    maxFreeSockets: 4,
    timeout: 10_000,
});

/**
 * @typedef {{
 *     method?: string;
 *     headers?: HeadersInit;
 *     body?: BodyInit | null;
 *     timeoutMs?: number;
 *     attempts?: number;
 *     delayMs?: number;
 *     protocolVersion?: string;
 * }} ProbeJsonOptions
 *
 *
 * @typedef {{
 *     timeoutMs?: number;
 *     allowInsecureHttps?: boolean;
 *     servername?: string;
 * }} ProbeHealthOptions
 *
 *
 * @typedef {{
 *     ok: boolean;
 *     status: number;
 *     body?: unknown;
 *     rawBody?: string;
 *     headers?: Record<string, string>;
 *     error?: string;
 *     attempts?: number;
 * }} ProbeJsonResult
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function readSmokeBearerToken(env = process.env) {
    const token = String(env['COPILOT_MCP_SMOKE_BEARER_TOKEN'] ?? '').trim();
    return token && !hasControlCharacters(token) ? token : null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasControlCharacters(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
}

/**
 * @param {string | null} bearerToken
 * @param {{ protocolVersion?: string }} [options]
 * @returns {Record<string, string>}
 */
export function buildToolsListSmokeHeaders(bearerToken, options = {}) {
    return {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(options.protocolVersion ? { 'mcp-protocol-version': options.protocolVersion } : {}),
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    };
}

/**
 * @param {string} url
 * @param {ProbeHealthOptions} [options]
 * @returns {Promise<{ ok: boolean; status?: number; error?: string; tlsVerification?: string }>}
 */
export async function probeHealth(url, options = {}) {
    try {
        if (options.allowInsecureHttps === true && String(url).startsWith('https://')) {
            return await probeInsecureHttpsHealth(url, options);
        }
        return await mcpFetchStatus(url, { timeoutMs: Number(options.timeoutMs ?? 3000) });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} url
 * @param {ProbeHealthOptions} options
 * @returns {Promise<{ ok: boolean; status?: number; error?: string; tlsVerification: string }>}
 */
function probeInsecureHttpsHealth(url, options) {
    return new Promise((resolve) => {
        const request = https.request(
            url,
            {
                method: 'GET',
                rejectUnauthorized: false,
                servername: options.servername,
                agent: localInsecureHttpsAgent,
            },
            (response) => {
                response.resume();
                response.on('end', () => {
                    const result = {
                        ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
                        tlsVerification: 'disabled-local-origin-diagnostic',
                        ...(response.statusCode === undefined ? {} : { status: response.statusCode }),
                    };
                    resolve(result);
                });
            },
        );
        request.setTimeout(Number(options.timeoutMs ?? 3000), () =>
            request.destroy(new Error('health probe timed out')),
        );
        request.on('error', (error) => {
            resolve({ ok: false, error: error.message, tlsVerification: 'disabled-local-origin-diagnostic' });
        });
        request.end();
    });
}

/**
 * @param {string} url
 * @param {ProbeJsonOptions} [options]
 * @returns {Promise<ProbeJsonResult>}
 */
export async function probeJsonWithRetry(url, options = {}) {
    const result = await mcpFetchTextWithRetry(url, {
        method: options.method ?? 'GET',
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        timeoutMs: Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        attempts: Number(options.attempts ?? 3),
        delayMs: Number(options.delayMs ?? 1000),
    });
    const contentType = result.headers['content-type'] ?? '';
    const parsed = parseJsonOrMcpEventStream(result.rawBody, contentType);
    return {
        ok: result.ok,
        status: result.status,
        body: parsed.body,
        rawBody: result.rawBody,
        headers: result.headers,
        ...(result.error !== undefined ? { error: result.error } : {}),
        attempts: result.attempts,
    };
}

/**
 * @param {string} url
 * @param {ProbeJsonOptions} [options]
 * @returns {Promise<ProbeJsonResult>}
 */
export async function probeJson(url, options = {}) {
    const result = await mcpFetchText(url, {
        method: options.method ?? 'GET',
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        timeoutMs: Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const contentType = result.headers['content-type'] ?? '';
    const parsed = parseJsonOrMcpEventStream(result.rawBody, contentType);
    return {
        ok: result.ok,
        status: result.status,
        body: parsed.body,
        rawBody: result.rawBody,
        headers: result.headers,
        ...(result.error !== undefined ? { error: result.error } : {}),
    };
}

/**
 * @param {unknown} rawBody
 * @param {string} [contentType]
 * @returns {{ body: unknown }}
 */
export function parseJsonOrMcpEventStream(rawBody, contentType = '') {
    const text = String(rawBody ?? '').trim();
    if (!text) return { body: null };
    if (contentType.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
        const data = text
            .split(/\r?\n/u)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .find(Boolean);
        if (data) return { body: safeJson(data) ?? { eventStreamData: data } };
    }
    return { body: safeJson(text) ?? text };
}

/** @param {string} text @returns {unknown | null} */
function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * @param {ProbeJsonResult} probe
 * @returns {{ ok: boolean; status: number; toolCount: number; toolNames: string[]; error: string | undefined }}
 */
export function summarizeToolsListProbe(probe) {
    const body = asRecord(probe.body);
    const result = asRecord(body?.['result']);
    const tools = Array.isArray(result?.['tools'])
        ? result['tools']
        : Array.isArray(body?.['tools'])
          ? body['tools']
          : [];
    return {
        ok: probe.ok,
        status: probe.status,
        toolCount: tools.length,
        toolNames: tools.map((tool) => asRecord(tool)?.['name']).filter((name) => typeof name === 'string'),
        error: probe.error,
    };
}

/**
 * @param {ProbeJsonResult | { ok: boolean; status?: number; error?: string }} probe
 * @returns {{ ok: boolean; status: number | null; error: string | null }}
 */
export function summarizeProbeEnvelope(probe) {
    return { ok: probe.ok, status: probe.status ?? null, error: probe.error ?? null };
}

/**
 * @param {ProbeJsonResult} protectedResource
 * @returns {string | null}
 */
export function extractAuthorizationServer(protectedResource) {
    const body = asRecord(protectedResource.body);
    const servers = Array.isArray(body?.['authorization_servers']) ? body['authorization_servers'] : [];
    return typeof servers[0] === 'string' ? servers[0] : null;
}

/**
 * @param {ProbeJsonResult} resourceProbe
 * @param {ProbeJsonResult | { ok: boolean; status?: number; error?: string }} authorizationProbe
 * @returns {{
 *     ok: boolean;
 *     protectedResource: ReturnType<typeof summarizeProbeEnvelope>;
 *     authorizationServer: ReturnType<typeof summarizeProbeEnvelope>;
 * }}
 */
export function summarizeOAuthReadiness(resourceProbe, authorizationProbe) {
    return {
        ok: Boolean(resourceProbe.ok && authorizationProbe.ok),
        protectedResource: summarizeProbeEnvelope(resourceProbe),
        authorizationServer: summarizeProbeEnvelope(authorizationProbe),
    };
}

/**
 * @param {ProbeJsonResult} probe
 * @returns {ReturnType<typeof summarizeProbeEnvelope>}
 */
export function summarizeProtectedResourceProbe(probe) {
    return summarizeProbeEnvelope(probe);
}

/**
 * @param {{ ok: boolean; status: number; toolCount: number }} summary
 * @returns {{ ok: boolean; status: number; toolCount: number; checkedAt: string }}
 */
export function compactPersistedToolsListSummary(summary) {
    return {
        ok: summary.ok,
        status: summary.status,
        toolCount: summary.toolCount,
        checkedAt: new Date().toISOString(),
    };
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function readPositiveIntegerEnv(name, fallback) {
    const parsed = Number(process.env[name] ?? '');
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {string} name
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
export function readBooleanEnv(name, fallback = false) {
    const value = String(process.env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
