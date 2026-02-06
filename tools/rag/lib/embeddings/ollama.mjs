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

export class OllamaEmbeddingsProvider {
    constructor(options = {}) {
        this.baseURL = options.baseURL || DEFAULT_OLLAMA_BASE_URL;
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
        return retryWithBackoff(
            async () => {
                const body = { model: this.model, input: text };
                const resp = await fetchJson(`${this.baseURL}/embeddings`, {
                    timeoutMs: this.timeoutMs,
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const vector = resp?.data?.[0]?.embedding;
                if (!Array.isArray(vector) || vector.length === 0) {
                    throw new Error('OLLAMA_EMBEDDINGS_BAD_RESPONSE');
                }
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

