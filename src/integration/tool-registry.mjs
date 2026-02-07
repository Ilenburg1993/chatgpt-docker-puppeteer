/**
 * Tool Registry (DRY Architecture)
 *
 * Central registry for all LLM-accessible tools.
 * Each tool is implemented ONCE and shared across:
 * - MCP Server (developer LLMs: Claude, OpenCode, Copilot)
 * - REST API (Cursor, Codex)
 * - Direct code calls (program logic: OrchestratorEngine, etc.)
 *
 * Benefits:
 * - DRY: No code duplication between protocols
 * - Consistency: Same implementation for all clients
 * - Testability: Test once, works everywhere
 * - Maintainability: Single source of truth
 *
 * @example
 * // Register a tool
 * registry.register('rag_search', {
 *   description: 'Search codebase',
 *   inputSchema: { type: 'object', properties: {...} }
 * }, async (params) => {
 *   return ragHybridSearch(params);
 * });
 *
 * // Use in MCP server
 * const result = await registry.execute('rag_search', { query: 'foo' });
 *
 * // Use in program code
 * const result = await registry.execute('rag_search', { query: 'bar' });
 */

/**
 * Tool definition structure
 * @typedef {Object} ToolDefinition
 * @property {Object} metadata - Tool metadata for MCP/LSP
 * @property {string} metadata.description - Human-readable description
 * @property {Object} metadata.inputSchema - JSON Schema for parameters
 * @property {Function} handler - Async function (params) => Promise<string|Object>
 */

/**
 * Tool Registry
 * Manages registration and execution of LLM tools
 */
export class ToolRegistry {
    constructor() {
        /** @type {Map<string, ToolDefinition>} */
        this.tools = new Map();
    }

    /**
     * Register a tool in the registry
     *
     * @param {string} name - Tool name (e.g., 'rag_search', 'ollama_generate')
     * @param {Object} metadata - Tool metadata (description, inputSchema)
     * @param {Function} handler - Async function to execute the tool
     *
     * @example
     * registry.register('rag_search', {
     *   description: 'Search codebase semantically',
     *   inputSchema: {
     *     type: 'object',
     *     properties: {
     *       query: { type: 'string', description: 'Search query' }
     *     },
     *     required: ['query']
     *   }
     * }, async ({ query, topK = 5 }) => {
     *   return await ragHybridSearch({ query, topK });
     * });
     */
    register(name, metadata, handler) {
        if (!name || typeof name !== 'string') {
            throw new Error('Tool name must be a non-empty string');
        }

        if (!metadata || typeof metadata !== 'object') {
            throw new Error('Tool metadata must be an object');
        }

        if (!handler || typeof handler !== 'function') {
            throw new Error('Tool handler must be a function');
        }

        if (this.tools.has(name)) {
            console.warn(`[Tool Registry] Overwriting existing tool: ${name}`);
        }

        this.tools.set(name, { metadata, handler });
        console.error(`[Tool Registry] Registered tool: ${name}`);
    }

