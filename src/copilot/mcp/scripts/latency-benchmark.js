// @ts-check
/**
 * Endpoint latency benchmark for the Copilot MCP Cloudflare connector.
 *
 * Measures stable production behavior only by default. Stateful MCP sessions are intentionally excluded unless
 * explicitly requested because the production HTTP adapter is stateless for SDK compatibility.
 *
 * @module copilot/mcp/scripts/latency-benchmark
 */

import { connect as connectHttp2, constants as http2Constants } from 'node:http2';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseBytes } from '#copilot/infra/public/http-response';
import { readCloudflareTunnelConfig } from '#copilot/mcp/cloudflare';
import { normalizeMcpUrl } from '#copilot/mcp/connection';

const DEFAULT_PUBLIC_MCP_URL = 'https://mcp.aurelin.org/mcp';
const DEFAULT_SAMPLES = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BENCHMARK_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {{ ok: boolean; httpOk?: boolean; expectedStatusMatched?: boolean; status?: number; durationMs: number; ttfbMs?: number; downloadMs?: number; bytes?: number; contentLengthHeader?: number | null; contentEncoding?: string | null; cfCacheStatus?: string | null; age?: string | null; cfRay?: string | null; originProtocolMode?: string | null; originHttpVersion?: string | null; originAlpn?: string | null; transport?: string; tlsVerification?: string; error?: string }} LatencySample
 *
 * @typedef {{ name: string; samples: LatencySample[]; summary: LatencySummary; ttfbSummary?: LatencySummary; downloadSummary?: LatencySummary }} LatencyProbeReport
 *
 * @typedef {{
 *     count: number;
 *     ok: number;
 *     failed: number;
 *     minMs: number | null;
 *     p50Ms: number | null;
 *     p95Ms: number | null;
 *     p99Ms: number | null;
 *     maxMs: number | null;
 *     averageMs: number | null;
 * }} LatencySummary
 */

