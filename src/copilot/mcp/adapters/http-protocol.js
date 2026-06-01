// @ts-check
/**
 * Protocol telemetry helpers for the Copilot MCP HTTP adapters.
 *
 * The helpers intentionally avoid request-body inspection and never record query strings, authorization data, cookies,
 * request IDs or payload fragments. They only retain low-cardinality transport/protocol metadata so the MCP Streamable
 * HTTP SDK can keep exclusive ownership of JSON-RPC request-body parsing.
 *
 * This module is compatible with Node HTTP/1.1 servers and Node HTTP/2 compatibility servers. It is written for the
 * canonical HTTP/2+ deployment policy used by the Cloudflare-backed MCP endpoint, while still making HTTP/1.1 fallback
 * visible in health/diagnostic output.
 *
 * Version: 1.1.0
 *
 * @module copilot/mcp/adapters/http-protocol
 */

const UNKNOWN = 'unknown';
const NONE = 'none';
const MAX_COUNT_KEYS = 32;
const MAX_PATH_LENGTH = 160;
const MAX_PROTOCOL_MODE_LENGTH = 40;
const HEADER_SAFE_VALUE_RE = /^[\t\x20-\x7e]+$/u;
const HTTP_VERSION_RE = /^\d+(?:\.\d+)?$/u;
const MAX_SAFE_OBSERVED_REQUESTS = Number.MAX_SAFE_INTEGER - 1;
const DEFAULT_HTTP2_PLUS_PROTOCOLS = /** @type {const} */ (['h2', 'h3']);

/**
 * @typedef {'http1' | 'http2' | 'http2+' | 'auto' | 'unknown' | string} McpHttpProtocolMode
 */

/**
 * @typedef {object} McpHttpProtocolSample
 * @property {string} protocolMode
 * @property {string} httpVersion
 * @property {number | null} httpVersionMajor
 * @property {string | null} alpnProtocol
 * @property {boolean} encrypted
 * @property {boolean} http2Plus
 * @property {string} transportClass
 * @property {string | null} method
 * @property {string | null} path
 * @property {number} observedAt
 */

/**
 * @typedef {object} McpHttpProtocolState
 * @property {string} protocolMode
 * @property {number} observedRequests
 * @property {Record<string, number>} httpVersionCounts
 * @property {Record<string, number>} alpnCounts
 * @property {Record<string, number>} transportClassCounts
 * @property {McpHttpProtocolSample | null} lastRequest
 * @property {number} startedAt
 * @property {boolean} http2PlusDefault
 */

/**
 * Create a bounded, low-cardinality protocol telemetry state object.
 *
 * @param {McpHttpProtocolMode} protocolMode
 * @returns {McpHttpProtocolState}
 */
export function createMcpHttpProtocolState(protocolMode) {
    const normalizedProtocolMode = normalizeProtocolMode(protocolMode);
    return {
        protocolMode: normalizedProtocolMode,
        observedRequests: 0,
        httpVersionCounts: /** @type {Record<string, number>} */ (Object.create(null)),
        alpnCounts: /** @type {Record<string, number>} */ (Object.create(null)),
        transportClassCounts: /** @type {Record<string, number>} */ (Object.create(null)),
        lastRequest: null,
        startedAt: Date.now(),
        http2PlusDefault: isHttp2PlusProtocolMode(normalizedProtocolMode),
    };
}

/**
 * Record one request's transport metadata without touching the request body.
 *
 * @param {McpHttpProtocolState} state
 * @param {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} req
 * @returns {McpHttpProtocolSample}
 */
export function recordMcpHttpProtocolRequest(state, req) {
    const sample = buildMcpHttpProtocolSample(state.protocolMode, req);
    state.observedRequests = saturatingIncrement(state.observedRequests);
    state.lastRequest = sample;
    incrementBoundedCount(state.httpVersionCounts, sample.httpVersion);
    incrementBoundedCount(state.alpnCounts, sample.alpnProtocol ?? NONE);
    incrementBoundedCount(state.transportClassCounts, sample.transportClass);
    return sample;
}

/**
 * Emit debug headers that are safe for diagnostics and Cloudflare/origin verification.
 *
 * These headers intentionally disclose only protocol class, HTTP version and ALPN. They do not include client IPs, path
 * queries, authorization metadata, cookies or request identifiers.
 *
 * @param {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} res
 * @param {McpHttpProtocolSample} sample
 * @returns {void}
 */
export function setMcpHttpProtocolResponseHeaders(res, sample) {
    if (res.headersSent) return;
    safeSetHeader(res, 'X-MCP-Origin-Protocol-Mode', sample.protocolMode);
    safeSetHeader(res, 'X-MCP-Origin-HTTP-Version', sample.httpVersion);
    safeSetHeader(res, 'X-MCP-Origin-Transport-Class', sample.transportClass);
    safeSetHeader(res, 'X-MCP-Origin-HTTP2-Plus', sample.http2Plus ? 'true' : 'false');
    if (sample.alpnProtocol) safeSetHeader(res, 'X-MCP-Origin-ALPN', sample.alpnProtocol);
}