    /**
     * Execute a tool by name
     *
     * @param {string} name - Tool name
     * @param {Object} params - Tool parameters (validated against inputSchema)
     * @param {Object} options - Execution options (signal for cancellation, etc.)
     * @returns {Promise<string|Object>} Tool result
     *
     * @throws {Error} If tool not found or execution fails
     *
     * @example
     * const result = await registry.execute('rag_search', {
     *   query: 'CHROME_PROXY_PORT',
     *   topK: 5
     * }, {
     *   signal: abortController.signal
     * });
     */
    async execute(name, params = {}, options = {}) {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(`Unknown tool: ${name}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
        }

        // Check if already aborted before starting
        if (options.signal?.aborted) {
            throw new Error(`Tool ${name} was cancelled before execution`);
        }

        console.error(`[Tool Registry] Executing tool: ${name}`);

        // Layer 2 timeout: Tool execution wrapper (75s by default)
        // This sits between MCP handler (90s) and Ollama client (60s)
        const toolTimeout = Number(process.env.TOOL_EXECUTION_TIMEOUT || 75000);
        const internalController = new AbortController();
        const timeoutId = setTimeout(() => internalController.abort(), toolTimeout);

        try {
            // Combine external signal (if any) with internal timeout signal
            const combinedSignal = options.signal
                ? AbortSignal.any([options.signal, internalController.signal])
                : internalController.signal;

            // Pass combined signal to handler
            const result = await tool.handler(params, {
                ...options,
                signal: combinedSignal
            });

            clearTimeout(timeoutId);
            console.error(`[Tool Registry] Tool execution completed: ${name}`);
            return result;

        } catch (error) {
            clearTimeout(timeoutId);

            // Check if internal timeout fired (Layer 2)
            if (internalController.signal.aborted && !options.signal?.aborted) {
                console.error(`[Tool Registry] Tool '${name}' exceeded execution timeout (${toolTimeout}ms)`);
                throw new Error(`Tool '${name}' exceeded execution timeout (${toolTimeout}ms)`);
            }

            // Check if external signal aborted (from MCP handler or user)
            if (error.name === 'AbortError' || options.signal?.aborted) {
                console.error(`[Tool Registry] Tool execution cancelled: ${name}`);
                throw new Error(`Tool ${name} was cancelled`);
            }

            console.error(`[Tool Registry] Tool execution failed: ${name}`, error);
            throw new Error(`Tool ${name} execution failed: ${error.message}`);
        }
    }

    /**
     * Get all tool metadata (for MCP tools/list, LSP capabilities)
     *
     * @returns {Array<{name: string, description: string, inputSchema: Object}>}
     *
     * @example
     * const tools = registry.getAllMetadata();
     * // [
     * //   { name: 'rag_search', description: '...', inputSchema: {...} },
     * //   { name: 'ollama_generate', description: '...', inputSchema: {...} }
     * // ]
     */
    getAllMetadata() {
        return Array.from(this.tools.entries()).map(([name, { metadata }]) => ({
            name,
            ...metadata
        }));
    }

    /**
     * Get metadata for a specific tool
     *
     * @param {string} name - Tool name
     * @returns {Object|null} Tool metadata or null if not found
     */
    getMetadata(name) {
        const tool = this.tools.get(name);
        return tool ? { name, ...tool.metadata } : null;
    }

    /**
     * Check if a tool exists
     *
     * @param {string} name - Tool name
     * @returns {boolean}
     */
    has(name) {
        return this.tools.has(name);
    }

    /**
     * Get list of all registered tool names
     *
     * @returns {string[]}
     */
    getToolNames() {
        return Array.from(this.tools.keys());
    }

    /**
     * Remove a tool from the registry
     *
     * @param {string} name - Tool name
     * @returns {boolean} true if removed, false if not found
     */
    unregister(name) {
        const removed = this.tools.delete(name);
        if (removed) {
            console.error(`[Tool Registry] Unregistered tool: ${name}`);
        }
        return removed;
    }

    /**
     * Clear all tools (mainly for testing)
     */
    clear() {
        this.tools.clear();
        console.error('[Tool Registry] Cleared all tools');
    }

    /**
     * Get registry stats
     *
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            totalTools: this.tools.size,
            tools: this.getToolNames()
        };
    }
}

/**
 * Default registry instance (singleton)
 * Import and use this across the codebase
 */
export const registry = new ToolRegistry();

/**
 * Initialization state
 */
let initialized = false;
let initPromise = null;

/**
 * Initialize registry with all available tools
 * This is idempotent - can be called multiple times safely
 *
 * @returns {Promise<void>}
 *
 * @example
 * import { registry, initialize } from './tool-registry.mjs';
 * await initialize();
 * await registry.execute('rag_search', { query: 'foo' });
 */
export async function initialize() {
    // If already initialized, return immediately
    if (initialized) {
        return;
    }

    // If initialization in progress, return existing promise
    if (initPromise) {
        return initPromise;
    }

    // Start initialization
    console.error('[Tool Registry] Initializing tools...');

    initPromise = (async () => {
        try {
            // Import and register RAG tools
            const { registerRagTools } = await import('./tools/rag-tools.mjs');
            await registerRagTools(registry);

            // Import and register Ollama tools
            const { registerOllamaTools } = await import('./tools/ollama-tools.mjs');
            await registerOllamaTools(registry);

            initialized = true;

            const stats = registry.getStats();
            console.error(`[Tool Registry] Initialization complete: ${stats.totalTools} tools registered`);
            console.error(`[Tool Registry] Available tools: ${stats.tools.join(', ')}`);
        } catch (error) {
            console.error('[Tool Registry] Initialization error:', error);
            // Reset promise so initialization can be retried
            initPromise = null;
            throw error;
        }
    })();

    return initPromise;
}

// Auto-initialize on import (fire-and-forget, for backward compatibility)
// Explicit consumers should call await initialize() to ensure readiness
initialize().catch(err => {
    console.error('[Tool Registry] Auto-initialization failed:', err);
    console.error('[Tool Registry] MCP/API endpoints should explicitly call initialize()');
});
