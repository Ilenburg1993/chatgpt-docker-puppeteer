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
 */

// ─── Internal Helpers ─────────────────────────────────────────────────────────

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
    if (typeof config.baseUrl !== 'string' || config.baseUrl.length === 0) {
        throw new Error('[sdk/provider] baseUrl is required and must be a non-empty string');
    }
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
    return config;
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
 * @returns {ProviderConfig}
 */
export function openaiProvider({ baseUrl, apiKey, bearerToken, wireApi }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.OPENAI, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
    if (wireApi !== undefined) config.wireApi = wireApi;
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
 * @returns {ProviderConfig}
 */
export function azureProvider({ baseUrl, apiKey, bearerToken, wireApi, apiVersion }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.AZURE, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
    if (wireApi !== undefined) config.wireApi = wireApi;
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
 * @returns {ProviderConfig}
 */
export function anthropicProvider({ baseUrl, apiKey, bearerToken }) {
    /** @type {ProviderConfig} */
    const config = { type: PROVIDER_TYPES.ANTHROPIC, baseUrl };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (bearerToken !== undefined) config.bearerToken = bearerToken;
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
