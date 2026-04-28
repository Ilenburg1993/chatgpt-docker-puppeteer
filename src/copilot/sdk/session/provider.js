// @ts-check
/**
 * src/copilot/sdk/provider.js
 *
 * Faixa 12 - Provider/BYOK Support. Builders para configuração de providers customizados (OpenAI-compat, Azure,
 * Anthropic).
 *
 * O SDK aceita um campo `provider?: ProviderConfig` em `CopilotClientOptions` para modo BYOK.
 *
 * @module copilot/sdk/provider
 * @see EventBus
 */

import { PROVIDER_TYPES } from '../constants.js';
import { log } from '../logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {'openai' | 'azure' | 'anthropic'} ProviderType
 */

/**
 * @typedef {object} ProviderConfig
 * @property {ProviderType} [type] - tipo do provider (default: 'openai')
 * @property {'completions' | 'responses'} [wireApi] - formato da API (openai/azure only, default: 'completions')
 * @property {string} baseUrl - URL do endpoint da API
 * @property {string} [apiKey] - API key (opcional para providers locais como Ollama)
 * @property {string} [bearerToken] - bearer token (tem precedencia sobre apiKey)
 * @property {{ apiVersion?: string }} [azure] - opcoes especificas Azure
 * @property {Record<string, string>} [headers] - headers HTTP adicionais
 */

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function assertOptionalString(value, fieldName) {
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
        throw new Error(`[sdk/provider] ${fieldName} must be a non-empty string when provided`);
    }
}

/**
 * @param {Record<string, string> | undefined} headers
 */
function validateHeaders(headers) {
    if (headers === undefined) return;
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('[sdk/provider] headers must be a plain object when provided');
    }
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== 'string') {
            throw new Error(`[sdk/provider] headers['${key}'] must be a string`);
        }
    }
}

/**
 * @param {string} rawUrl
 * @param {ProviderType} type
 * @returns {string}
 */
function normalizeBaseUrl(rawUrl, type) {
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
        throw new Error('[sdk/provider] baseUrl is required and must be a non-empty string');
    }
    const trimmed = rawUrl.trim();
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`[sdk/provider] baseUrl must be an absolute URL: '${trimmed}'`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`[sdk/provider] baseUrl must use http or https: '${trimmed}'`);
    }
    if (type === PROVIDER_TYPES.AZURE) {
        const path = parsed.pathname.replace(/\/+$/, '');
        if (path.length > 0) {
            log(
                'WARN',
                `[sdk/provider] Azure baseUrl deveria apontar apenas para o host, sem path; recebido '${trimmed}'`,
            );
        }
    }
    return trimmed.replace(/\/+$/, '');
}

/**
 * Valida e retorna um ProviderConfig canonical.
 *
 * @param {ProviderConfig} config
 * @returns {ProviderConfig}
 */
function validateConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('[sdk/provider] config must be a non-null object');
    }
    /** @type {ProviderType} */
    const providerType = config.type ?? PROVIDER_TYPES.OPENAI;
    if (config.type !== undefined) {
        const validTypes = new Set(Object.values(PROVIDER_TYPES));
        if (!validTypes.has(config.type)) {
            throw new Error(
                `[sdk/provider] invalid provider type: '${config.type}'. Must be one of: ${[...validTypes].join(', ')}`,
            );
        }
    }
    if (config.wireApi !== undefined && config.wireApi !== 'completions' && config.wireApi !== 'responses') {
        throw new Error(`[sdk/provider] invalid wireApi: '${config.wireApi}'. Must be 'completions' or 'responses'`);
    }
    if (providerType === PROVIDER_TYPES.ANTHROPIC && config.wireApi !== undefined) {
        throw new Error('[sdk/provider] wireApi is not supported for anthropic providers');
    }
    assertOptionalString(config.apiKey, 'apiKey');
    assertOptionalString(config.bearerToken, 'bearerToken');
    if (config.azure?.apiVersion !== undefined) {
        assertOptionalString(config.azure.apiVersion, 'azure.apiVersion');
    }
    validateHeaders(config.headers);
    return {
        ...config,
        type: providerType,
        baseUrl: normalizeBaseUrl(config.baseUrl, providerType),
        ...(config.headers !== undefined ? { headers: { ...config.headers } } : {}),
        ...(config.azure !== undefined ? { azure: { ...config.azure } } : {}),
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Cria configuracao de provider OpenAI-compatible (generico). Funciona com OpenAI, Ollama, vLLM, LiteLLM, ou qualquer
 * endpoint compativel.
 *
 * @example
 *     ```js
 *     // OpenAI direta
 *     const openai = openaiProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-...' });
 *
 *     // Ollama local (sem API key)
 *     const ollama = openaiProvider({ baseUrl: 'http://localhost:11434/v1' });
 *     ```;
 *
 * @param {object} options
 * @param {string} options.baseUrl - URL do endpoint (e.g. 'https://api.openai.com/v1' ou 'http://localhost:11434/v1')
 * @param {string} [options.apiKey] - API key (opcional para Ollama/providers locais)
 * @param {string} [options.bearerToken] - bearer token alternativo
 * @param {'completions' | 'responses'} [options.wireApi] - formato da API (default: 'completions')
 * @param {Record<string, string>} [options.headers] - headers HTTP adicionais
 * @returns {ProviderConfig}
 */
export function openaiProvider({ baseUrl, apiKey, bearerToken, wireApi, headers }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.OPENAI, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
    if (wireApi !== undefined) config.wireApi = wireApi;
    if (headers !== undefined) config.headers = headers;
    return validateConfig(config);
}

/**
 * Cria configuracao de provider Azure OpenAI. Inclui campos especificos Azure como `apiVersion`.
 *
 * @example
 *     ```js
 *     const azure = azureProvider({
 *         baseUrl: 'https://my-resource.openai.azure.com',
 *         apiKey: 'azure-key-...',
 *         apiVersion: '2024-10-21',
 *     });
 *     ```;
 *
 * @param {object} options
 * @param {string} options.baseUrl - URL do endpoint Azure (e.g. 'https://my-resource.openai.azure.com')
 * @param {string} [options.apiKey] - Azure API key
 * @param {string} [options.bearerToken] - bearer token alternativo
 * @param {'completions' | 'responses'} [options.wireApi] - formato da API (default: 'completions')
 * @param {string} [options.apiVersion] - Azure API version (default: '2024-10-21')
 * @param {Record<string, string>} [options.headers] - headers HTTP adicionais
 * @returns {ProviderConfig}
 */
export function azureProvider({ baseUrl, apiKey, bearerToken, wireApi, apiVersion, headers }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.AZURE, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
    if (wireApi !== undefined) config.wireApi = wireApi;
    if (headers !== undefined) config.headers = headers;
    if (apiVersion !== undefined) {
        config.azure = { apiVersion };
    }
    return validateConfig(config);
}

/**
 * Cria configuracao de provider Anthropic (Claude).
 *
 * @example
 *     ```js
 *     const anthropic = anthropicProvider({
 *         baseUrl: 'https://api.anthropic.com',
 *         apiKey: 'sk-ant-...',
 *     });
 *     ```;
 *
 * @param {object} options
 * @param {string} options.baseUrl - URL do endpoint Anthropic (e.g. 'https://api.anthropic.com')
 * @param {string} [options.apiKey] - Anthropic API key
 * @param {string} [options.bearerToken] - bearer token alternativo
 * @param {Record<string, string>} [options.headers] - headers HTTP adicionais
 * @returns {ProviderConfig}
 */
export function anthropicProvider({ baseUrl, apiKey, bearerToken, headers }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.ANTHROPIC, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
    if (headers !== undefined) config.headers = headers;
    return validateConfig(config);
}

/**
 * Valida um ProviderConfig arbitrario sem construir. Util para validar configs carregados de JSON/env.
 *
 * @param {ProviderConfig} config - config a validar
 * @returns {ProviderConfig} config validado
 * @throws {Error} se o config for invalido
 */
export function validateProviderConfig(config) {
    return validateConfig(config);
}

/**
 * Verifica se um tipo de provider e valido.
 *
 * @param {string} type - tipo a verificar
 * @returns {boolean}
 */
export function isValidProviderType(type) {
    return new Set(Object.values(PROVIDER_TYPES)).has(/** @type {ProviderType} */ (type));
}