/**
 * @param {{ publicMcpUrl?: string; localMcpUrl?: string; samples?: number; timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runMcpLatencyBenchmark(options = {}) {
    const tunnelConfig = readCloudflareTunnelConfig();
    const publicMcpUrl = normalizeMcpUrl(
        options.publicMcpUrl ??
            process.env['COPILOT_MCP_LATENCY_PUBLIC_URL'] ??
            tunnelConfig.publicMcpUrl ??
            DEFAULT_PUBLIC_MCP_URL,
    );
    const localMcpUrl = normalizeMcpUrl(
        options.localMcpUrl ?? process.env['COPILOT_MCP_LATENCY_LOCAL_URL'] ?? tunnelConfig.localMcpUrl,
    );
    const localOriginServerName = tunnelConfig.originServerName ?? tunnelConfig.publicHostname;
    const directOriginH2 = localMcpUrl.startsWith('https://127.0.0.1') || localMcpUrl.startsWith('https://localhost');
    const samples = readPositiveInteger(
        options.samples ?? process.env['COPILOT_MCP_LATENCY_SAMPLES'],
        DEFAULT_SAMPLES,
        1,
        100,
    );
    const timeoutMs = readPositiveInteger(
        options.timeoutMs ?? process.env['COPILOT_MCP_LATENCY_TIMEOUT_MS'],
        DEFAULT_TIMEOUT_MS,
        500,
        60_000,
    );
    const warmupSamples = readPositiveInteger(process.env['COPILOT_MCP_LATENCY_WARMUP_SAMPLES'], 1, 0, 10);
    const publicBaseUrl = publicMcpUrl.replace(/\/mcp$/u, '');
    const localBaseUrl = localMcpUrl.replace(/\/mcp$/u, '');

    const probes = [
        {
            name: 'local.health',
            run: () =>
                directOriginH2
                    ? timedHttp2OriginRequest(
                          `${localBaseUrl}/health`,
                          { method: 'GET' },
                          timeoutMs,
                          localOriginServerName,
                          [200],
                      )
                    : timedFetch(`${localBaseUrl}/health`, { method: 'GET' }, timeoutMs, [200]),
        },
        {
            name: 'public.protected_resource',
            run: () =>
                timedFetch(`${publicBaseUrl}/.well-known/oauth-protected-resource`, { method: 'GET' }, timeoutMs),
        },
        {
            name: 'public.oauth_metadata',
            run: () =>
                timedFetch(`${publicBaseUrl}/.well-known/oauth-authorization-server`, { method: 'GET' }, timeoutMs),
        },
        {
            name: 'local.mcp_tools_list',
            run: () =>
                directOriginH2
                    ? timedHttp2OriginRequest(
                          localMcpUrl,
                          buildJsonRpcRequest(1, 'tools/list', {}),
                          timeoutMs,
                          localOriginServerName,
                          [200, 401],
                      )
                    : timedJsonRpc(localMcpUrl, 1, 'tools/list', {}, timeoutMs, { acceptedStatuses: [200, 401] }),
        },
        {
            name: 'public.mcp_tools_list',
            run: () => timedJsonRpc(publicMcpUrl, 2, 'tools/list', {}, timeoutMs, { acceptedStatuses: [200, 401] }),
        },
        {
            name: 'public.mcp_tools_list_json_accept',
            run: () =>
                timedJsonRpc(publicMcpUrl, 3, 'tools/list', {}, timeoutMs, {
                    accept: 'application/json',
                    acceptedStatuses: [200, 401],
                }),
        },
        {
            name: 'public.mcp_tools_list_identity_encoding',
            run: () =>
                timedJsonRpc(publicMcpUrl, 4, 'tools/list', {}, timeoutMs, {
                    acceptEncoding: 'identity',
                    acceptedStatuses: [200, 401],
                }),
        },
    ];

    /** @type {LatencyProbeReport[]} */
    const reports = [];
    for (const probe of probes) {
        for (let index = 0; index < warmupSamples; index += 1) {
            await probe.run();
        }
        /** @type {LatencySample[]} */
        const probeSamples = [];
        for (let index = 0; index < samples; index += 1) {
            probeSamples.push(await probe.run());
        }
        reports.push(buildLatencyReport(probe.name, probeSamples));
    }

    const localTools = reports.find((report) => report.name === 'local.mcp_tools_list')?.summary.averageMs ?? null;
    const publicTools = reports.find((report) => report.name === 'public.mcp_tools_list')?.summary.averageMs ?? null;
    const cloudflareOverheadMs =
        localTools !== null && publicTools !== null ? Math.round(publicTools - localTools) : null;

    return {
        ok: reports.every((report) => report.summary.failed === 0),
        publicMcpUrl,
        localMcpUrl,
        samples,
        warmupSamples,
        timeoutMs,
        cloudflareOverheadMs,
        statefulSessionsBenchmarked: false,
        statefulSessionsNote:
            'Stateful MCP sessions are disabled in the production adapter until SDK-safe body replay is available.',
        reports,
    };
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @param {number[]} [acceptedStatuses]
 * @returns {Promise<LatencySample>}
 */