/**
 * Build a copy-safe report for health/status payloads.
 *
 * @param {McpHttpProtocolState} state
 * @returns {Record<string, unknown>}
 */
export function buildMcpHttpProtocolReport(state) {
    const lastRequest = state.lastRequest ? { ...state.lastRequest } : null;
    return {
        protocolMode: state.protocolMode,
        http2PlusDefault: Boolean(state.http2PlusDefault),
        http2PlusObserved: Boolean(lastRequest?.http2Plus),
        observedRequests: state.observedRequests,
        httpVersionCounts: { ...state.httpVersionCounts },
        alpnCounts: { ...state.alpnCounts },
        transportClassCounts: { ...state.transportClassCounts },
        lastRequest,
        startedAt: state.startedAt,
        uptimeMs: Math.max(0, Date.now() - state.startedAt),
    };
}

/**
 * Return true when a sample shows HTTP/2-or-better semantics at the Node origin.
 *
 * @param {McpHttpProtocolSample | null | undefined} sample
 * @returns {boolean}
 */
export function isMcpHttp2PlusSample(sample) {
    return Boolean(sample?.http2Plus);
}

/**
 * Return true when the configured server mode is expected to prefer HTTP/2+.
 *
 * @param {string} protocolMode
 * @returns {boolean}
 */
export function isHttp2PlusProtocolMode(protocolMode) {
    const normalized = normalizeProtocolMode(protocolMode);
    return normalized === 'http2' || normalized === 'http2+' || normalized === 'auto';
}

/**
 * @param {McpHttpProtocolMode} protocolMode
 * @param {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} req
 * @returns {McpHttpProtocolSample}
 */
function buildMcpHttpProtocolSample(protocolMode, req) {
    const socketInfo = readRequestSocketInfo(req);
    const alpnProtocol = normalizeAlpnProtocol(socketInfo.alpnProtocol);
    const encrypted = Boolean(socketInfo.encrypted);
    const httpVersion = normalizeHttpVersion(req.httpVersion);
    const httpVersionMajor = normalizeHttpVersionMajor(req.httpVersionMajor, httpVersion);
    const transportClass = classifyTransport(httpVersion, httpVersionMajor, alpnProtocol, encrypted);
    const url = req.url ?? null;
    return {
        protocolMode: normalizeProtocolMode(protocolMode),
        httpVersion,
        httpVersionMajor,
        alpnProtocol,
        encrypted,
        http2Plus: isHttp2Plus(httpVersion, httpVersionMajor, alpnProtocol),
        transportClass,
        method: normalizeMethod(req.method),
        path: typeof url === 'string' ? safePathname(url) : null,
        observedAt: Date.now(),
    };
}

/**
 * Read transport metadata from both Node HTTP/1.1 requests and HTTP/2 compatibility requests.
 *
 * For HTTP/2 compatibility mode, ALPN/TLS state is exposed on req.stream.session.socket, not consistently on
 * req.socket. The adapter keeps this lookup body-neutral and low-cardinality.
 *
 * @param {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} req
 * @returns {{ alpnProtocol: unknown; encrypted: boolean }}
 */
