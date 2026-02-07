/**
 * Ollama HTTP Client
 *
 * Provides access to Ollama server on host (via host.docker.internal:11434)
 * for text generation, embeddings, and model management.
 *
 * Used by:
 * - Tool Registry (ollama_generate, ollama_embed, ollama_models tools)
 * - Program logic (direct calls for intelligent decisions)
 *
 * @example
 * import { ollama } from './tools/ollama/client.mjs';
 *
 * const models = await ollama.listModels();
 * const text = await ollama.generate('Write a function', 'llama3.2');
 * const embedding = await ollama.embed('some text', 'nomic-embed-text');
 */

/**
 * Ollama HTTP Client
 */
export class OllamaClient {
    /**
     * @param {string} baseUrl - Ollama server URL (default: from ENV or host.docker.internal:11434)
     */
    constructor(baseUrl) {
        this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';

        // Configurable timeouts (from ENV)
        this.generateTimeout = Number(process.env.OLLAMA_GENERATE_TIMEOUT || 60000);
        this.embedTimeout = Number(process.env.OLLAMA_EMBED_TIMEOUT || 30000);
        this.listTimeout = Number(process.env.OLLAMA_LIST_TIMEOUT || 10000);
        this.healthTimeout = Number(process.env.OLLAMA_HEALTH_TIMEOUT || 5000);
    }

    /**
     * Generate text using Ollama model
     *
     * @param {string} prompt - The prompt to generate from
     * @param {string} model - Model name (default: qwen2.5-coder:3b from ENV)
     * @param {object} options - Generation options
     * @param {number} options.temperature - Temperature (0-1, default: 0.7)
     * @param {number} options.num_predict - Max tokens to generate (default: 1000 from ENV)
     * @param {number} options.top_p - Top-p sampling (default: 0.9)
     * @param {boolean} options.stream - Stream response (default: false)
     * @returns {Promise<string>} Generated text
     *
     * @example
     * const text = await ollama.generate('Write a docstring', 'qwen2.5-coder:3b');
     */
    async generate(prompt, model, options = {}) {
        const defaultModel = process.env.OLLAMA_DEFAULT_MODEL || 'qwen2.5-coder:3b';
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

            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: abortSignal
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
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
            throw new Error(`Ollama generate error: ${error.message}`);
        }
    }

    /**
     * Generate embeddings for text using Ollama embedding model
     *
     * @param {string} text - Text to embed
     * @param {string} model - Embedding model name (default: nomic-embed-text)
     * @returns {Promise<number[]>} Embedding vector (768D for nomic-embed-text)
     *
     * @example
     * const embedding = await ollama.embed('kernel loop implementation');
     * console.log(embedding.length); // 768
     */
    async embed(text, model = 'nomic-embed-text', options = {}) {
        if (!text || typeof text !== 'string') {
            throw new Error('Text must be a non-empty string');
        }

        const { signal } = options;  // External abort signal for cancellation

        try {
            // Combine external signal (if provided) with internal timeout
            const timeoutSignal = AbortSignal.timeout(this.embedTimeout);
            const abortSignal = signal
                ? AbortSignal.any([signal, timeoutSignal])
                : timeoutSignal;

            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: text }),
                signal: abortSignal
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
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
            throw new Error(`Ollama embed error: ${error.message}`);
        }
    }

    /**
     * List all available Ollama models on host
     *
     * @returns {Promise<Array<{name: string, size: number, modified_at: string}>>} List of models
     *
     * @example
     * const models = await ollama.listModels();
     * console.log(models.map(m => m.name)); // ['qwen2.5-coder:3b', 'nomic-embed-text']
     */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
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
     * Check if Ollama server is accessible and healthy
     *
     * @returns {Promise<boolean>} true if Ollama is accessible, false otherwise
     *
     * @example
     * const isHealthy = await ollama.health();
     * if (!isHealthy) console.error('Ollama not accessible');
     */
    async health() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(this.healthTimeout)
            });
            return response.ok;
        } catch (_) {
            return false;
        }
    }

    /**
     * Get detailed information about a specific model
     *
     * @param {string} modelName - Name of the model
     * @returns {Promise<object>} Model information
     *
     * @example
     * const info = await ollama.modelInfo('qwen2.5-coder:3b');
     */
    async modelInfo(modelName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
 * Uses host.docker.internal:11434 (same as RAG system)
 */
export const ollama = new OllamaClient();
