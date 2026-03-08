// @ts-check
/**
 * Minimal MCP (Model Context Protocol) JSON-RPC 2.0 client over HTTP.
 *
 * This is intentionally lightweight:
 *
 * - Works with plain JSON responses (no SSE required)
 * - Supports AbortSignal for cancellation/timeouts
 */

function safeJsonParse(/** @type {any} */ maybeJson) {
    try {
        return JSON.parse(maybeJson);
    } catch {
        return null;
    }
}

function normalizeHeaders(/** @type {any} */ extraHeaders) {
    if (!extraHeaders) return {};
    if (extraHeaders instanceof Headers) {
        return Object.fromEntries(extraHeaders.entries());
    }
    if (typeof extraHeaders === 'object') {
        return extraHeaders;
    }
    return {};
}

/** Classe exportada: MCPUpstreamError. */
export class MCPUpstreamError extends Error {
    /**
     * @param {string} message
     * @param {{ code?: number | string; data?: unknown; status?: number }} [meta]
     */
    constructor(message, { code, data, status } = {}) {
        super(message);
        this.name = 'MCPUpstreamError';
        if (code !== undefined) this.code = code;
        if (data !== undefined) this.data = data;
        if (status !== undefined) this.status = status;
    }
}

/**
 * @typedef {object} CreateMcpHttpClientConfig
 * @property {string} url
 * @property {any} headers
 */
/**
 * @param {CreateMcpHttpClientConfig} [config]
 * @returns {any}
 */
export function createMcpHttpClient(/** @type {any} */ config = {}) {
    const { url, headers } = /** @type {{ url?: string; headers?: Headers | Record<string, string> }} */ (config);
    if (!url || typeof url !== 'string') {
        throw new Error('createMcpHttpClient: url must be a non-empty string');
    }

    const baseHeaders = normalizeHeaders(headers);

    /**
     * @param {{ method: string; params?: Record<string, unknown> | undefined; signal?: AbortSignal | undefined }} payload
     */
    async function request({ method, params, signal }) {
        const id = Math.random().toString(16).slice(2);
        const body = {
            jsonrpc: '2.0',
            id,
            method,
            params: params ?? {},
        };

        let response;
        try {
            response = await fetch(/** @type {string} */ (url), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...baseHeaders,
                },
                body: JSON.stringify(body),
                ...(signal !== undefined ? { signal } : {}),
            });
        } catch (/** @type {any} */ _raw_error) {
            const error = /** @type {any} */ (_raw_error);
            if (error?.name === 'AbortError') {
                throw error;
            }
            throw new MCPUpstreamError(`Upstream fetch failed: ${error?.message || String(error)}`);
        }

        const text = await response.text().catch(() => '');
        const json = safeJsonParse(text);

        if (!response.ok) {
            const upstreamMessage =
                json?.error?.message || (typeof text === 'string' && text.trim() ? text.trim() : response.statusText);

            throw new MCPUpstreamError(`Upstream HTTP ${response.status}: ${upstreamMessage}`, {
                status: response.status,
                code: json?.error?.code,
                data: json?.error?.data,
            });
        }

        if (!json || json.jsonrpc !== '2.0') {
            throw new MCPUpstreamError('Upstream returned non-JSON-RPC response', {
                status: response.status,
                data: text,
            });
        }

        if (json.error) {
            throw new MCPUpstreamError(json.error.message || 'Upstream JSON-RPC error', {
                status: response.status,
                code: json.error.code,
                data: json.error.data,
            });
        }

        return json.result;
    }

    return {
        /** @param {{ signal?: AbortSignal }} [payload] */
        listTools: ({ signal } = {}) => request({ method: 'tools/list', params: {}, signal }),
        /** @param {{ name?: string; arguments?: Record<string, unknown>; signal?: AbortSignal }} [payload] */
        callTool: ({ name, arguments: args = {}, signal } = {}) => {
            if (!name) {
                throw new Error('tools/call requires name');
            }
            return request({
                method: 'tools/call',
                params: { name, arguments: args },
                signal,
            });
        },
        /** @param {{ signal?: AbortSignal }} [payload] */
        listResources: ({ signal } = {}) => request({ method: 'resources/list', params: {}, signal }),
        /** @param {{ uri?: string; signal?: AbortSignal }} [payload] */
        readResource: ({ uri, signal } = {}) => {
            if (!uri) {
                throw new Error('resources/read requires uri');
            }
            return request({ method: 'resources/read', params: { uri }, signal });
        },
    };
}