function readRequestSocketInfo(req) {
    const request = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (req));
    const directSocket = /** @type {Record<string, unknown> | undefined} */ (request['socket']);
    const stream = /** @type {Record<string, unknown> | undefined} */ (request['stream']);
    const session = /** @type {Record<string, unknown> | undefined} */ (stream?.['session']);
    const sessionSocket = /** @type {Record<string, unknown> | undefined} */ (session?.['socket']);
    const socket = sessionSocket ?? directSocket;
    return {
        alpnProtocol: socket?.['alpnProtocol'],
        encrypted: Boolean(socket?.['encrypted']),
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeProtocolMode(value) {
    const normalized = normalizeToken(value, MAX_PROTOCOL_MODE_LENGTH) ?? UNKNOWN;
    if (normalized === 'h2') return 'http2';
    if (normalized === 'h2-plus' || normalized === 'http2plus') return 'http2+';
    if (normalized === 'h1' || normalized === 'http') return 'http1';
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHttpVersion(value) {
    const normalized = normalizeToken(value, 16);
    if (!normalized || !HTTP_VERSION_RE.test(normalized)) return UNKNOWN;
    return normalized;
}

/**
 * @param {unknown} major
 * @param {string} httpVersion
 * @returns {number | null}
 */
function normalizeHttpVersionMajor(major, httpVersion) {
    if (Number.isInteger(major) && Number(major) >= 0 && Number(major) <= 9) return Number(major);
    const parsed = Number(httpVersion.split('.')[0]);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 9 ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeAlpnProtocol(value) {
    const normalized = normalizeToken(value, 24);
    if (!normalized || normalized === NONE || normalized === UNKNOWN) return null;
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeMethod(value) {
    const normalized = normalizeToken(value, 16);
    return normalized ? normalized.toUpperCase() : null;
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
function normalizeToken(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    const safe = normalized.replace(/[^a-z0-9.+_-]/gu, '-');
    return safe.slice(0, maxLength) || null;
}

/**
 * @param {string} httpVersion
 * @param {number | null} httpVersionMajor
 * @param {string | null} alpnProtocol
 * @returns {boolean}
 */
function isHttp2Plus(httpVersion, httpVersionMajor, alpnProtocol) {
    if (typeof httpVersionMajor === 'number' && httpVersionMajor >= 2) return true;
    if (httpVersion !== UNKNOWN && Number(httpVersion.split('.')[0]) >= 2) return true;
    return Boolean(alpnProtocol && DEFAULT_HTTP2_PLUS_PROTOCOLS.includes(/** @type {'h2' | 'h3'} */ (alpnProtocol)));
}

/**
 * @param {string} httpVersion
 * @param {number | null} httpVersionMajor
 * @param {string | null} alpnProtocol
 * @param {boolean} encrypted
 * @returns {string}
 */
function classifyTransport(httpVersion, httpVersionMajor, alpnProtocol, encrypted) {
    if (alpnProtocol === 'h3') return encrypted ? 'http3-tls' : 'http3';
    if (isHttp2Plus(httpVersion, httpVersionMajor, alpnProtocol))
        return encrypted ? 'http2-tls' : 'http2-cleartext-or-compat';
    if (httpVersion === '1.1') return encrypted ? 'http1.1-tls' : 'http1.1-cleartext-or-proxy';
    if (httpVersion === '1.0') return encrypted ? 'http1.0-tls' : 'http1.0-cleartext-or-proxy';
    return encrypted ? 'unknown-tls' : UNKNOWN;
}

/**
 * @param {number} value
 * @returns {number}
 */
function saturatingIncrement(value) {
    return Number.isSafeInteger(value) && value < MAX_SAFE_OBSERVED_REQUESTS ? value + 1 : MAX_SAFE_OBSERVED_REQUESTS;
}

/**
 * @param {Record<string, number>} counts
 * @param {string} key
 * @returns {void}
 */
function incrementBoundedCount(counts, key) {
    const normalizedKey = normalizeCountKey(key);
    if (Object.prototype.hasOwnProperty.call(counts, normalizedKey)) {
        counts[normalizedKey] = saturatingIncrement(counts[normalizedKey] ?? 0);
        return;
    }
    const currentKeys = Object.keys(counts);
    if (currentKeys.length >= MAX_COUNT_KEYS) {
        counts['other'] = saturatingIncrement(counts['other'] ?? 0);
        return;
    }
    counts[normalizedKey] = 1;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeCountKey(value) {
    return normalizeToken(value, 40) ?? UNKNOWN;
}

/**
 * Return only a bounded pathname. Query strings and fragments are intentionally discarded.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function safePathname(rawUrl) {
    try {
        if (rawUrl === '*') return '*';
        const parsed = new URL(rawUrl, 'http://localhost');
        return truncatePathname(parsed.pathname || '/');
    } catch {
        const queryIndex = rawUrl.indexOf('?');
        const hashIndex = rawUrl.indexOf('#');
        const firstTerminator = [queryIndex, hashIndex]
            .filter((index) => index >= 0)
            .sort((left, right) => left - right)[0];
        const withoutSensitiveSuffix = firstTerminator === undefined ? rawUrl : rawUrl.slice(0, firstTerminator);
        return truncatePathname(withoutSensitiveSuffix || '/');
    }
}

/**
 * @param {string} pathname
 * @returns {string}
 */
function truncatePathname(pathname) {
    const normalized = pathname.startsWith('/') || pathname === '*' ? pathname : `/${pathname}`;
    if (normalized.length <= MAX_PATH_LENGTH) return normalized;
    return `${normalized.slice(0, MAX_PATH_LENGTH - 12)}…truncated`;
}

/**
 * @param {import('node:http').ServerResponse | import('node:http2').Http2ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function safeSetHeader(res, name, value) {
    const safeValue = normalizeHeaderValue(value);
    if (!safeValue) return;
    try {
        res.setHeader(name, safeValue);
    } catch {
        // Header setting is best-effort telemetry and must never break MCP request handling.
    }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeHeaderValue(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 120 || !HEADER_SAFE_VALUE_RE.test(normalized)) return null;
    return normalized;
}
