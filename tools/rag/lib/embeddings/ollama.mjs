// @ts-check
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_EMBEDDING_MODEL, DEFAULT_OLLAMA_EMBED_MAX_CHARS } from '../contract.mjs';

function normalizeEmbeddingBaseUrl(/** @type {any} */ rawBaseUrl) {
    const raw = String(rawBaseUrl || '').trim();
    if (!raw) return '';
    const trimmed = raw.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function resolveEmbeddingBaseUrl(/** @type {any} */ optionsBaseUrl) {
    const fromOptions = normalizeEmbeddingBaseUrl(optionsBaseUrl);
    if (fromOptions) return fromOptions;

    const fromEnv = normalizeEmbeddingBaseUrl(process.env.OLLAMA_LOCAL_BASE_URL);
    if (fromEnv) return fromEnv;

    return normalizeEmbeddingBaseUrl(DEFAULT_OLLAMA_BASE_URL);
}

function parsePositiveInt(/** @type {any} */ rawValue, /** @type {any} */ fallback) {
    const parsed = Number.parseInt(String(rawValue ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(/** @type {any} */ rawValue, /** @type {any} */ fallback = true) {
    const normalized = String(rawValue ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function isContextLengthError(/** @type {any} */ error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('context length') || message.includes('input length exceeds');
}

function parseHttpStatus(/** @type {any} */ error) {
    const message = String(error?.message || '');
    const match = message.match(/HTTP_(\d{3}):/);
    if (!match) return null;
    const status = Number.parseInt(match[1], 10);
    return Number.isFinite(status) ? status : null;
}

function isTransientError(/** @type {any} */ error) {
    if (isContextLengthError(error)) return false;
    const status = parseHttpStatus(error);
    if (status !== null) {
        return status === 408 || status === 429 || status >= 500;
    }
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('timeout') ||
        message.includes('abort') ||
        message.includes('fetch failed') ||
        message.includes('network') ||
        message.includes('econnreset') ||
        message.includes('socket hang up')
    );
}

function sleep(/** @type {any} */ ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
     * @param {string} [options.baseURL] - LOCAL Ollama base URL (default: host.docker.internal:11434/v1)
     * @param {string} [options.model] - Embedding model (default: nomic-embed-text:latest)
     * @param {number} [options.timeoutMs] - Request timeout in ms (default: 30000)
     * @param {number} [options.maxChars] - Máximo de caracteres por embedding
     * @param {boolean} [options.contextFastShrink] - Redução agressiva quando overflow de contexto
     */
    constructor(options = {}) {
        // ALWAYS use local URL for embeddings (no cloud support).
        // Guaranteed to end with `/v1` and never produces "undefined/v1".
        this.baseURL = resolveEmbeddingBaseUrl(options.baseURL);
        this.model = options.model || DEFAULT_EMBEDDING_MODEL;
        this.timeoutMs = options.timeoutMs || 30_000;
        this.maxChars = parsePositiveInt(
            options.maxChars ?? process.env.OLLAMA_EMBED_MAX_CHARS,
            DEFAULT_OLLAMA_EMBED_MAX_CHARS
        );
        this.contextFastShrink = parseBoolean(
            options.contextFastShrink ?? process.env.OLLAMA_EMBED_CONTEXT_FAST_SHRINK,
            true
        );
        this.runtimeSafeChars = null;
        this.contextOverflowCount = 0;
        this.maxAcceptedChars = 0;
        this.embedCalls = 0;
        this.lastStatsCall = 0;
    }

    async health() {
        const versionUrl = this.baseURL.replace(/\/v1\/?$/, '') + '/api/version';
        const version = await fetchJson(versionUrl, { timeoutMs: 1500 }).catch(/** @type {any} */ () => null);
        const models = await fetchJson(`${this.baseURL}/models`, { timeoutMs: 2000 }).catch(/** @type {any} */ () => null);
        const modelIds = Array.isArray(models?.data) ? models.data.map((/** @type {any} */ m) => m.id).filter(Boolean) : [];
        const hasModel = modelIds.includes(this.model);
        return {
            ok: Boolean(version) && Array.isArray(models?.data),
            version,
            models: modelIds,
            hasModel,
        };
    }

    async embed(/** @type {any} */ text) {
        this.embedCalls++;
        const originalText = String(text ?? '');
        const effectiveCap = this.runtimeSafeChars ? Math.min(this.maxChars, this.runtimeSafeChars) : this.maxChars;
        let truncatedText = originalText;

        if (truncatedText.length > effectiveCap) {
            truncatedText = truncatedText.slice(0, effectiveCap);
            const reason = this.runtimeSafeChars ? 'runtime safe cap' : 'model context limit';
            console.warn(`[RAG] Text truncated: ${originalText.length} → ${effectiveCap} chars (${reason})`);
        }

        let currentInput = truncatedText;
        const minChars = 1000;
        const maxContextAdjustments = 8;
        let hadContextOverflow = false;
        const initialInputLength = currentInput.length;
        let contextOverflowsThisCall = 0;

        for (let adjustment = 0; adjustment < maxContextAdjustments; adjustment++) {
            try {
                const vector = await this.embedWithTransientRetries(currentInput);
                this.maxAcceptedChars = Math.max(this.maxAcceptedChars, currentInput.length);
                if (hadContextOverflow) {
                    console.warn(
                        `[RAG] Context limit adapted input ${initialInputLength} → ${currentInput.length} chars ` +
                            `(${contextOverflowsThisCall} reductions, runtime_safe_chars=${this.runtimeSafeChars})`
                    );
                }
                if (hadContextOverflow || this.embedCalls - this.lastStatsCall >= 100) {
                    this.logContextStats();
                }
                return vector;
            } catch (error) {
                const _ce = /** @type {any} */ (error);
                if (!isContextLengthError(error)) throw error;
                hadContextOverflow = true;
                contextOverflowsThisCall++;
                this.contextOverflowCount++;
                if (currentInput.length <= minChars) throw error;
                const shrinkFactor = this.contextFastShrink ? 0.7 : 0.85;
                const nextLength = Math.max(minChars, Math.floor(currentInput.length * shrinkFactor));
                if (nextLength >= currentInput.length) throw error;
                this.runtimeSafeChars = this.runtimeSafeChars
                    ? Math.min(this.runtimeSafeChars, nextLength)
                    : nextLength;
                currentInput = currentInput.slice(0, this.runtimeSafeChars);
            }
        }

        throw new Error('OLLAMA_EMBEDDINGS_CONTEXT_RETRY_EXHAUSTED');
    }

    async embedWithTransientRetries(/** @type {any} */ input) {
        const maxRetries = 3;
        const initialDelay = 1000;
        const maxDelay = 10000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.embedOnce(input);
            } catch (error) {
                const _ce = /** @type {any} */ (error);
                if (isContextLengthError(error)) throw error;
                if (!isTransientError(error) || attempt === maxRetries) throw error;
                const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
                console.warn(`[RAG] Embed retry ${attempt}/${maxRetries} after ${delay}ms: ${_ce.message}`);
                await sleep(delay);
            }
        }

        throw new Error('OLLAMA_EMBEDDINGS_TRANSIENT_RETRY_EXHAUSTED');
    }

    async embedOnce(/** @type {any} */ input) {
        const body = { model: this.model, input };
        console.log(`[RAG]     • Sending to Ollama: ${input.length} chars, model=${this.model}`);

        const startTime = Date.now();
        const resp = await fetchJson(`${this.baseURL}/embeddings`, {
            timeoutMs: this.timeoutMs,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const elapsed = Math.max(0, Date.now() - startTime);

        const vector = resp?.data?.[0]?.embedding;
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error('OLLAMA_EMBEDDINGS_BAD_RESPONSE');
        }
        console.log(`[RAG]     ✓ Ollama response: ${vector.length}D vector in ${elapsed}ms`);
        return vector.map((/** @type {any} */ n) => Number(n));
    }

    logContextStats() {
        this.lastStatsCall = this.embedCalls;
        console.log(
            `[RAG] Embed context stats overflows=${this.contextOverflowCount} ` +
                `max_ok_chars=${this.maxAcceptedChars} runtime_safe_chars=${this.runtimeSafeChars ?? 'n/a'}`
        );
    }
}

async function fetchJson(/** @type {any} */ url, /** @type {any} */ options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(/** @type {any} */ () => controller.abort(), options.timeoutMs ?? 5000);
    try {
        const res = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(/** @type {any} */ () => '');
            throw new Error(`HTTP_${res.status}:${text.slice(0, 200)}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}
