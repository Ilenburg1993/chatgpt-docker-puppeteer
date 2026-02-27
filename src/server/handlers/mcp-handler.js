// @ts-check - Type checking rigoroso habilitado (arquivo core)
/**
 * MCP (Model Context Protocol) Handler for Express
 *
 * Exposes Tool Registry via MCP Streamable HTTP for all LLMs:
 * - Claude Desktop
 * - GitHub Copilot
 * - OpenCode
 *
 * Mounted at: POST/GET /api/mcp
 *
 * Architecture:
 * - Direct JSON-RPC 2.0 implementation (simpler than SDK)
 * - Tool Registry provides unified tool implementations
 * - Same tools available via MCP, REST API, and direct code calls
 */

/**
 * Lightweight, compatible MCP-ish HTTP endpoint.
 *
 * Notes:
 * - Supports core MCP initialization methods enough for common clients.
 * - Does NOT implement SSE streaming, but returns 405 for SSE GET requests
 *   so Streamable HTTP clients can fall back to plain JSON responses.
 */

/**
 * Handler map for MCP methods
 */
const handlers = {
    /**
     * initialize: MCP protocol handshake
     *
     * Minimal implementation: advertises tools/resources capabilities.
     */
    initialize: async (params, registry) => {
        const clientProtocolVersion = params?.protocolVersion;
        const protocolVersion =
            typeof clientProtocolVersion === 'string' && clientProtocolVersion.trim()
                ? clientProtocolVersion
                : '2024-11-05';

        return {
            protocolVersion,
            capabilities: {
                tools: {},
                resources: {},
            },
            serverInfo: {
                name: 'chatgpt-docker-unified',
                version: '4.0.0',
            },
            instructions: `Tools: ${registry.getToolNames().join(', ')}`,
        };
    },

    /**
     * notifications/initialized: client indicates init is complete
     * Notification (no response expected).
     */
    'notifications/initialized': async () => {
        console.error('[MCP Handler] notifications/initialized');
        return {};
    },

    /**
     * notifications/cancelled: client notifies that a request was cancelled
     * Notification (no response expected).
     */
    'notifications/cancelled': async params => {
        console.error('[MCP Handler] notifications/cancelled (legacy handler):', params);
        return {};
    },

    /**
     * ping: liveness check
     */
    ping: async () => {
        return {};
    },

    /**
     * tools/list: Return all available tools from registry
     */
    'tools/list': async (params, registry) => {
        console.error('[MCP Handler] tools/list request');
        const tools = registry.getAllMetadata();
        console.error(`[MCP Handler] Returning ${tools.length} tools`);
        return { tools };
    },

    /**
     * tools/call: Execute a tool by name
     */
    'tools/call': async (params, registry, context = {}) => {
        const { name, arguments: args = {} } = params;

        console.error(`[MCP Handler] tools/call: ${name}`);

        // MCP layer timeout (90s by default, wraps TOOL_EXECUTION_TIMEOUT)
        const timeout = Number(context.timeoutMs || process.env.MCP_TOOL_TIMEOUT || 90000);
        const controller = context.controller || new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const result = await registry.execute(name, args, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // If tool already returns MCP tool result shape, preserve it.
            if (result && typeof result === 'object' && Array.isArray(result.content)) {
                return result;
            }

            const normalized = normalizeToolResultPayload(result);
            const isRagTool = typeof name === 'string' && name.startsWith('rag_');
            const normalizedData =
                normalized.json !== undefined ? normalized.json : isRagTool ? { fallback: true } : undefined;

            // MCP-compatible payload + structured content
            return {
                content: [
                    {
                        type: 'text',
                        text: normalized.text,
                    },
                ],
                structuredContent: {
                    ...(normalizedData !== undefined ? { data: normalizedData } : {}),
                    flags: normalized.flags,
                },
            };
        } catch (error) {
            clearTimeout(timeoutId);

            // Check if aborted (timeout)
            if (controller.signal.aborted) {
                console.error(`[MCP Handler] Tool '${name}' was aborted after ${timeout}ms`);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Tool "${name}" timed out after ${timeout}ms and was cancelled.\n\nTip: Reduce max_tokens or use qwen2.5-coder:3b model for faster CPU inference.`,
                        },
                    ],
                    isError: true,
                };
            }

            // Regular error
            console.error(`[MCP Handler] Tool execution error:`, error);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing tool "${name}": ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    },

    /**
     * resources/list: Return available resources
     */
    'resources/list': async () => {
        console.error('[MCP Handler] resources/list request');

        return {
            resources: [
                {
                    uri: 'rag://stats',
                    name: 'RAG Runtime Statistics',
                    mimeType: 'application/json',
                    description: 'RAG cache, index freshness, chunk schema and expand health',
                },
            ],
        };
    },

    /**
     * resources/read: Read resource content
     */
    'resources/read': async params => {
        const { uri } = params;

        console.error(`[MCP Handler] resources/read: ${uri}`);

        if (uri === 'rag://stats') {
            try {
                // Import facade dynamically to get cache stats
                const { getRagCacheStats, getRagIndexStatus, getRagStorageStats } =
                    await import('../../../tools/rag/lib/facade.mjs');
                const stats = getRagCacheStats();
                const index = await getRagIndexStatus();
                const storage = await getRagStorageStats();
                const payload = {
                    ...stats,
                    index,
                    storage,
                    expand_health: {
                        enabled: true,
                        default_lines: Number(process.env.RAG_EXPAND_DEFAULT_LINES || 40),
                        max_lines: Number(process.env.RAG_EXPAND_MAX_LINES || 240),
                    },
                };

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(payload, null, 2),
                        },
                    ],
                };
            } catch (error) {
                throw new Error(`Failed to read resource ${uri}: ${error.message}`); // eslint-disable-line preserve-caught-error
            }
        }

        throw new Error(`Unknown resource: ${uri}`);
    },
};

/**
 * Configura endpoint MCP (Model Context Protocol) no servidor Express.
 *
 * **Side-effects:** Registra rotas POST/GET /api/mcp no app Express.
 * **Semântica:** Suporte completo a JSON-RPC 2.0 com batch requests, notifications e SSE discovery.
 *
 * @param {Express.Application} app - Instância do Express app
 * @param {ToolRegistry} registry - Registry de ferramentas MCP
 * @returns {void}
 */
export function setupMCPHandler(app, registry) {
    console.error('[MCP Handler] Setting up MCP endpoint...');
    /** @type {Map<string, AbortController>} */
    const pendingRequests = new Map();

    /**
     * POST /api/mcp: MCP JSON-RPC 2.0 endpoint
     *
     * Accepts JSON-RPC 2.0 requests and routes to appropriate handler
     */
    app.post('/api/mcp', async (req, res) => {
        try {
            console.error('[MCP Handler] POST /api/mcp received');

            const payload = req.body;

            const handleOne = async msg => {
                const { jsonrpc, id, method, params = {} } = msg || {};
                const requestKey = id === undefined || id === null ? null : String(id);

                // Validate JSON-RPC version
                if (jsonrpc !== '2.0') {
                    return {
                        httpStatus: 400,
                        json: {
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32600,
                                message: 'Invalid Request: jsonrpc must be "2.0"',
                            },
                        },
                    };
                }

                // Find handler for method
                const handler = handlers[method];
                if (!handler) {
                    return {
                        httpStatus: 404,
                        json: {
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32601,
                                message: `Method not found: ${method}`,
                            },
                        },
                    };
                }

                // Notifications (no id) should not return a JSON-RPC response
                const isNotification = id === undefined || id === null;
                if (isNotification) {
                    if (method === 'notifications/cancelled') {
                        const targetId = params?.requestId ?? params?.id ?? params?.request_id;
                        const targetKey = targetId === undefined || targetId === null ? null : String(targetId);
                        const controller = targetKey ? pendingRequests.get(targetKey) : null;
                        if (controller) {
                            controller.abort();
                            pendingRequests.delete(targetKey);
                            console.error(`[MCP Handler] Cancelled request ${targetKey}`);
                        } else {
                            console.error(`[MCP Handler] Cancellation received for unknown request ${targetKey}`);
                        }
                    }
                    await handler(params, registry);
                    return { httpStatus: 202, json: null };
                }

                if (method === 'tools/call' && requestKey) {
                    const controller = new AbortController();
                    pendingRequests.set(requestKey, controller);
                    try {
                        const result = await handler(params, registry, {
                            controller,
                            timeoutMs: Number(process.env.MCP_TOOL_TIMEOUT || 90000),
                        });
                        return { httpStatus: 200, json: { jsonrpc: '2.0', id, result } };
                    } finally {
                        pendingRequests.delete(requestKey);
                    }
                }

                const result = await handler(params, registry, {});
                return { httpStatus: 200, json: { jsonrpc: '2.0', id, result } };
            };

            // Batch support
            if (Array.isArray(payload)) {
                const results = (await Promise.all(payload.map(handleOne))).map(r => r?.json).filter(Boolean);
                if (results.length === 0) {
                    return res.status(202).end();
                }
                return res.json(results);
            }

            const single = await handleOne(payload);
            if (!single?.json) {
                return res.status(202).end();
            }

            res.status(single.httpStatus || 200).json(single.json);
        } catch (error) {
            console.error('[MCP Handler] Error:', error);

            res.status(500).json({
                jsonrpc: '2.0',
                id: Array.isArray(req.body) ? null : req.body?.id,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message,
                },
            });
        }
    });

    /**
     * GET /api/mcp: Discovery endpoint
     *
     * Returns server info, available tools, and methods
     */
    app.get('/api/mcp', (req, res) => {
        // Streamable HTTP clients (like Kilo) may probe a GET SSE stream by
        // sending `Accept: text/event-stream`.  Historically we replied 405 to
        // signal "SSE not supported" so others would fall back to JSON.  that
        // behaviour, however, causes clients which treat any non-200 status as a
        // failure to repeatedly reconnect and eventually drop the server entry.
        //
        // Instead we now ignore the Accept header and simply return the normal
        // discovery payload regardless of whether the probe looked for SSE.  the
        // presence of `sse: false` in the JSON makes the intent explicit.
        //
        // This keeps the connector stable (Kilo will see a 200 and stop restarting)
        // while preserving backward compatibility with clients that reject
        // unexpected content-types.

        /* eslint-disable no-unused-vars */
        const accept = String(req.headers?.accept || '');
        /* eslint-enable no-unused-vars */

        res.json({
            sse: false, // explicit hint to clients that streaming is not available
            name: 'chatgpt-docker-unified',
            version: '4.0.0',
            protocol: 'MCP/JSON-RPC 2.0',
            endpoint: '/api/mcp',
            methods: Object.keys(handlers),
            tools: registry.getToolNames(),
            toolCount: registry.getStats().totalTools,
            status: 'ready',
        });
    });

    console.error('[MCP Handler] MCP endpoint ready at POST/GET /api/mcp');
    console.error(`[MCP Handler] Exposed ${registry.getStats().totalTools} tools`);
}
function normalizeToolResultPayload(value) {
    if (value && typeof value === 'object' && Array.isArray(value.content)) {
        return {
            text: JSON.stringify(value, null, 2),
            json: value.structuredContent,
            flags: { degraded: false, mutating: false, partial: false },
        };
    }

    if (value && typeof value === 'object' && typeof value.text === 'string') {
        return {
            text: value.text,
            json: value.json,
            flags: {
                degraded: Boolean(value.flags?.degraded),
                mutating: Boolean(value.flags?.mutating),
                partial: Boolean(value.flags?.partial),
            },
        };
    }

    if (typeof value === 'string') {
        return {
            text: value,
            flags: { degraded: false, mutating: false, partial: false },
        };
    }

    return {
        text: JSON.stringify(value, null, 2),
        json: value,
        flags: { degraded: false, mutating: false, partial: false },
    };
}
