/**
 * Ollama HTTP Client (Dual-URL Architecture v5.0)
 *
 * Provides access to Ollama Cloud (generation) and Local (embeddings):
 * - Cloud: https://ollama.com (qwen3-coder-next, qwen3-next) - requires API key
 * - Local: http://host.docker.internal:11434 (nomic-embed-text)
 *
 * Used by:
 * - Tool Registry (ollama_generate, ollama_embed, ollama_models tools)
 * - Program logic (direct calls for intelligent decisions)
 *
 * @example
 * import { ollama } from './tools/ollama/client.mjs';
 *
 * // Generation (uses cloud if enabled)
 * const text = await ollama.generate('Write a function', 'qwen3-coder-next');
 *
 * // Embeddings (always uses local)
 * const embedding = await ollama.embed('some text', 'nomic-embed-text');
 *
 * // List models (cloud if enabled, local otherwise)
 * const models = await ollama.listModels();
 */

/**
 * Ollama HTTP Client with Dual-URL Support
 */
export class OllamaClient {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.cloudBaseUrl - Ollama Cloud URL (default: https://ollama.com)
     * @param {string} options.cloudApiKey - Ollama Cloud API key (required for cloud)
     * @param {boolean} options.cloudEnabled - Enable cloud generation (default: true)
     * @param {string} options.localBaseUrl - Ollama Local URL (default: host.docker.internal:11434)
     */
    constructor(options = {}) {
        // Cloud configuration (generation/chat)
        this.cloudBaseUrl = options.cloudBaseUrl ||
            process.env.OLLAMA_CLOUD_BASE_URL ||
            'https://ollama.com';
        this.cloudApiKey = options.cloudApiKey ||
            process.env.OLLAMA_CLOUD_API_KEY ||
            '';
        this.cloudEnabled = options.cloudEnabled !== undefined ?
            options.cloudEnabled :
            (process.env.OLLAMA_CLOUD_ENABLED === 'true');

        // Local configuration (embeddings)
        this.localBaseUrl = options.localBaseUrl ||
            process.env.OLLAMA_LOCAL_BASE_URL ||
            process.env.OLLAMA_BASE_URL ||  // Backward compat (deprecated)
            'http://host.docker.internal:11434';

        // Configurable timeouts (from ENV)
        this.generateTimeout = Number(process.env.OLLAMA_GENERATE_TIMEOUT || 60000);
        this.embedTimeout = Number(process.env.OLLAMA_EMBED_TIMEOUT || 30000);
        this.listTimeout = Number(process.env.OLLAMA_LIST_TIMEOUT || 10000);
        this.healthTimeout = Number(process.env.OLLAMA_HEALTH_TIMEOUT || 5000);

        // Warn if cloud enabled but no API key
        if (this.cloudEnabled && !this.cloudApiKey) {
            console.warn('[OllamaClient] Cloud enabled but OLLAMA_CLOUD_API_KEY is not set');
            console.warn('[OllamaClient] Get your API key at: https://ollama.com/settings/api-keys');
        }
    }

    /**
     * Get headers for cloud API requests
     * @private
     * @returns {Object} Headers object with Authorization if API key exists
     */
    _getCloudHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.cloudApiKey) {
            headers['Authorization'] = `Bearer ${this.cloudApiKey}`;
        }
        return headers;
    }

    /**
     * Generate text using Ollama Cloud (or fallback to local)
     *
     * Uses cloud (https://ollama.com) if enabled, otherwise uses local endpoint.
     * Cloud models: qwen3-coder-next (coding), qwen3-next (chat)
     *
     * @param {string} prompt - The prompt to generate from
     * @param {string} model - Model name (default: qwen3-coder-next from ENV)
     * @param {object} options - Generation options
     * @param {number} options.temperature - Temperature (0-1, default: 0.7)
     * @param {number} options.num_predict - Max tokens to generate (default: 1000 from ENV)
     * @param {number} options.top_p - Top-p sampling (default: 0.9)
     * @param {boolean} options.stream - Stream response (default: false)
     * @returns {Promise<string>} Generated text
     *
     * @example
     * // Cloud generation (qwen3-coder-next)
     * const text = await ollama.generate('Write a docstring', 'qwen3-coder-next');
     *
     * // Chat (qwen3-next)
     * const chat = await ollama.generate('Explain closures', 'qwen3-next');
     */
    async generate(prompt, model, options = {}) {
        const defaultModel = process.env.OLLAMA_DEFAULT_MODEL || 'qwen3-coder-next';
        const defaultMaxTokens = Number(process.env.OLLAMA_MAX_TOKENS || 1000);

        const {
            temperature = 0.7,
            num_predict = defaultMaxTokens,
            top_p = 0.9,
            stream = false,
            signal,  // External abort signal for cancellation
            ...otherOptions
        } = options;

        // Use provided model or ENV default
        const selectedModel = model || defaultModel;

        // Determine which base URL to use (cloud or local)
        const baseUrl = this.cloudEnabled ? this.cloudBaseUrl : this.localBaseUrl;
        const headers = this.cloudEnabled ? this._getCloudHeaders() : { 'Content-Type': 'application/json' };

        console.error(`[OllamaClient] generate() using ${this.cloudEnabled ? 'cloud' : 'local'}: ${baseUrl}`);

        const requestBody = {
            model: selectedModel,
            prompt,
            stream,
            options: {
                temperature,
                num_predict,
                top_p,
                ...otherOptions
            }
        };

        try {
            // Combine external signal (if provided) with internal timeout
            const timeoutSignal = AbortSignal.timeout(this.generateTimeout);
            const abortSignal = signal
                ? AbortSignal.any([signal, timeoutSignal])
                : timeoutSignal;

            const response = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: abortSignal
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');

                // Special handling for cloud auth errors
                if (this.cloudEnabled && (response.status === 401 || response.status === 403)) {
                    throw new Error(
                        `❌ Ollama Cloud authentication failed (${response.status})\n` +
                        `Please configure OLLAMA_CLOUD_API_KEY in your .env file.\n` +
                        `Get your API key at: https://ollama.com/settings/api-keys\n\n` +
                        `Fallback: Set OLLAMA_CLOUD_ENABLED=false to use local Ollama only.`
                    );
                }

                throw new Error(`Ollama generate failed (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.response) {
                throw new Error('Ollama generate returned empty response');
            }

            return data.response;
        } catch (error) {
            if (error.name === 'AbortError') {
                // Check which signal caused the abort
                if (signal?.aborted) {
                    throw new Error('Ollama generate cancelled by user');
                }
                throw new Error(`Ollama generate timeout (>${this.generateTimeout}ms)`);
            }
            // Re-throw with context if already formatted
            if (error.message.includes('❌')) {
                throw error;
            }
            throw new Error(`Ollama generate error: ${error.message}`);
        }
    }

    /**
     * Generate embeddings using LOCAL Ollama only
     *
     * ALWAYS uses local endpoint (http://host.docker.internal:11434).
     * Embeddings are NOT available on Ollama Cloud.
     *
     * @param {string} text - Text to embed
     * @param {string} model - Embedding model name (default: nomic-embed-text)
     * @returns {Promise<number[]>} Embedding vector (768D for nomic-embed-text)
     *
     * @example
     * // Local embeddings (RAG system)
     * const embedding = await ollama.embed('kernel loop implementation');
     * console.log(embedding.length); // 768
     */
    async embed(text, model = 'nomic-embed-text', options = {}) {
        if (!text || typeof text !== 'string') {
            throw new Error('Text must be a non-empty string');
        }

        const { signal } = options;  // External abort signal for cancellation

        // ALWAYS use local URL for embeddings (no cloud support)
        const baseUrl = this.localBaseUrl;
        console.error(`[OllamaClient] embed() using local: ${baseUrl}`);

        try {
            // Combine external signal (if provided) with internal timeout
            const timeoutSignal = AbortSignal.timeout(this.embedTimeout);
            const abortSignal = signal
                ? AbortSignal.any([signal, timeoutSignal])
                : timeoutSignal;

            const response = await fetch(`${baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: text }),
                signal: abortSignal
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');

                // Provide helpful error if local Ollama not running
                if (response.status >= 500 || response.status === 0) {
                    throw new Error(
                        `❌ Local Ollama not accessible at ${baseUrl}\n` +
                        `Please ensure Ollama is running: docker-compose up ollama OR ollama serve\n` +
                        `Error: ${errorText}`
                    );
                }

                throw new Error(`Ollama embed failed (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.embedding || !Array.isArray(data.embedding)) {
                throw new Error('Ollama embed returned invalid embedding');
            }

            return data.embedding;
        } catch (error) {
            if (error.name === 'AbortError') {
                // Check which signal caused the abort
                if (signal?.aborted) {
                    throw new Error('Ollama embed cancelled by user');
                }
                throw new Error(`Ollama embed timeout (>${this.embedTimeout}ms)`);
            }
            // Re-throw with context if already formatted
            if (error.message.includes('❌')) {
                throw error;
            }
            throw new Error(`Ollama embed error: ${error.message}`);
        }
    }

    /**
     * List available models (cloud if enabled, local otherwise)
     *
     * Returns models from Ollama Cloud (if enabled) or local Ollama.
     * Cloud: qwen3-coder-next, qwen3-next
     * Local: qwen2.5-coder:3b, nomic-embed-text
     *
     * @returns {Promise<Array<{name: string, size: number, modified_at: string}>>} List of models
     *
     * @example
     * const models = await ollama.listModels();
     * console.log(models.map(m => m.name));
     */
    async listModels() {
        // Determine which base URL to use
        const baseUrl = this.cloudEnabled ? this.cloudBaseUrl : this.localBaseUrl;
        const headers = this.cloudEnabled ? this._getCloudHeaders() : {};

        console.error(`[OllamaClient] listModels() using ${this.cloudEnabled ? 'cloud' : 'local'}: ${baseUrl}`);

        try {
            const response = await fetch(`${baseUrl}/api/tags`, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(this.listTimeout)
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Ollama list models failed (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.models || !Array.isArray(data.models)) {
                throw new Error('Ollama list models returned invalid data');
            }

            return data.models;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Ollama list models timeout (>${this.listTimeout}ms)`);
            }
            throw new Error(`Ollama list models error: ${error.message}`);
        }
    }

    /**
     * Check health of Ollama endpoints (cloud and/or local)
     *
     * @returns {Promise<{cloud: boolean, local: boolean, overall: boolean}>} Health status
     *
     * @example
     * const health = await ollama.health();
     * if (!health.overall) console.error('Ollama not fully accessible');
     */
    async health() {
        const health = {
            cloud: false,
            local: false,
            overall: false
        };

        // Check cloud health (if enabled)
        if (this.cloudEnabled) {
            try {
                const response = await fetch(`${this.cloudBaseUrl}/api/tags`, {
                    method: 'GET',
                    headers: this._getCloudHeaders(),
                    signal: AbortSignal.timeout(this.healthTimeout)
                });
                health.cloud = response.ok;
            } catch (_) {
                health.cloud = false;
            }
        }

        // Check local health (always)
        try {
            const response = await fetch(`${this.localBaseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(this.healthTimeout)
            });
            health.local = response.ok;
        } catch (_) {
            health.local = false;
        }

        // Overall: cloud OK (if enabled) OR local OK
        health.overall = this.cloudEnabled ? (health.cloud || health.local) : health.local;

        return health;
    }

    /**
     * Get detailed information about a specific model (cloud or local)
     *
     * @param {string} modelName - Name of the model
     * @returns {Promise<object>} Model information
     *
     * @example
     * const info = await ollama.modelInfo('qwen3-coder-next');
     */
    async modelInfo(modelName) {
        // Determine which base URL to use
        const baseUrl = this.cloudEnabled ? this.cloudBaseUrl : this.localBaseUrl;
        const headers = this.cloudEnabled ? this._getCloudHeaders() : { 'Content-Type': 'application/json' };

        try {
            const response = await fetch(`${baseUrl}/api/show`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: modelName }),
                signal: AbortSignal.timeout(this.listTimeout)
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Ollama model info failed (${response.status}): ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Ollama model info timeout (>${this.listTimeout}ms)`);
            }
            throw new Error(`Ollama model info error: ${error.message}`);
        }
    }
}

/**
 * Default Ollama client instance (singleton)
 *
 * Dual-URL Architecture:
 * - Cloud: https://ollama.com (generation - qwen3-coder-next, qwen3-next)
 * - Local: http://host.docker.internal:11434 (embeddings - nomic-embed-text)
 *
 * Configuration via ENV:
 * - OLLAMA_CLOUD_ENABLED=true (enable cloud generation)
 * - OLLAMA_CLOUD_API_KEY=your_key (required for cloud)
 * - OLLAMA_LOCAL_BASE_URL=http://host.docker.internal:11434 (embeddings)
 */
export const ollama = new OllamaClient();
