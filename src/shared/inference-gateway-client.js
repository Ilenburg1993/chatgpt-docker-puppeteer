// @ts-check

/**
 * Shared Inference Gateway Client
 *
 * Módulo centralizado para comunicação com o Inference Gateway.
 * Usado por Audit Agent, Diagnostic Agent e outros consumidores.
 *
 * Variáveis de ambiente:
 * - INFERENCE_GATEWAY_HOST: Host do Gateway (padrão: 127.0.0.1)
 * - INFERENCE_GATEWAY_PORT: Porta do Gateway (padrão: 3099)
 * - INFERENCE_GATEWAY_ENABLED: Habilitar/desabilitar (padrão: true)
 * - INFERENCE_GATEWAY_TIMEOUT_MS: Timeout em ms (padrão: 120000)
 * - INFERENCE_GATEWAY_DEFAULT_MODEL: Modelo padrão (padrão: llama3.2)
 *
 * Client Tags disponíveis:
 * - audit_agent_triage: Para triage de auditoria
 * - audit_agent_patch: Para geração de patches
 * - audit_agent_review: Para revisão de código
 * - diagnostic_code_analyzer: Para análise de código diagnóstico
 * - diagnostic_system_analyzer: Para análise de sistema
 * - diagnostic_report_generator: Para geração de relatórios
 * - rag_embed: Para embeddings RAG
 * - mcp_ollama_generate: Para geração via MCP
 * - mcp_ollama_embed: Para embeddings via MCP
 * - diagnostics_probe: Para probes de diagnóstico
 * - fallback_generic: Para fallback genérico
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** @type {readonly string[]} */
export const CLIENT_TAGS = Object.freeze([
    'audit_agent_triage',
    'audit_agent_patch',
    'audit_agent_review',
    'diagnostic_code_analyzer',
    'diagnostic_system_analyzer',
    'diagnostic_report_generator',
    'rag_embed',
    'mcp_ollama_generate',
    'mcp_ollama_embed',
    'diagnostics_probe',
    'fallback_generic',
]);

/** @type {readonly string[]} */
export const ENDPOINTS = Object.freeze([
    '/health',
    '/metrics',
    '/v1/models',
    '/v1/generate',
    '/v1/embed',
    '/v1/validate/generate',
    '/v1/validate/embed',
    '/v1/policies',
    '/v1/policies/reload',
]);

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Obtém a URL base do Inference Gateway
 * @param {{
 *   host?: string,
 *   port?: number,
 *   baseUrl?: string
 * }} overrides
 * @returns {string}
 */
export function getGatewayBaseUrl(overrides = {}) {
    if (overrides.baseUrl) {
        return overrides.baseUrl;
    }
    const host = overrides.host || process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = overrides.port || Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    return `http://${host}:${port}`;
}

/**
 * Verifica se o Gateway está habilitado
 * @returns {boolean}
 */
export function isGatewayEnabled() {
    const envValue = process.env.INFERENCE_GATEWAY_ENABLED;
    if (envValue === undefined || envValue === null) {
        return true; // Padrão: habilitado
    }
    return String(envValue).toLowerCase() === 'true';
}

/**
 * Obtém o timeout configurado
 * @param {number} defaultTimeout
 * @returns {number}
 */
export function getTimeout(defaultTimeout = 120000) {
    const envTimeout = process.env.INFERENCE_GATEWAY_TIMEOUT_MS;
    if (envTimeout === undefined || envTimeout === null) {
        return defaultTimeout;
    }
    const parsed = Number(envTimeout);
    return isNaN(parsed) ? defaultTimeout : Math.max(1000, parsed);
}

/**
 * Obtém o modelo padrão configurado
 * @param {string} defaultModel
 * @returns {string}
 */
export function getDefaultModel(defaultModel = 'llama3.2') {
    const envModel = process.env.INFERENCE_GATEWAY_DEFAULT_MODEL;
    return (envModel && envModel.trim()) || defaultModel;
}

// ============================================================================
// HTTP UTILITIES
// ============================================================================

/**
 * Parseia JSON de forma segura
 * @param {unknown} text
 * @returns {object|null}
 */
function _parseJsonMaybe(text) {
    try {
        return JSON.parse(String(text || ''));
    } catch {
        return null;
    }
}

/**
 * Faz um POST JSON para o Gateway
 * @param {string} url
 * @param {object} body
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, text: string, json: object|null}>}
 */
async function _postJson(url, body, timeoutMs) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = _parseJsonMaybe(text);
    return { ok: res.ok, status: res.status, text, json };
}

/**
 * Faz um GET para o Gateway
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, text: string, json: object|null}>}
 */
async function _getJson(url, timeoutMs) {
    const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = _parseJsonMaybe(text);
    return { ok: res.ok, status: res.status, text, json };
}

// ============================================================================
// GATEWAY CLIENT
// ============================================================================

/**
 * Cria um cliente do Inference Gateway com configuração padronizada
 * @param {{
 *   clientTag?: string,
 *   baseUrl?: string,
 *   host?: string,
 *   port?: number,
 *   model?: string,
 *   timeout?: number,
 *   enabled?: boolean
 * }} options
 * @returns {object}
 */
