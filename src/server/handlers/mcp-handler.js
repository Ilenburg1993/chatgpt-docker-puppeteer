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
 * Handler map for MCP methods
 */
const handlers = {
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
 * Setup MCP handler on Express app
 *
 * Registers POST/GET /api/mcp endpoint that:
 * 1. Lists all tools from Tool Registry (tools/list)
 * 2. Executes tools by name (tools/call)
 * 3. Provides resources (optional: cache stats)
 *
 * @param {Express.Application} app - Express app instance
 * @param {ToolRegistry} registry - Tool registry instance
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

            // Parse JSON-RPC request
            const { jsonrpc, id, method, params = {} } = req.body;

            // Validate JSON-RPC version
            if (jsonrpc !== '2.0') {
                return res.status(400).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32600,
                        message: 'Invalid Request: jsonrpc must be "2.0"'
                    }
                });
            }

            // Find handler for method
            const handler = handlers[method];

            if (!handler) {
                return res.status(404).json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}`
                    }
                });
            }

            // Execute handler
            const result = await handler(params, registry);

            // Return JSON-RPC response
            res.json({
                jsonrpc: '2.0',
                id,
                result
            });

        } catch (error) {
            console.error('[MCP Handler] Error:', error);

            res.status(500).json({
                jsonrpc: '2.0',
                id: req.body?.id,
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