async function timedFetch(url, init, timeoutMs, acceptedStatuses) {
    const startedAt = performance.now();
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        const headersAt = performance.now();
        const body = await readBoundedResponseBytes(response, {
            maxBytes: MAX_BENCHMARK_RESPONSE_BYTES,
            label: 'MCP latency benchmark response',
        });
        const completedAt = performance.now();
        const contentLength = response.headers.get('content-length');
        const expectedStatusMatched = acceptedStatuses?.includes(response.status) ?? response.ok;
        return {
            ok: expectedStatusMatched,
            httpOk: response.ok,
            expectedStatusMatched,
            status: response.status,
            durationMs: Math.round(completedAt - startedAt),
            ttfbMs: Math.round(headersAt - startedAt),
            downloadMs: Math.max(0, Math.round(completedAt - headersAt)),
            bytes: body.byteLength,
            contentLengthHeader: contentLength === null ? null : Number(contentLength),
            contentEncoding: response.headers.get('content-encoding'),
            cfCacheStatus: response.headers.get('cf-cache-status'),
            age: response.headers.get('age'),
            cfRay: response.headers.get('cf-ray'),
            originProtocolMode: response.headers.get('x-mcp-origin-protocol-mode'),
            originHttpVersion: response.headers.get('x-mcp-origin-http-version'),
            originAlpn: response.headers.get('x-mcp-origin-alpn'),
        };
    } catch (error) {
        return {
            ok: false,
            durationMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Direct canonical HTTPS/H2 origin timing probe. The Node client does not trust
 * Cloudflare Origin CA by default, so certificate verification is disabled only
 * for this loopback latency diagnostic; SNI is still set to the configured
 * origin server name. Security posture is validated separately by Cloudflare
 * remote/origin audits where noTLSVerify must remain false.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @param {string} servername
 * @param {number[]} [acceptedStatuses]
 * @returns {Promise<LatencySample>}
 */
async function timedHttp2OriginRequest(url, init, timeoutMs, servername, acceptedStatuses) {
    const startedAt = performance.now();
    const parsed = new URL(url);
    return new Promise((resolve) => {
        let settled = false;
        let headersAt = 0;
        let totalBytes = 0;
        /** @type {Record<string, string | string[] | undefined>} */
        let responseHeaders = {};
        const session = connectHttp2(parsed.origin, {
            servername,
            rejectUnauthorized: false,
        });
        /** @param {LatencySample} sample */
        const finish = (sample) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                session.close();
                session.destroy();
            } catch {
                // Best-effort diagnostic cleanup.
            }
            resolve(sample);
        };
        const timer = setTimeout(() => {
            finish({
                ok: false,
                durationMs: Math.round(performance.now() - startedAt),
                transport: 'direct-origin-http2',
                tlsVerification: 'disabled-loopback-latency-diagnostic',
                error: `Direct origin H2 probe timed out after ${timeoutMs}ms.`,
            });
        }, timeoutMs);
        session.once('error', (error) => {
            finish({
                ok: false,
                durationMs: Math.round(performance.now() - startedAt),
                transport: 'direct-origin-http2',
                tlsVerification: 'disabled-loopback-latency-diagnostic',
                error: error instanceof Error ? error.message : String(error),
            });
        });
        session.once('connect', () => {
            const requestHeaders = new Headers(init.headers);
            /** @type {Record<string, string>} */
            const h2Headers = {
                [http2Constants.HTTP2_HEADER_METHOD]: String(init.method ?? 'GET').toUpperCase(),
                [http2Constants.HTTP2_HEADER_PATH]: `${parsed.pathname}${parsed.search}`,
            };
            for (const [key, value] of requestHeaders.entries()) h2Headers[key] = value;
            const body = typeof init.body === 'string' ? init.body : null;
            if (body !== null && !('content-length' in h2Headers)) {
                h2Headers['content-length'] = String(Buffer.byteLength(body));
            }
            const request = session.request(h2Headers);
            request.once('response', (headers) => {
                headersAt = performance.now();
                responseHeaders = /** @type {Record<string, string | string[] | undefined>} */ (headers);
            });
            request.on('data', (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
                totalBytes += bytes;
                if (totalBytes > MAX_BENCHMARK_RESPONSE_BYTES) {
                    request.close(http2Constants.NGHTTP2_CANCEL);
                    finish({
                        ok: false,
                        durationMs: Math.round(performance.now() - startedAt),
                        transport: 'direct-origin-http2',
                        tlsVerification: 'disabled-loopback-latency-diagnostic',
                        error: `Direct origin H2 response exceeded ${MAX_BENCHMARK_RESPONSE_BYTES} bytes.`,
                    });
                }
            });
            request.once('end', () => {
                const completedAt = performance.now();
                const status = Number(responseHeaders[http2Constants.HTTP2_HEADER_STATUS] ?? 0);
                const httpOk = status >= 200 && status < 300;
                const expectedStatusMatched = acceptedStatuses?.includes(status) ?? httpOk;
                /** @param {string} name @returns {string | null} */
                const headerValue = (name) => {
                    const value = responseHeaders[name];
                    return Array.isArray(value) ? (value[0] ?? null) : typeof value === 'string' ? value : null;
                };
                finish({
                    ok: expectedStatusMatched,
                    httpOk,
                    expectedStatusMatched,
                    status,
                    durationMs: Math.round(completedAt - startedAt),
                    ...(headersAt > 0
                        ? {
                              ttfbMs: Math.round(headersAt - startedAt),
                              downloadMs: Math.max(0, Math.round(completedAt - headersAt)),
                          }
                        : {}),
                    bytes: totalBytes,
                    contentLengthHeader: Number(headerValue('content-length') ?? NaN) || null,
                    contentEncoding: headerValue('content-encoding'),
                    cfCacheStatus: headerValue('cf-cache-status'),
                    age: headerValue('age'),
                    cfRay: null,
                    originProtocolMode: headerValue('x-mcp-origin-protocol-mode'),
                    originHttpVersion: headerValue('x-mcp-origin-http-version'),
                    originAlpn: 'h2',
                    transport: 'direct-origin-http2',
                    tlsVerification: 'disabled-loopback-latency-diagnostic',
                });
            });
            request.once('error', (error) => {
                finish({
                    ok: false,
                    durationMs: Math.round(performance.now() - startedAt),
                    transport: 'direct-origin-http2',
                    tlsVerification: 'disabled-loopback-latency-diagnostic',
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            if (body === null) request.end();
            else request.end(body);
        });
    });
}

/**
 * @param {string} mcpUrl
 * @param {number} id
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {number} timeoutMs
 * @param {{ accept?: string; acceptEncoding?: string; acceptedStatuses?: number[] }} [options]
 * @returns {Promise<LatencySample>}
 */
async function timedJsonRpc(mcpUrl, id, method, params, timeoutMs, options = {}) {
    return timedFetch(
        mcpUrl,
        buildJsonRpcRequest(id, method, params, options),
        timeoutMs,
        options.acceptedStatuses,
    );
}

/**
 * @param {number} id
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {{ accept?: string; acceptEncoding?: string }} [options]
 * @returns {RequestInit}
 */
function buildJsonRpcRequest(id, method, params, options = {}) {
    return {
        method: 'POST',
        headers: {
            accept: options.accept ?? 'application/json, text/event-stream',
            'content-type': 'application/json',
            ...(options.acceptEncoding ? { 'accept-encoding': options.acceptEncoding } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    };
}

/**
 * @param {string} name
 * @param {LatencySample[]} samples
 * @returns {LatencyProbeReport}
 */
function buildLatencyReport(name, samples) {
    return {
        name,
        samples,
        summary: summarizeLatency(samples),
        ttfbSummary: summarizeLatencyField(samples, 'ttfbMs'),
        downloadSummary: summarizeLatencyField(samples, 'downloadMs'),
    };
}

/**
 * @param {LatencySample[]} samples
 * @returns {LatencySummary}
 */
export function summarizeLatency(samples) {
    const okSamples = samples
        .filter((sample) => sample.ok)
        .map((sample) => sample.durationMs)
        .sort((left, right) => left - right);
    return {
        count: samples.length,
        ok: okSamples.length,
        failed: samples.length - okSamples.length,
        minMs: okSamples.length > 0 ? (okSamples[0] ?? null) : null,
        p50Ms: percentile(okSamples, 0.5),
        p95Ms: percentile(okSamples, 0.95),
        p99Ms: percentile(okSamples, 0.99),
        maxMs: okSamples.length > 0 ? (okSamples[okSamples.length - 1] ?? null) : null,
        averageMs:
            okSamples.length > 0
                ? Math.round(okSamples.reduce((sum, value) => sum + value, 0) / okSamples.length)
                : null,
    };
}

/**
 * @param {LatencySample[]} samples
 * @param {'ttfbMs' | 'downloadMs'} field
 * @returns {LatencySummary}
 */
function summarizeLatencyField(samples, field) {
    const fieldSamples = samples
        .map((sample) => ({ ...sample, durationMs: Number(sample[field] ?? NaN) }))
        .filter((sample) => Number.isFinite(sample.durationMs));
    return summarizeLatency(fieldSamples);
}

/**
 * @param {number[]} sortedValues
 * @param {number} quantile
 * @returns {number | null}
 */
function percentile(sortedValues, quantile) {
    if (sortedValues.length === 0) return null;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * quantile) - 1));
    return sortedValues[index] ?? null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runMcpLatencyBenchmark();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report['ok']) process.exitCode = 1;
}
