// @ts-check
/** HTTP, OAuth and MCP probe helpers for Cloudflare MCP CLI. */
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * @typedef {{
 *   method?: string;
 *   headers?: HeadersInit;
 *   body?: BodyInit | null;
 *   timeoutMs?: number;
 *   attempts?: number;
 *   delayMs?: number;
 *   protocolVersion?: string;
 * }} ProbeJsonOptions
 *
 * @typedef {{
 *   timeoutMs?: number;
 *   allowInsecureHttps?: boolean;
 *   servername?: string;
 * }} ProbeHealthOptions
 *
 * @typedef {{
 *   ok: boolean;
 *   status: number;
 *   body?: unknown;
 *   rawBody?: string;
 *   headers?: Record<string, string>;
 *   error?: string;
 *   attempts?: number;
 * }} ProbeJsonResult
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @returns {string | null} */
export function readSmokeBearerToken() {
    const token = String(process.env['COPILOT_MCP_SMOKE_BEARER_TOKEN'] ?? '').trim();
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
        const response = await fetch(url, { signal: AbortSignal.timeout(Number(options.timeoutMs ?? 3000)) });
        return { ok: response.ok, status: response.status };
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
        const request = https.request(url, {
            method: 'GET',
            rejectUnauthorized: false,
            servername: options.servername,
        }, (response) => {
            response.resume();
            response.on('end', () => {
                const result = {
                    ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
                    tlsVerification: 'disabled-local-origin-diagnostic',
                    ...(response.statusCode === undefined ? {} : { status: response.statusCode }),
                };
                resolve(result);
            });
        });
        request.setTimeout(Number(options.timeoutMs ?? 3000), () => request.destroy(new Error('health probe timed out')));
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
    const attempts = Number(options.attempts ?? 3);
    /** @type {ProbeJsonResult | undefined} */
    let last;
    for (let i = 1; i <= attempts; i += 1) {
        last = await probeJson(url, options);
        last.attempts = i;
        if (last.ok || ![0, 408, 425, 429, 500, 502, 503, 504, 530].includes(last.status ?? 0)) return last;
        await new Promise((resolve) => setTimeout(resolve, Number(options.delayMs ?? 1000)));
    }
    return last ?? { ok: false, status: 0, error: 'probe-not-run', attempts: 0 };
}

/**
 * @param {string} url
 * @param {ProbeJsonOptions} [options]
 * @returns {Promise<ProbeJsonResult>}
 */
export async function probeJson(url, options = {}) {
    try {
        /** @type {RequestInit} */
        const init = {
            method: options.method ?? 'GET',
            signal: AbortSignal.timeout(Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
        };
        if (options.headers !== undefined) init.headers = options.headers;
        if (options.body !== undefined) init.body = options.body;
        const response = await fetch(url, init);
        const rawBody = await response.text();
        const contentType = response.headers.get('content-type') ?? '';
        const parsed = parseJsonOrMcpEventStream(rawBody, contentType);
        return { ok: response.ok, status: response.status, body: parsed.body, rawBody, headers: Object.fromEntries(response.headers.entries()) };
    } catch (error) {
        return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
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
        const data = text.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).find(Boolean);
        if (data) return { body: safeJson(data) ?? { eventStreamData: data } };
    }
    return { body: safeJson(text) ?? text };
}

/** @param {string} text @returns {unknown | null} */
function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }

/**
 * @param {ProbeJsonResult} probe
 * @returns {{ ok: boolean; status: number; toolCount: number; toolNames: string[]; error: string | undefined }}
 */
export function summarizeToolsListProbe(probe) {
    const body = asRecord(probe.body);
    const result = asRecord(body?.['result']);
    const tools = Array.isArray(result?.['tools']) ? result['tools'] : Array.isArray(body?.['tools']) ? body['tools'] : [];
    return { ok: probe.ok, status: probe.status, toolCount: tools.length, toolNames: tools.map((tool) => asRecord(tool)?.['name']).filter((name) => typeof name === 'string'), error: probe.error };
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
 * @returns {{ ok: boolean; protectedResource: ReturnType<typeof summarizeProbeEnvelope>; authorizationServer: ReturnType<typeof summarizeProbeEnvelope> }}
 */
export function summarizeOAuthReadiness(resourceProbe, authorizationProbe) {
    return { ok: Boolean(resourceProbe.ok && authorizationProbe.ok), protectedResource: summarizeProbeEnvelope(resourceProbe), authorizationServer: summarizeProbeEnvelope(authorizationProbe) };
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
    return { ok: summary.ok, status: summary.status, toolCount: summary.toolCount, checkedAt: new Date().toISOString() };
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
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
