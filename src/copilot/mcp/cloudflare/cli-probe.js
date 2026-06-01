// @ts-check
/** HTTP, OAuth and MCP probe helpers for Cloudflare MCP CLI. */
const DEFAULT_TIMEOUT_MS = 10_000;

export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function readSmokeBearerToken() {
    const token = String(process.env['COPILOT_MCP_SMOKE_BEARER_TOKEN'] ?? '').trim();
    return token && !/[\u0000-\u001f\u007f]/u.test(token) ? token : null;
}

export function buildToolsListSmokeHeaders(bearerToken, options = {}) {
    return {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(options.protocolVersion ? { 'mcp-protocol-version': options.protocolVersion } : {}),
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    };
}

export async function probeHealth(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { ok: response.ok, status: response.status };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function probeJsonWithRetry(url, options = {}) {
    const attempts = Number(options.attempts ?? 3);
    let last;
    for (let i = 1; i <= attempts; i += 1) {
        last = await probeJson(url, options);
        last.attempts = i;
        if (last.ok || ![0, 408, 425, 429, 500, 502, 503, 504].includes(last.status ?? 0)) return last;
        await new Promise((resolve) => setTimeout(resolve, Number(options.delayMs ?? 1000)));
    }
    return last ?? { ok: false, error: 'probe-not-run', attempts: 0 };
}

export async function probeJson(url, options = {}) {
    try {
        const response = await fetch(url, { method: options.method ?? 'GET', headers: options.headers, body: options.body, signal: AbortSignal.timeout(Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)) });
        const rawBody = await response.text();
        const contentType = response.headers.get('content-type') ?? '';
        const parsed = parseJsonOrMcpEventStream(rawBody, contentType);
        return { ok: response.ok, status: response.status, body: parsed.body, rawBody, headers: Object.fromEntries(response.headers.entries()) };
    } catch (error) {
        return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
}

export function parseJsonOrMcpEventStream(rawBody, contentType = '') {
    const text = String(rawBody ?? '').trim();
    if (!text) return { body: null };
    if (contentType.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
        const data = text.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).find(Boolean);
        if (data) return { body: safeJson(data) ?? { eventStreamData: data } };
    }
    return { body: safeJson(text) ?? text };
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }

export function summarizeToolsListProbe(probe) {
    const body = asRecord(probe.body);
    const tools = Array.isArray(body?.result?.tools) ? body.result.tools : Array.isArray(body?.tools) ? body.tools : [];
    return { ok: probe.ok, status: probe.status, toolCount: tools.length, toolNames: tools.map((tool) => tool?.name).filter(Boolean), error: probe.error };
}

export function summarizeProbeEnvelope(probe) {
    return { ok: probe.ok, status: probe.status, error: probe.error ?? null };
}

export function extractAuthorizationServer(protectedResource) {
    const body = asRecord(protectedResource.body);
    const servers = Array.isArray(body?.authorization_servers) ? body.authorization_servers : [];
    return typeof servers[0] === 'string' ? servers[0] : null;
}

export function summarizeOAuthReadiness(resourceProbe, authorizationProbe) {
    return { ok: Boolean(resourceProbe.ok && authorizationProbe.ok), protectedResource: summarizeProbeEnvelope(resourceProbe), authorizationServer: summarizeProbeEnvelope(authorizationProbe) };
}

export function summarizeProtectedResourceProbe(probe) {
    return summarizeProbeEnvelope(probe);
}

export function compactPersistedToolsListSummary(summary) {
    return { ok: summary.ok, status: summary.status, toolCount: summary.toolCount, checkedAt: new Date().toISOString() };
}

export function readPositiveIntegerEnv(name, fallback) {
    const parsed = Number(process.env[name] ?? '');
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readBooleanEnv(name, fallback = false) {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
