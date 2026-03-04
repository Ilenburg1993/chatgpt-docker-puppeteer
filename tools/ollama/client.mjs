// @ts-check
/**
 * Ollama HTTP Client (Dual-URL Architecture v5.1)
 *
 * Policy:
 * - Embeddings: ALWAYS local (cloud has no embedding endpoint)
 * - Non-embedding: cloud-first by default, local as optional fallback
 */

const DEFAULT_LIGHT_LOCAL_MODELS = [
    'qwen2.5-coder:0.5b',
    'qwen2.5-coder:1.5b',
    'qwen2.5-coder:3b',
    'qwen2.5:0.5b',
    'qwen2.5:1.5b',
    'qwen2.5:3b-instruct',
    'qwen2.5:3b',
    'llama3.2:1b',
    'llama3.2:3b',
    'gemma2:2b',
    'phi3:mini',
    'tinyllama:1.1b',
    'deepseek-r1:1.5b',
];

/**
 * Ollama HTTP Client with dual runtime routing.
 */
export class OllamaClient {
    /**
     * @param {Object} options
     * @param {string} [options.cloudBaseUrl]
     * @param {string} [options.cloudApiKey]
     * @param {boolean} [options.cloudEnabled]
     * @param {string} [options.localBaseUrl]
     * @param {'auto'|'cloud'|'local'} [options.nonEmbeddingRuntime]
     * @param {boolean} [options.nonEmbeddingLocalFallback]
     * @param {'light'|'custom'} [options.localModelProfile]
     * @param {string|string[]} [options.localAllowedModels]
     * @param {typeof fetch} [options.fetch]
     */
    constructor(options = {}) {
        this.cloudBaseUrl = options.cloudBaseUrl || process.env.OLLAMA_CLOUD_BASE_URL || 'https://ollama.com';
        this.cloudApiKey = options.cloudApiKey || process.env.OLLAMA_CLOUD_API_KEY || '';
        this.cloudEnabled =
            options.cloudEnabled !== undefined ? options.cloudEnabled : process.env.OLLAMA_CLOUD_ENABLED === 'true';

        this.localBaseUrl =
            options.localBaseUrl ||
            process.env.OLLAMA_LOCAL_BASE_URL ||
            process.env.OLLAMA_BASE_URL ||
            'http://host.docker.internal:11434';

        this.generateTimeout = Number(process.env.OLLAMA_GENERATE_TIMEOUT || 60000);
        this.embedTimeout = Number(process.env.OLLAMA_EMBED_TIMEOUT || 30000);
        this.listTimeout = Number(process.env.OLLAMA_LIST_TIMEOUT || 10000);
        this.healthTimeout = Number(process.env.OLLAMA_HEALTH_TIMEOUT || 5000);

        this.nonEmbeddingRuntime = this._normalizeRuntimePreference(
            options.nonEmbeddingRuntime || process.env.OLLAMA_NON_EMBEDDING_RUNTIME || 'auto'
        );

        this.nonEmbeddingLocalFallback =
            options.nonEmbeddingLocalFallback !== undefined
                ? Boolean(options.nonEmbeddingLocalFallback)
                : this._parseBoolean(process.env.OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK, true);

        this.localModelProfile = options.localModelProfile || process.env.OLLAMA_LOCAL_MODEL_PROFILE || 'light';

        this.localAllowedModels = this._buildLocalAllowedModels(
            options.localAllowedModels || process.env.OLLAMA_LOCAL_ALLOWED_MODELS || ''
        );

        this.lightLocalModels = new Set(DEFAULT_LIGHT_LOCAL_MODELS);
        this.fetch = options.fetch || globalThis.fetch;

        if (typeof this.fetch !== 'function') {
            throw new Error('Fetch API is not available in current runtime');
        }

        if (this.cloudEnabled && !this.cloudApiKey) {
            console.warn('[OllamaClient] Cloud enabled but OLLAMA_CLOUD_API_KEY is not set');
            console.warn('[OllamaClient] Get your API key at: https://ollama.com/settings/api-keys');
        }
    }