export function createGatewayClient(options = {}) {
    const { clientTag = 'fallback_generic', baseUrl, host, port, model, timeout, enabled = true } = options;

    const _baseUrl = baseUrl || getGatewayBaseUrl({ host, port });
    const _timeout = timeout || getTimeout();
    const _model = model || getDefaultModel();

    return {
        /** @returns {string} */
        getBaseUrl: () => _baseUrl,

        /** @returns {string} */
        getClientTag: () => clientTag,

        /** @returns {boolean} */
        isEnabled: () => enabled && isGatewayEnabled(),

        /**
         * Verifica a saúde do Gateway
         * @returns {Promise<{ok: boolean, health?: object, error?: string}>}
         */
        async checkHealth() {
            try {
                const result = await _getJson(`${_baseUrl}/health`, Math.min(_timeout, 5000));
                if (!result.ok) {
                    return { ok: false, error: `HTTP ${result.status}` };
                }
                return { ok: true, health: result.json };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        },

        /**
         * Lista modelos disponíveis
         * @returns {Promise<{ok: boolean, models?: object[], error?: string}>}
         */
        async listModels() {
            try {
                const result = await _getJson(`${_baseUrl}/v1/models`, Math.min(_timeout, 10000));
                if (!result.ok) {
                    return { ok: false, error: `HTTP ${result.status}` };
                }
                return { ok: true, models: result.json?.models || [] };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        },

        /**
         * Valida se uma geração é permitida (preflight)
         * @param {{
         *   clientTag?: string,
         *   profileName?: string,
         *   model?: string,
         *   runtime?: string
         * }} options
         * @returns {Promise<{ok: boolean, validated?: boolean, error?: string, status?: number, details?: object}>}
         */
        async validateGenerate(options = {}) {
            const payload = {
                clientTag: options.clientTag || clientTag,
                profileName: options.profileName,
                model: options.model || _model,
                runtime: options.runtime || 'local',
            };

            try {
                const result = await _postJson(`${_baseUrl}/v1/validate/generate`, payload, Math.min(_timeout, 10000));

                if (!result.ok || !result.json?.ok) {
                    return {
                        ok: false,
                        validated: false,
                        error: result.json?.error || result.text || `HTTP ${result.status}`,
                        status: result.status,
                        details: result.json,
                    };
                }
                return { ok: true, validated: true, details: result.json };
            } catch (err) {
                return { ok: false, validated: false, error: err.message };
            }
        },

        /**
         * Gera texto usando o Gateway
         * @param {{
         *   prompt?: string,
         *   clientTag?: string,
         *   model?: string,
         *   profileName?: string,
         *   runtime?: string,
         *   maxTokens?: number,
         *   temperature?: number,
         *   preflight?: boolean
         * }} options
         * @returns {Promise<{
         *   ok: boolean,
         *   skipped?: boolean,
         *   response?: string,
         *   parsed?: object|null,
         *   error?: string,
         *   status?: number,
         *   details?: object,
         *   preflight?: object,
         *   policy?: object,
         *   model?: string,
         *   clientTag?: string,
         *   ts?: number
         * }>}
         */
        async generate(options = {}) {
            const {
                prompt,
                clientTag: optClientTag,
                model: optModel,
                profileName,
                runtime = 'local',
                maxTokens = 500,
                temperature,
                preflight: doPreflight = true,
            } = options;

            const tag = optClientTag || clientTag;
            const mod = optModel || _model;

            // Preflight opcional
            if (doPreflight) {
                const preflightResult = await this.validateGenerate({
                    clientTag: tag,
                    profileName,
                    model: mod,
                    runtime,
                });

                if (!preflightResult.validated) {
                    return {
                        ok: false,
                        skipped: true,
                        error: 'preflight_failed',
                        preflight: preflightResult.details,
                        clientTag: tag,
                        model: mod,
                    };
                }
            }

            // Geração
            const payload = {
                clientTag: tag,
                profileName,
                model: mod,
                runtime,
                prompt,
                maxTokens,
            };

            if (temperature !== undefined) {
                payload.temperature = temperature;
            }

            try {
                const result = await _postJson(`${_baseUrl}/v1/generate`, payload, _timeout);

                if (!result.ok || !result.json?.ok) {
                    return {
                        ok: false,
                        skipped: false,
                        error: result.json?.error || result.text || `HTTP ${result.status}`,
                        status: result.status,
                        details: result.json,
                        clientTag: tag,
                        model: mod,
                    };
                }

                const responseText = String(result.json?.result?.response || '').trim();
                const parsed = _parseJsonMaybe(responseText);

                return {
                    ok: true,
                    skipped: false,
                    response: responseText,
                    parsed,
                    policy: result.json?.policy || null,
                    preflight: doPreflight ? { validated: true } : null,
                    clientTag: tag,
                    model: mod,
                    ts: result.json?.ts || Date.now(),
                };
            } catch (err) {
                return {
                    ok: false,
                    skipped: false,
                    error: err.message,
                    clientTag: tag,
                    model: mod,
                };
            }
        },

        /**
         * Gera embeddings usando o Gateway
         * @param {{
         *   input?: string | string[],
         *   clientTag?: string,
         *   model?: string,
         *   preflight?: boolean
         * }} options
         * @returns {Promise<{
         *   ok: boolean,
         *   skipped?: boolean,
         *   embedding?: number[],
         *   embeddings?: number[][],
         *   error?: string
         * }>}
         */
        async embed(options = {}) {
            const { input, clientTag: optClientTag, model: optModel, preflight: doPreflight = true } = options;

            const tag = optClientTag || clientTag;
            const mod = optModel || _model;

            // Preflight opcional
            if (doPreflight) {
                const preflightResult = await this.validateEmbed({
                    clientTag: tag,
                    model: mod,
                });

                if (!preflightResult.validated) {
                    return {
                        ok: false,
                        skipped: true,
                        error: 'preflight_failed',
                    };
                }
            }

            const payload = {
                clientTag: tag,
                model: mod,
                input: Array.isArray(input) ? input : [input],
            };

            try {
                const result = await _postJson(`${_baseUrl}/v1/embed`, payload, _timeout);

                if (!result.ok || !result.json?.ok) {
                    return {
                        ok: false,
                        error: result.json?.error || result.text || `HTTP ${result.status}`,
                    };
                }

                const embeddings = result.json?.embeddings || [];
                return {
                    ok: true,
                    embedding: embeddings[0] || null,
                    embeddings: embeddings.length > 1 ? embeddings : undefined,
                };
            } catch (err) {
                return {
                    ok: false,
                    error: err.message,
                };
            }
        },

        /**
         * Valida se um embedding é permitido (preflight)
         * @param {{
         *   clientTag?: string,
         *   model?: string
         * }} options
         * @returns {Promise<{ok: boolean, validated?: boolean, error?: string}>}
         */
        async validateEmbed(options = {}) {
            const payload = {
                clientTag: options.clientTag || clientTag,
                model: options.model || _model,
            };

            try {
                const result = await _postJson(`${_baseUrl}/v1/validate/embed`, payload, Math.min(_timeout, 10000));

                if (!result.ok || !result.json?.ok) {
                    return {
                        ok: false,
                        validated: false,
                        error: result.json?.error || result.text || `HTTP ${result.status}`,
                    };
                }
                return { ok: true, validated: true };
            } catch (err) {
                return { ok: false, validated: false, error: err.message };
            }
        },
    };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Cria cliente para Audit Agent Triage
 * @returns {object}
 */
export function createAuditTriageClient() {
    return createGatewayClient({
        clientTag: 'audit_agent_triage',
        enabled: String(process.env.AUDIT_AGENT_TRIAGE_LLM_ENABLED || 'false').toLowerCase() === 'true',
    });
}

/**
 * Cria cliente para Audit Agent Patch
 * @returns {object}
 */
export function createAuditPatchClient() {
    return createGatewayClient({
        clientTag: 'audit_agent_patch',
        enabled: String(process.env.AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED || 'false').toLowerCase() === 'true',
    });
}

/**
 * Cria cliente para Diagnostic Code Analyzer
 * @returns {object}
 */
export function createDiagnosticCodeAnalyzerClient() {
    return createGatewayClient({
        clientTag: 'diagnostic_code_analyzer',
    });
}

/**
 * Cria cliente para Diagnostic System Analyzer
 * @returns {object}
 */
export function createDiagnosticSystemAnalyzerClient() {
    return createGatewayClient({
        clientTag: 'diagnostic_system_analyzer',
    });
}

/**
 * Cria cliente para Diagnostic Report Generator
 * @returns {object}
 */
export function createDiagnosticReportClient() {
    return createGatewayClient({
        clientTag: 'diagnostic_report_generator',
    });
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

/**
 * Barrel compatível com consumidores legados dos clientes do Inference Gateway.
 * @type {{
 *   CLIENT_TAGS: typeof CLIENT_TAGS,
 *   ENDPOINTS: typeof ENDPOINTS,
 *   getGatewayBaseUrl: typeof getGatewayBaseUrl,
 *   isGatewayEnabled: typeof isGatewayEnabled,
 *   getTimeout: typeof getTimeout,
 *   getDefaultModel: typeof getDefaultModel,
 *   createGatewayClient: typeof createGatewayClient,
 *   createAuditTriageClient: typeof createAuditTriageClient,
 *   createAuditPatchClient: typeof createAuditPatchClient,
 *   createDiagnosticCodeAnalyzerClient: typeof createDiagnosticCodeAnalyzerClient,
 *   createDiagnosticSystemAnalyzerClient: typeof createDiagnosticSystemAnalyzerClient,
 *   createDiagnosticReportClient: typeof createDiagnosticReportClient
 * }}
 */
export default {
    CLIENT_TAGS,
    ENDPOINTS,
    getGatewayBaseUrl,
    isGatewayEnabled,
    getTimeout,
    getDefaultModel,
    createGatewayClient,
    createAuditTriageClient,
    createAuditPatchClient,
    createDiagnosticCodeAnalyzerClient,
    createDiagnosticSystemAnalyzerClient,
    createDiagnosticReportClient,
};
