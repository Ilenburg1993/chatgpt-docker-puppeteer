import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_EMBEDDING_MODEL } from '../contract.mjs';

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of fn()
 */
async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000, onRetry } = options;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
                if (onRetry) {
                    onRetry(error, attempt + 1, maxRetries, delay);
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/**
 * Ollama Embeddings Provider (OpenAI-compatible API)
 *
 * IMPORTANT: Uses LOCAL Ollama endpoint only (http://host.docker.internal:11434).
 * Embeddings are NOT available on Ollama Cloud.
 *
 * For text generation (coding/chat), use OllamaClient with:
 * - qwen3-coder-next (cloud, coding agents)
 * - qwen3-next (cloud, general chat)
 *
 * Architecture (v5.0):
 * - Cloud (https://ollama.com): Generation models (qwen3-coder-next, qwen3-next)
 * - Local (host.docker.internal:11434): Embeddings only (nomic-embed-text)
 *
 * @example
 * const provider = new OllamaEmbeddingsProvider({
 *   baseURL: 'http://host.docker.internal:11434/v1', // LOCAL only
 *   model: 'nomic-embed-text:latest'
 * });
 */
export class OllamaEmbeddingsProvider {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.baseURL - LOCAL Ollama base URL (default: host.docker.internal:11434/v1)
     * @param {string} options.model - Embedding model (default: nomic-embed-text:latest)
     * @param {number} options.timeoutMs - Request timeout in ms (default: 30000)
     */
    constructor(options = {}) {
        // ALWAYS use local URL for embeddings (no cloud support)
        this.baseURL = options.baseURL ||
            process.env.OLLAMA_LOCAL_BASE_URL?.replace(/\/$/, '') + '/v1' ||
            DEFAULT_OLLAMA_BASE_URL;
        this.model = options.model || DEFAULT_EMBEDDING_MODEL;
        this.timeoutMs = options.timeoutMs || 30_000;
    }

    async health() {
        const versionUrl = this.baseURL.replace(/\/v1\/?$/, '') + '/api/version';
        const version = await fetchJson(versionUrl, { timeoutMs: 1500 }).catch(() => null);
        const models = await fetchJson(`${this.baseURL}/models`, { timeoutMs: 2000 }).catch(() => null);
        const modelIds = Array.isArray(models?.data) ? models.data.map(m => m.id).filter(Boolean) : [];
        const hasModel = modelIds.includes(this.model);
        return {
            ok: Boolean(version) && Array.isArray(models?.data),
            version,
            models: modelIds,
            hasModel
        };
    }

    async embed(text) {
        // SAFETY: Truncate excessively long texts (conservative limit for nomic-embed-text)
        // nomic-embed-text supports 8192 tokens (~32k chars), but being conservative with 3k chars
        const MAX_SAFE_CHARS = 3000;
        let truncatedText = text;
        let wasTruncated = false;

        if (text.length > MAX_SAFE_CHARS) {
            truncatedText = text.slice(0, MAX_SAFE_CHARS);
            wasTruncated = true;
            console.warn(`[RAG] Text truncated: ${text.length} → ${MAX_SAFE_CHARS} chars (model context limit)`);
        }

        return retryWithBackoff(
            async () => {
                const body = { model: this.model, input: truncatedText };
                console.log(`[RAG]     • Sending to Ollama: ${truncatedText.length} chars, model=${this.model}`);

                const startTime = Date.now();
                const resp = await fetchJson(`${this.baseURL}/embeddings`, {
                    timeoutMs: this.timeoutMs,
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const elapsed = Date.now() - startTime;

                const vector = resp?.data?.[0]?.embedding;
                if (!Array.isArray(vector) || vector.length === 0) {
                    throw new Error('OLLAMA_EMBEDDINGS_BAD_RESPONSE');
                }
                console.log(`[RAG]     ✓ Ollama response: ${vector.length}D vector in ${elapsed}ms`);
                return vector.map(n => Number(n));
            },
            {
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 10000,
                onRetry: (err, attempt, max, delay) => {
                    console.warn(`[RAG] Embed retry ${attempt}/${max} after ${delay}ms: ${err.message}`);
                }
            }
        );
    }
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    try {
        const res = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
            signal: controller.signal
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP_${res.status}:${text.slice(0, 200)}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}