    /**
     * @param {any} value
     * @param {boolean} [defaultValue]
     */
    _parseBoolean(value, defaultValue = false) {
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }
        return String(value).toLowerCase() === 'true';
    }

    /** @param {any} value */
    _normalizeRuntimePreference(value) {
        const raw = String(value || 'auto')
            .trim()
            .toLowerCase();
        if (raw === 'cloud' || raw === 'local' || raw === 'auto') {
            return raw;
        }
        return 'auto';
    }

    /** @param {any} value */
    _buildLocalAllowedModels(value) {
        if (Array.isArray(value)) {
            return new Set(value.map(v => String(v || '').trim()).filter(Boolean));
        }

        const text = String(value || '').trim();
        if (!text) return new Set();

        return new Set(
            text
                .split(',')
                .map(v => v.trim())
                .filter(Boolean)
        );
    }

    /** @param {any} model */
    _assertLocalModelAllowed(model) {
        if (!model) return;

        if (this.localAllowedModels.size > 0 && !this.localAllowedModels.has(model)) {
            throw new Error(
                `Local model "${model}" is not allowed by OLLAMA_LOCAL_ALLOWED_MODELS. ` +
                    `Allowed: ${Array.from(this.localAllowedModels).join(', ')}`
            );
        }

        if (
            this.localAllowedModels.size === 0 &&
            this.localModelProfile === 'light' &&
            !this.lightLocalModels.has(model)
        ) {
            throw new Error(
                `Local model "${model}" is blocked by light profile (CPU-only 16GB policy). ` +
                    `Use one of: ${Array.from(this.lightLocalModels).join(', ')} ` +
                    `or configure OLLAMA_LOCAL_MODEL_PROFILE=custom.`
            );
        }
    }

    _getCloudHeaders() {
        const headers = /** @type {Record<string, string>} */ ({ 'Content-Type': 'application/json' });
        if (this.cloudApiKey) {
            headers['Authorization'] = `Bearer ${this.cloudApiKey}`;
        }
        return headers;
    }

    /** @param {any} error */
    _isAbortError(error) {
        return error?.name === 'AbortError' || String(error?.message || '').includes('cancelled by user');
    }

    /**
     * Resolve execution runtime according to policy.
     *
     * @param {{ operation?: 'embedding'|'generate'|'models'|'model_info', runtimePreference?: 'auto'|'cloud'|'local' }} [options]
     * @returns {{ runtime: 'cloud'|'local', requested: 'auto'|'cloud'|'local', operation: string, reason: string, cloudEnabled: boolean, localFallbackEnabled: boolean }}
     */
    resolveRuntime(options = {}) {
        const operation = options.operation || 'generate';
        const requested = this._normalizeRuntimePreference(options.runtimePreference || this.nonEmbeddingRuntime);

        if (operation === 'embedding') {
            return {
                runtime: 'local',
                requested,
                operation,
                reason: 'embedding_local_only',
                cloudEnabled: this.cloudEnabled,
                localFallbackEnabled: this.nonEmbeddingLocalFallback,
            };
        }

        if (requested === 'local') {
            return {
                runtime: 'local',
                requested,
                operation,
                reason: 'explicit_local',
                cloudEnabled: this.cloudEnabled,
                localFallbackEnabled: this.nonEmbeddingLocalFallback,
            };
        }

        if (requested === 'cloud') {
            if (!this.cloudEnabled) {
                throw new Error(
                    'Cloud runtime requested but OLLAMA_CLOUD_ENABLED=false. ' +
                        'Use runtime=local or runtime=auto with fallback enabled.'
                );
            }
            return {
                runtime: 'cloud',
                requested,
                operation,
                reason: 'explicit_cloud',
                cloudEnabled: this.cloudEnabled,
                localFallbackEnabled: this.nonEmbeddingLocalFallback,
            };
        }

        if (this.cloudEnabled) {
            return {
                runtime: 'cloud',
                requested,
                operation,
                reason: 'auto_cloud_first',
                cloudEnabled: this.cloudEnabled,
                localFallbackEnabled: this.nonEmbeddingLocalFallback,
            };
        }

        if (this.nonEmbeddingLocalFallback) {
            return {
                runtime: 'local',
                requested,
                operation,
                reason: 'auto_fallback_cloud_disabled',
                cloudEnabled: this.cloudEnabled,
                localFallbackEnabled: this.nonEmbeddingLocalFallback,
            };
        }

        throw new Error(
            'Cloud-first runtime is unavailable: OLLAMA_CLOUD_ENABLED=false and local fallback is disabled ' +
                '(OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK=false).'
        );
    }

    /**
     * @param {any} runtime
     * @param {any} requestBody
     * @param {any} [signal]
     */
    async _requestGenerateAtRuntime(runtime, requestBody, signal) {
        const baseUrl = runtime === 'cloud' ? this.cloudBaseUrl : this.localBaseUrl;
        const headers = runtime === 'cloud' ? this._getCloudHeaders() : { 'Content-Type': 'application/json' };

        if (runtime === 'local') {
            this._assertLocalModelAllowed(requestBody.model);
        }

        console.error(`[OllamaClient] generate() runtime=${runtime} base=${baseUrl}`);

        const timeoutSignal = AbortSignal.timeout(this.generateTimeout);
        const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        const response = await this.fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');

            if (runtime === 'cloud' && (response.status === 401 || response.status === 403)) {
                throw new Error(
                    `Ollama Cloud authentication failed (${response.status}). ` +
                        'Configure OLLAMA_CLOUD_API_KEY at https://ollama.com/settings/api-keys.'
                );
            }

            throw new Error(`Ollama generate failed at ${runtime} (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        if (!data.response) {
            throw new Error(`Ollama generate returned empty response at ${runtime}`);
        }

        return data.response;
    }

    /**
     * Generate with runtime metadata (cloud-first for non-embedding).
     *
     * @param {string} prompt
     * @param {string} model
     * @param {object} options
     * @returns {Promise<{response: string, runtime: 'cloud'|'local', primaryRuntime: 'cloud'|'local', fallbackUsed: boolean, routingReason: string, attempts: string[]}>}
     */
    async generateWithMetadata(prompt, model, options = {}) {
        const defaultModel = process.env.OLLAMA_DEFAULT_MODEL || 'qwen3-coder-next';
        const defaultMaxTokens = Number(process.env.OLLAMA_MAX_TOKENS || 1000);

        const _opts = /** @type {Record<string, any>} */ (options);
        const {
            temperature = 0.7,
            num_predict = defaultMaxTokens,
            top_p = 0.9,
            stream = false,
            runtime,
            signal,
            ...otherOptions
        } = _opts;

        const selectedModel = model || defaultModel;

        const requestBody = {
            model: selectedModel,
            prompt,
            stream,
            options: {
                temperature,
                num_predict,
                top_p,
                ...otherOptions,
            },
        };

        const resolved = this.resolveRuntime({ operation: 'generate', runtimePreference: runtime });
        const attempts = [resolved.runtime];

        try {
            const response = await this._requestGenerateAtRuntime(resolved.runtime, requestBody, signal);
            return {
                response,
                runtime: resolved.runtime,
                primaryRuntime: resolved.runtime,
                fallbackUsed: false,
                routingReason: resolved.reason,
                attempts,
            };
        } catch (primaryError) {
            const canFallback =
                resolved.runtime === 'cloud' &&
                resolved.requested === 'auto' &&
                this.nonEmbeddingLocalFallback &&
                !this._isAbortError(primaryError) &&
                !signal?.aborted;

            if (!canFallback) {
                const fallbackDisabledCase =
                    resolved.runtime === 'cloud' &&
                    resolved.requested === 'auto' &&
                    !this.nonEmbeddingLocalFallback &&
                    !this._isAbortError(primaryError);

                if (fallbackDisabledCase) {
                    throw new Error(
                        'Cloud-first generation failed and local fallback is disabled. ' +
                            `cloud_error="${/** @type {any} */ (primaryError).message}"`
                    );
                }

                if (this._isAbortError(primaryError)) {
                    if (signal?.aborted) {
                        throw new Error('Ollama generate cancelled by user');
                    }
                    throw new Error(`Ollama generate timeout (>${this.generateTimeout}ms)`);
                }
                throw new Error(`Ollama generate error: ${/** @type {any} */ (primaryError).message}`);
            }

            attempts.push('local');
            console.warn('[OllamaClient] Cloud generation failed, attempting local fallback');

            try {
                const response = await this._requestGenerateAtRuntime('local', requestBody, signal);
                return {
                    response,
                    runtime: 'local',
                    primaryRuntime: 'cloud',
                    fallbackUsed: true,
                    routingReason: 'auto_cloud_first_local_fallback',
                    attempts,
                };
            } catch (fallbackError) {
                throw new Error(
                    'Cloud-first generation failed and local fallback also failed. ' +
                        `cloud_error="${/** @type {any} */ (primaryError).message}"; local_error="${/** @type {any} */ (fallbackError).message}"`
                );
            }
        }
    }

    /**
     * Backward-compatible generate API.
     *
     * @param {string} prompt
     * @param {string} model
     * @param {object} options
     * @returns {Promise<string>}
     */
    async generate(prompt, model, options = {}) {
        const metadata = await this.generateWithMetadata(prompt, model, options);
        return metadata.response;
    }

    /**
     * Embeddings are always local.
     *
     * @param {string} text
     * @param {string} [model='nomic-embed-text']
     * @param {object} [options]
     * @returns {Promise<number[]>}
     */
    async embed(text, model = 'nomic-embed-text', options = {}) {
        if (!text || typeof text !== 'string') {
            throw new Error('Text must be a non-empty string');
        }

        const { signal } = /** @type {Record<string, any>} */ (options);
        const baseUrl = this.localBaseUrl;
        console.error(`[OllamaClient] embed() using local: ${baseUrl}`);

        try {
            const timeoutSignal = AbortSignal.timeout(this.embedTimeout);
            const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

            const response = await this.fetch(`${baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: text }),
                signal: abortSignal,
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');

                if (response.status >= 500 || response.status === 0) {
                    throw new Error(
                        `Local Ollama not accessible at ${baseUrl}. ` +
                            'Ensure Ollama is running (docker-compose up ollama OR ollama serve). ' +
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
            if (/** @type {any} */ (error)?.name === 'AbortError') {
                if (signal?.aborted) {
                    throw new Error('Ollama embed cancelled by user');
                }
                throw new Error(`Ollama embed timeout (>${this.embedTimeout}ms)`);
            }
            throw new Error(`Ollama embed error: ${/** @type {any} */ (error).message}`);
        }
    }

    /** @param {any} runtime */
    async _listModelsAtRuntime(runtime) {
        const baseUrl = runtime === 'cloud' ? this.cloudBaseUrl : this.localBaseUrl;
        const headers = runtime === 'cloud' ? this._getCloudHeaders() : {};

        const response = await this.fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(this.listTimeout),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Ollama list models failed at ${runtime} (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        if (!data.models || !Array.isArray(data.models)) {
            throw new Error(`Ollama list models returned invalid data at ${runtime}`);
        }

        return data.models;
    }

    /**
     * Returns both cloud and local model inventories.
     *
     * @returns {Promise<{priority: string, cloud_enabled: boolean, fallback_local_enabled: boolean, non_embedding_runtime: string, local_model_profile: string, cloud_models: any[], local_models: any[], errors: { cloud?: string, local?: string }}>}
     */
    async listModelsDetailed() {
        const details = {
            priority: 'cloud-first-non-embedding',
            cloud_enabled: this.cloudEnabled,
            fallback_local_enabled: this.nonEmbeddingLocalFallback,
            non_embedding_runtime: this.nonEmbeddingRuntime,
            local_model_profile: this.localModelProfile,
            cloud_models: /** @type {any[]} */ ([]),
            local_models: /** @type {any[]} */ ([]),
            errors: /** @type {Record<string, string>} */ ({}),
        };

        if (this.cloudEnabled) {
            try {
                details.cloud_models = await this._listModelsAtRuntime('cloud');
            } catch (error) {
                details.errors.cloud = /** @type {any} */ (error).message;
            }
        }

        try {
            details.local_models = await this._listModelsAtRuntime('local');
        } catch (error) {
            details.errors.local = /** @type {any} */ (error).message;
        }

        return details;
    }

    /**
     * Backward-compatible list API: returns cloud list when available, else local list.
     *
     * @returns {Promise<Array<{name: string, size: number, modified_at: string}>>}
     */
    async listModels() {
        const details = await this.listModelsDetailed();

        if (details.cloud_models.length > 0) {
            return details.cloud_models;
        }

        if (details.local_models.length > 0) {
            return details.local_models;
        }

        const cloudError = details.errors.cloud ? `cloud=${details.errors.cloud}` : null;
        const localError = details.errors.local ? `local=${details.errors.local}` : null;
        const suffix = [cloudError, localError].filter(Boolean).join('; ') || 'unknown cause';

        throw new Error(`Ollama list models error: ${suffix}`);
    }

    /**
     * @returns {Promise<{cloud: boolean, local: boolean, overall: boolean}>}
     */
    async health() {
        const health = {
            cloud: false,
            local: false,
            overall: false,
        };

        if (this.cloudEnabled) {
            try {
                const response = await this.fetch(`${this.cloudBaseUrl}/api/tags`, {
                    method: 'GET',
                    headers: this._getCloudHeaders(),
                    signal: AbortSignal.timeout(this.healthTimeout),
                });
                health.cloud = response.ok;
            } catch (_) {
                health.cloud = false;
            }
        }

        try {
            const response = await this.fetch(`${this.localBaseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(this.healthTimeout),
            });
            health.local = response.ok;
        } catch (_) {
            health.local = false;
        }

        health.overall = this.cloudEnabled ? health.cloud || health.local : health.local;

        return health;
    }

    /**
     * @param {string} modelName
     * @param {{runtime?: 'auto'|'cloud'|'local', signal?: AbortSignal}} [options]
     * @returns {Promise<object>}
     */
    async modelInfo(modelName, options = {}) {
        const resolved = this.resolveRuntime({
            operation: 'model_info',
            runtimePreference: options.runtime,
        });

        const tryRuntime = async (/** @type {string} */ runtime) => {
            const baseUrl = runtime === 'cloud' ? this.cloudBaseUrl : this.localBaseUrl;
            const headers = runtime === 'cloud' ? this._getCloudHeaders() : { 'Content-Type': 'application/json' };

            const timeoutSignal = AbortSignal.timeout(this.listTimeout);
            const abortSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

            const response = await this.fetch(`${baseUrl}/api/show`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: modelName }),
                signal: abortSignal,
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Ollama model info failed at ${runtime} (${response.status}): ${errorText}`);
            }

            return await response.json();
        };

        try {
            return await tryRuntime(resolved.runtime);
        } catch (primaryError) {
            const canFallback =
                resolved.runtime === 'cloud' &&
                resolved.requested === 'auto' &&
                this.nonEmbeddingLocalFallback &&
                !this._isAbortError(primaryError);

            if (!canFallback) {
                if (/** @type {any} */ (primaryError)?.name === 'AbortError') {
                    throw new Error(`Ollama model info timeout (>${this.listTimeout}ms)`);
                }
                throw new Error(`Ollama model info error: ${/** @type {any} */ (primaryError).message}`);
            }

            try {
                return await tryRuntime('local');
            } catch (fallbackError) {
                throw new Error(
                    'Ollama model info failed in cloud and local fallback. ' +
                        `cloud_error="${/** @type {any} */ (primaryError).message}"; local_error="${/** @type {any} */ (fallbackError).message}"`
                );
            }
        }
    }
}

export const ollama = new OllamaClient();
