// @ts-check
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
 * @typedef {object} ToolDefinition
 * @property {object} metadata - Tool metadata for MCP/LSP
 * @property {string} metadata.description - Human-readable description
 * @property {object} metadata.inputSchema - JSON Schema for parameters
 * @property {boolean} [metadata.allowMutations=false] - Tool may mutate files/state
 * @property {boolean} [metadata.requiresConfirmationToken=false] - Tool requires explicit confirmation token
 * @property {function} handler - Async function (params) => Promise<string|object>
 */

/**
 * @typedef {object} NormalizeToolResultPayloadValue
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Normalize unknown tool output to a structured shape used by MCP adapters.
 * Backward-compatible: plain strings/objects are still accepted.
 *
 * @param {any} value
 * @returns {{ text: string, json?: unknown, flags: { degraded: boolean, mutating: boolean, partial: boolean } }}
 */
export function normalizeToolResultPayload(value) {
    if (value && typeof value === 'object' && Array.isArray(value.content)) {
        const textParts = value.content
            .filter((/** @type {any} */ part) => part && part.type === 'text' && typeof part.text === 'string')
            .map((/** @type {any} */ part) => part.text);
        return {
            text: textParts.join('\n').trim() || JSON.stringify(value, null, 2),
            json: value.structuredContent,
            flags: {
                degraded: false,
                mutating: false,
                partial: false,
            },
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
            flags: {
                degraded: false,
                mutating: false,
                partial: false,
            },
        };
    }

    return {
        text: JSON.stringify(value, null, 2),
        json: value,
        flags: {
            degraded: false,
            mutating: false,
            partial: false,
        },
    };
}

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
     * @param {any} metadata - Tool metadata (description, inputSchema)
     * @param {function} handler - Async function to execute the tool
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

        const normalizedMetadata = {
            ...metadata,
            allowMutations: /** @type {any} */ (metadata).allowMutations === true,
            requiresConfirmationToken: /** @type {any} */ (metadata).requiresConfirmationToken === true,
        };

        this.tools.set(name, { metadata: normalizedMetadata, handler });
        console.error(`[Tool Registry] Registered tool: ${name}`);
    }

    /**
     * Execute a tool by name (with optional retry, adaptive timeout, circuit breaker)
     *
     * @param {string} name - Tool name
     * @param {any} params - Tool parameters (validated against inputSchema)
     * @param {any} options - Execution options (signal for cancellation, etc.)
     * @returns {Promise<string|object>} Tool result
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

        // Check if retry enabled (opt-in via env var, default: false)
        const retryEnabled = process.env.MCP_TOOL_RETRY_ENABLED === 'true';
        const maxRetries = Number(process.env.MCP_TOOL_MAX_RETRIES || 3);

        // Check if adaptive timeout enabled (opt-in via env var, default: false)
        const adaptiveEnabled = process.env.MCP_TOOL_ADAPTIVE_TIMEOUT === 'true';

        // Determine timeout strategy
        let toolTimeout;
        if (adaptiveEnabled) {
            // Import adaptive module dynamically (only if enabled)
            const { getToolTimeout } = await import('#logic/adaptive');
            const adaptive = await getToolTimeout(name, {
                contextSize: JSON.stringify(params).length,
            });

            if (adaptive.circuit_broken) {
                throw new Error(`Tool ${name} circuit breaker active: ${adaptive.warning}`);
            }

            toolTimeout = adaptive.timeout;
            console.error(
                `[Tool Registry] Using adaptive timeout for ${name}: ${toolTimeout}ms ` +
                    `(learned_avg=${adaptive.breakdown?.learned_avg}ms, phase=${adaptive.phase})`
            );
        } else {
            // Fallback to fixed timeout (backward compatible)
            toolTimeout = Number(process.env.TOOL_EXECUTION_TIMEOUT || 75000);
        }

        // Circuit breaker check (for Ollama tools only)
        const isOllamaTool = name.startsWith('ollama_');
        if (isOllamaTool && process.env.OLLAMA_CIRCUIT_BREAKER_ENABLED !== 'false') {
            // Import circuit breaker dynamically (only if needed)
            const { getCircuitBreaker } = await import('./ollama-circuit-breaker.mjs');
            const endpoint = process.env.OLLAMA_CLOUD_ENABLED === 'true' ? 'cloud' : 'local';
            const breaker = getCircuitBreaker(endpoint);

            if (!breaker.allowRequest()) {
                const status = /** @type {any} */ (breaker.getStatus());
                throw new Error(
                    `Ollama ${endpoint} circuit breaker OPEN - service unavailable. ` +
                        `Retry in ${Math.round(status.nextAttemptIn / 1000)}s`
                );
            }
        }

        // Retry loop (if enabled)
        let attempt = 0;
        let lastError = null;
        const maxAttempts = retryEnabled ? maxRetries : 1;

        while (attempt < maxAttempts) {
            attempt++;
            const startTime = Date.now();

            console.error(
                `[Tool Registry] Executing tool: ${name} ` +
                    `(attempt ${attempt}/${maxAttempts}${retryEnabled ? ', retry enabled' : ''})`
            );

            const internalController = new AbortController();
            const timeoutId = setTimeout(() => internalController.abort(), toolTimeout);

            try {
                // Combine external signal (if unknown) with internal timeout signal
                const combinedSignal = options.signal
                    ? AbortSignal.any([options.signal, internalController.signal])
                    : internalController.signal;

                // Pass combined signal to handler
                const result = await tool.handler(params, {
                    ...options,
                    signal: combinedSignal,
                });

                clearTimeout(timeoutId);
                const duration = Date.now() - startTime;

                // Success: record metrics for adaptive learning
                if (adaptiveEnabled) {
                    const { recordMetric } = await import('#logic/adaptive');
                    await recordMetric('tool_execution', duration, `tool:${name}`);
                }

                // Success: record circuit breaker success
                if (isOllamaTool && process.env.OLLAMA_CIRCUIT_BREAKER_ENABLED !== 'false') {
                    const { getCircuitBreaker } = await import('./ollama-circuit-breaker.mjs');
                    const endpoint = process.env.OLLAMA_CLOUD_ENABLED === 'true' ? 'cloud' : 'local';
                    const breaker = getCircuitBreaker(endpoint);
                    breaker.recordSuccess();
                }

                if (attempt > 1) {
                    console.error(
                        `[Tool Registry] Tool ${name} succeeded on attempt ${attempt}/${maxAttempts} ` +
                            `after ${duration}ms`
                    );
                }

                console.error(`[Tool Registry] Tool execution completed: ${name} (${duration}ms)`);
                return result;
            } catch (/** @type {any} */ _raw_error) {
                const error = /** @type {any} */ (_raw_error);
                clearTimeout(timeoutId);
                lastError = error;

                // Classify error for retry decision
                const { classifyError, calculateBackoff } = await import('./error-classifier.mjs');
                const classification = /** @type {any} */ (
                    classifyError(error, {
                        tool: name,
                        model: /** @type {any} */ (params).model,
                        attempt,
                    })
                );

                console.error(
                    `[Tool Registry] Tool ${name} failed (attempt ${attempt}/${maxAttempts}): ` +
                        `${classification.errorClass} - ${classification.reasonCode}`
                );

                // Record circuit breaker failure
                if (isOllamaTool && process.env.OLLAMA_CIRCUIT_BREAKER_ENABLED !== 'false') {
                    const { getCircuitBreaker } = await import('./ollama-circuit-breaker.mjs');
                    const endpoint = process.env.OLLAMA_CLOUD_ENABLED === 'true' ? 'cloud' : 'local';
                    const breaker = getCircuitBreaker(endpoint);
                    breaker.recordFailure();
                }

                // Check if retryable
                if (!retryEnabled || !classification.retryable || attempt >= maxAttempts) {
                    throw new Error( // eslint-disable-line preserve-caught-error
                        `Tool ${name} execution failed: ${error.message} ` +
                            `(${classification.reasonCode}, attempt ${attempt}/${maxAttempts})`
                    );
                }

                // Model fallback for Ollama timeouts (if enabled)
                if (
                    classification.strategy === 'MODEL_FALLBACK' &&
                    classification.modelFallback &&
                    process.env.OLLAMA_MODEL_FALLBACK_ENABLED !== 'false'
                ) {
                    console.error(`[Tool Registry] Model fallback: ${params.model} → ${classification.modelFallback}`);
                    params = { ...params, model: classification.modelFallback };
                }

                // Exponential backoff before retry
                const maxBackoff = Number(process.env.MCP_TOOL_MAX_BACKOFF_MS || 30000);
                const delayMs = calculateBackoff(attempt, classification.suggestedDelayMs, maxBackoff);

                console.error(
                    `[Tool Registry] Retrying tool ${name} in ${delayMs}ms ` +
                        `(strategy: ${classification.strategy}, ${classification.message})`
                );

                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        // Max retries exceeded
        throw lastError;
    }

    /**
     * Get all tool metadata (for MCP tools/list, LSP capabilities)
     *
     * @returns {Array<{name: string, description: string, inputSchema: object}>}
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
            ...metadata,
        }));
    }

    /**
     * Get metadata for a specific tool
     *
     * @param {string} name - Tool name
     * @returns {object|null} Tool metadata or null if not found
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
     * @returns {any} Stats object
     */
    getStats() {
        return {
            totalTools: this.tools.size,
            tools: this.getToolNames(),
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
/** @type {Promise<void> | null} */ let initPromise = null;

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

            // Optional: LSP/tsserver tools for semantic code navigation
            if (String(process.env.LSP_ENABLED || 'true') !== 'false') {
                const { registerLspTools } = await import('./tools/lsp-tools.mjs');
                await registerLspTools(registry);
            }

            // Optional: import upstream MCP tools (generic HTTP + stdio, plus GitHub preset).
            // This is designed to be best-effort: failures should degrade, not crash the server.
            try {
                const { registerUpstreams, getUpstreamStatus } = await import('./mcp/upstream-manager.mjs');
                await registerUpstreams(registry, { installShutdownHook: false });
                const st = getUpstreamStatus();
                const readyCount = st.upstreams.filter(u => u.ready).length;
                const totalCount = st.upstreams.length;
                if (totalCount > 0) {
                    console.error(`[Tool Registry] Upstreams: ${readyCount}/${totalCount} ready`);
                }
            } catch (/** @type {any} */ error) {
                console.error('[Tool Registry] Upstream manager failed (continuing without upstreams):', error);
            }

            initialized = true;

            const stats = /** @type {any} */ (registry.getStats());
            console.error(`[Tool Registry] Initialization complete: ${stats.totalTools} tools registered`);
            console.error(`[Tool Registry] Available tools: ${stats.tools.join(', ')}`);
        } catch (/** @type {any} */ error) {
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
