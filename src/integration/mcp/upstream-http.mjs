/**
 * Minimal MCP (Model Context Protocol) JSON-RPC 2.0 client over HTTP.
 *
 * This is intentionally lightweight:
 * - Works with plain JSON responses (no SSE required)
 * - Supports AbortSignal for cancellation/timeouts
 */

function safeJsonParse(maybeJson) {
    try {
        return JSON.parse(maybeJson);
    } catch {
        return null;
    }
}

function normalizeHeaders(extraHeaders) {
    if (!extraHeaders) return {};
    if (extraHeaders instanceof Headers) {
        return Object.fromEntries(extraHeaders.entries());
    }
    if (typeof extraHeaders === 'object') {
        return extraHeaders;
    }
    return {};
}

export class MCPUpstreamError extends Error {
    constructor(message, { code, data, status } = {}) {
        super(message);
        this.name = 'MCPUpstreamError';
        this.code = code;
        this.data = data;
        this.status = status;
    }
}

export function createMcpHttpClient({ url, headers } = {}) {
    if (!url || typeof url !== 'string') {
        throw new Error('createMcpHttpClient: url must be a non-empty string');
    }

    const baseHeaders = normalizeHeaders(headers);

    async function request({ method, params, signal }) {
        const id = Math.random().toString(16).slice(2);
        const body = {
            jsonrpc: '2.0',
            id,
            method,
            params: params ?? {}
        };

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...baseHeaders
                },
                body: JSON.stringify(body),
                signal
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            throw new MCPUpstreamError(`Upstream fetch failed: ${error?.message || String(error)}`);
        }

        const text = await response.text().catch(() => '');
        const json = safeJsonParse(text);

        if (!response.ok) {
            const upstreamMessage =
                json?.error?.message ||
                (typeof text === 'string' && text.trim() ? text.trim() : response.statusText);

            throw new MCPUpstreamError(`Upstream HTTP ${response.status}: ${upstreamMessage}`, {
                status: response.status,
                code: json?.error?.code,
                data: json?.error?.data
            });
        }

        if (!json || json.jsonrpc !== '2.0') {
            throw new MCPUpstreamError('Upstream returned non-JSON-RPC response', {
                status: response.status,
                data: text
            });
        }

        if (json.error) {
            throw new MCPUpstreamError(json.error.message || 'Upstream JSON-RPC error', {
                status: response.status,
                code: json.error.code,
                data: json.error.data
            });
        }

        return json.result;
    }

    return {
        listTools: ({ signal } = {}) => request({ method: 'tools/list', params: {}, signal }),
        callTool: ({ name, arguments: args = {}, signal } = {}) => {
            return request({
                method: 'tools/call',
                params: { name, arguments: args },
                signal
            });
        },
        listResources: ({ signal } = {}) => request({ method: 'resources/list', params: {}, signal }),
        readResource: ({ uri, signal } = {}) => request({ method: 'resources/read', params: { uri }, signal })
    };
}

