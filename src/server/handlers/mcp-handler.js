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
    'initialize': async (params, registry) => {
        const clientProtocolVersion = params?.protocolVersion;
        const protocolVersion =
            typeof clientProtocolVersion === 'string' && clientProtocolVersion.trim()
                ? clientProtocolVersion
                : '2024-11-05';

        return {
            protocolVersion,
            capabilities: {
                tools: {},
                resources: {}
            },
            serverInfo: {
                name: 'chatgpt-docker-unified',
                version: '4.0.0'
            },
            instructions: `Tools: ${registry.getToolNames().join(', ')}`
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
    'notifications/cancelled': async (params) => {
        console.error('[MCP Handler] notifications/cancelled:', params);
        return {};
    },

    /**
     * ping: liveness check
     */
    'ping': async () => {
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
    'tools/call': async (params, registry) => {
        const { name, arguments: args = {} } = params;

        console.error(`[MCP Handler] tools/call: ${name}`);

        // MCP layer timeout (90s by default, wraps Ollama 60s timeout)
        const timeout = Number(process.env.MCP_TOOL_TIMEOUT || 90000);

        // Create AbortController for cancellation
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            // Pass signal to tool execution for proper cancellation
            const result = await registry.execute(name, args, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // If tool already returns MCP tool result shape, preserve it.
            if (result && typeof result === 'object' && Array.isArray(result.content)) {
                return result;
            }

            // MCP expects content array format
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }
                ]
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
                            text: `Tool "${name}" timed out after ${timeout}ms and was cancelled.\n\nTip: Reduce max_tokens or use qwen2.5-coder:3b model for faster CPU inference.`
                        }
                    ],
                    isError: true
                };
            }

            // Regular error
            console.error(`[MCP Handler] Tool execution error:`, error);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing tool "${name}": ${error.message}`
                    }
                ],
                isError: true
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
                    name: 'RAG Cache Statistics',
                    mimeType: 'application/json',
                    description: 'Current RAG cache hit rate and performance stats'
                }
            ]
        };
    },

    /**
     * resources/read: Read resource content
     */
    'resources/read': async (params) => {
        const { uri } = params;

        console.error(`[MCP Handler] resources/read: ${uri}`);

        if (uri === 'rag://stats') {
            try {
                // Import facade dynamically to get cache stats
                const { getRagCacheStats } = await import('../../../tools/rag/lib/facade.mjs');
                const stats = getRagCacheStats();

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(stats, null, 2)
                        }
                    ]
                };
            } catch (error) {
                throw new Error(`Failed to read resource ${uri}: ${error.message}`);
            }
        }

        throw new Error(`Unknown resource: ${uri}`);
    }
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

    /**
     * POST /api/mcp: MCP JSON-RPC 2.0 endpoint
     *
     * Accepts JSON-RPC 2.0 requests and routes to appropriate handler
     */
    app.post('/api/mcp', async (req, res) => {
        try {
            console.error('[MCP Handler] POST /api/mcp received');

            const payload = req.body;

            const handleOne = async (msg) => {
                const { jsonrpc, id, method, params = {} } = msg || {};

                // Validate JSON-RPC version
                if (jsonrpc !== '2.0') {
                    return {
                        httpStatus: 400,
                        json: {
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32600,
                                message: 'Invalid Request: jsonrpc must be "2.0"'
                            }
                        }
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
                                message: `Method not found: ${method}`
                            }
                        }
                    };
                }

                // Notifications (no id) should not return a JSON-RPC response
                const isNotification = id === undefined || id === null;
                if (isNotification) {
                    await handler(params, registry);
                    return { httpStatus: 202, json: null };
                }

                const result = await handler(params, registry);
                return { httpStatus: 200, json: { jsonrpc: '2.0', id, result } };
            };

            // Batch support
            if (Array.isArray(payload)) {
                const results = (await Promise.all(payload.map(handleOne)))
                    .map((r) => r?.json)
                    .filter(Boolean);
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
                    data: error.message
                }
            });
        }
    });

    /**
     * GET /api/mcp: Discovery endpoint
     *
     * Returns server info, available tools, and methods
     */
    app.get('/api/mcp', (req, res) => {
        // Streamable HTTP clients may probe a GET SSE stream with Accept: text/event-stream.
        // We do not currently support SSE; return 405 so clients can fall back to plain JSON.
        const accept = String(req.headers?.accept || '');
        if (accept.includes('text/event-stream')) {
            return res.status(405).send('SSE stream not supported on this endpoint');
        }

        res.json({
            name: 'chatgpt-docker-unified',
            version: '4.0.0',
            protocol: 'MCP/JSON-RPC 2.0',
            endpoint: '/api/mcp',
            methods: Object.keys(handlers),
            tools: registry.getToolNames(),
            toolCount: registry.getStats().totalTools,
            status: 'ready'
        });
    });

    console.error('[MCP Handler] MCP endpoint ready at POST/GET /api/mcp');
    console.error(`[MCP Handler] Exposed ${registry.getStats().totalTools} tools`);
}
