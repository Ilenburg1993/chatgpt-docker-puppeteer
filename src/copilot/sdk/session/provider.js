// @ts-check
/**
 * src/copilot/sdk/provider.js
 *
 * Faixa 12 - Provider/BYOK Support. Builders para configuração de providers customizados (OpenAI-compat, Azure,
 * Anthropic).
 *
 * O SDK aceita um campo `provider?: ProviderConfig` em `SessionConfig`/`ResumeSessionConfig` para modo BYOK.
 *
 * @module copilot/sdk/provider
 * @see EventBus
 */

import { readBoundedResponseJson } from '#copilot/infra/public/http-response';
import { PROVIDER_TYPES } from '../constants.js';
import { log } from '../logger.js';
import { redactSecretRecord, redactSecretText } from '../../core/index.js';

const BYOK_MODEL_DISCOVERY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

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

/**
 * @typedef {object} ByokSummary
 * @property {boolean} enabled
 * @property {boolean} ready
 * @property {string | null} preset
 * @property {string | null} profile
 * @property {ProviderType | null} providerType
 * @property {string | null} baseUrl
 * @property {string | null} model
 * @property {'completions' | 'responses' | null} wireApi
 * @property {string | null} azureApiVersion
 * @property {{ apiKeyConfigured: boolean; bearerTokenConfigured: boolean; headersConfigured: boolean }} auth
 * @property {{ configured: boolean; count: number }} modelList
 * @property {{ reasoningEffort: boolean; sdkReasoningEffort?: boolean; vision: boolean; contextWindowTokens: number }} capabilities
 * @property {{ maxRequestTokens: number | null; tokensPerMinute: number | null; requestsPerMinute: number | null; dailyRequests: number | null }} limits
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/**
 * @typedef {object} ConfiguredByokState
 * @property {boolean} enabled
 * @property {boolean} ready
 * @property {ProviderConfig | null} provider
 * @property {string | null} model
 * @property {{ supports?: { reasoningEffort?: boolean; vision?: boolean }; limits?: { max_context_window_tokens?: number } } | undefined} modelCapabilities
 * @property {ByokSummary} summary
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/**
 * @typedef {'static' | 'remote' | 'remote-cache' | 'static-fallback'} ByokModelDiscoverySource
 */

/**
 * @typedef {object} ByokModelDiscoveryResult
 * @property {import('../types.js').ModelInfo[]} models
 * @property {ByokModelDiscoverySource} source
 * @property {string | null} endpoint
 * @property {boolean} fromCache
 * @property {string | null} error
 * @property {{ id: string | null; inCatalog: boolean | null; authoritative: boolean }} configuredModel
 */

/**
 * @typedef {ByokModelDiscoveryResult & { expiresAt: number; ttlMs: number }} ByokModelDiscoveryCacheResult
 */

/** @type {readonly string[]} */
export const BYOK_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_ENABLED',
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_PROFILES_JSON',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_PROVIDER_TYPE',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
    'COPILOT_BYOK_WIRE_API',
    'COPILOT_BYOK_AZURE_API_VERSION',
    'COPILOT_BYOK_HEADERS_JSON',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_MODELS',
    'COPILOT_BYOK_MODELS_JSON',
    'COPILOT_BYOK_MODELS_ENDPOINT',
    'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
    'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
    'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_MAX_REQUEST_TOKENS',
    'COPILOT_BYOK_TOKENS_PER_MINUTE',
    'COPILOT_BYOK_REQUESTS_PER_MINUTE',
    'COPILOT_BYOK_DAILY_REQUESTS',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'OPENROUTER_API_KEY',
    'OPEN_ROUTER_KEY',
    'GROQ_API_KEY',
    'GROQ_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
    'GOOGLE_CLOUD_GEMINI_KEY',
    'GEMINI_KEY',
    'MISTRAL_API_KEY',
    'MISTRAL_KEY',
    'HUGGING_FACE_API_KEY',
    'HUGGING_FACE_KEY',
    'HF_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'NVIDIA_API_KEY',
    'NVIDIA_KEY',
    'CEREBRAS_API_KEY',
    'CEREBRAS_KEY',
    'CHUTES_API_KEY',
    'CHUTES_AI',
    'ZAI_API_KEY',
    'Z_AI_KEY',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY',
    'OLLAMA_CLOUD_BASE_URL',
    'OLLAMA_LOCAL_BASE_URL',
    'OLLAMA_BASE_URL',
    'OLLAMA_DEFAULT_MODEL',
    'OLLAMA_CHAT_MODEL',
    'KILO_API_KEY',
    'KILO_CODE_API_KEY',
    'KILO_GATEWAY_BASE_URL',
    'KILO_BASE_URL',
    'KILO_MODEL',
    'KILO_DEFAULT_MODEL',
    'OPENCODE_API_KEY',
    'OPENCODE_MODEL',
    'OPENCODE_DEFAULT_MODEL',
]);

/** @type {Map<string, { expiresAt: number; models: import('../types.js').ModelInfo[] }>} */
const BYOK_MODEL_DISCOVERY_CACHE = new Map();

/** @type {readonly string[]} */
export const BYOK_SECRET_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'OPENROUTER_API_KEY',
    'OPEN_ROUTER_KEY',
    'GROQ_API_KEY',
    'GROQ_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
    'GOOGLE_CLOUD_GEMINI_KEY',
    'GEMINI_KEY',
    'MISTRAL_API_KEY',
    'MISTRAL_KEY',
    'HUGGING_FACE_API_KEY',
    'HUGGING_FACE_KEY',
    'HF_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_KEY',
    'NVIDIA_API_KEY',
    'NVIDIA_KEY',
    'CEREBRAS_API_KEY',
    'CEREBRAS_KEY',
    'CHUTES_API_KEY',
    'CHUTES_AI',
    'ZAI_API_KEY',
    'Z_AI_KEY',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY',
    'KILO_API_KEY',
    'KILO_CODE_API_KEY',
    'OPENCODE_API_KEY',
]);

/**
 * @typedef {object} ByokProviderPresetDefinition
 * @property {ProviderType} providerType
 * @property {string | ((env: Record<string, string | undefined>) => string | undefined)} [baseUrl]
 * @property {string} [defaultModel]
 * @property {readonly string[]} [modelEnvKeys]
 * @property {readonly string[]} [apiKeyEnvKeys]
 * @property {readonly string[]} [bearerTokenEnvKeys]
 * @property {readonly string[]} [staticModels]
 * @property {string} [modelsEndpoint]
 * @property {number} [contextWindowTokens]
 * @property {boolean} [supportsReasoning]
 * @property {boolean} [supportsVision]
 * @property {boolean} [requiresAuth]
 * @property {Record<string, string>} [headers]
 */

/** @type {Readonly<Record<string, ByokProviderPresetDefinition>>} */
const BYOK_PROVIDER_PRESETS = Object.freeze({
    openai: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        modelEnvKeys: Object.freeze(['OPENAI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['OPENAI_API_KEY']),
        contextWindowTokens: 128_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    'openai-compatible': {
        providerType: PROVIDER_TYPES.OPENAI,
        modelEnvKeys: Object.freeze(['OPENAI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['OPENAI_API_KEY']),
        contextWindowTokens: 128_000,
        supportsReasoning: false,
        supportsVision: false,
    },
    'ollama-local': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => normalizeOllamaBaseUrl(firstEnv(env, ['OLLAMA_LOCAL_BASE_URL', 'OLLAMA_BASE_URL'])) ?? 'http://localhost:11434/v1',
        modelEnvKeys: Object.freeze(['OLLAMA_DEFAULT_MODEL', 'OLLAMA_CHAT_MODEL']),
        defaultModel: 'qwen3-coder-next',
        staticModels: Object.freeze(['qwen3-coder-next']),
        contextWindowTokens: 128_000,
        supportsReasoning: false,
        supportsVision: false,
    },
    'ollama-cloud': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => normalizeOllamaBaseUrl(firstEnv(env, ['OLLAMA_CLOUD_BASE_URL'])) ?? 'https://ollama.com/v1',
        modelEnvKeys: Object.freeze(['OLLAMA_DEFAULT_MODEL', 'OLLAMA_CHAT_MODEL']),
        apiKeyEnvKeys: Object.freeze(['OLLAMA_API_KEY', 'OLLAMA_CLOUD_API_KEY']),
        defaultModel: 'qwen3-coder-next',
        staticModels: Object.freeze(['qwen3-coder-next', 'qwen3-next:80b-cloud']),
        contextWindowTokens: 128_000,
        supportsReasoning: false,
        supportsVision: false,
        requiresAuth: true,
    },
    'kilo-code': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => firstEnv(env, ['KILO_GATEWAY_BASE_URL', 'KILO_BASE_URL']) ?? 'https://api.kilo.ai/api/gateway',
        modelEnvKeys: Object.freeze(['KILO_MODEL', 'KILO_DEFAULT_MODEL']),
        bearerTokenEnvKeys: Object.freeze(['KILO_API_KEY', 'KILO_CODE_API_KEY']),
        defaultModel: 'kilo-auto/free',
        staticModels: Object.freeze(['kilo-auto/free', 'kilo-auto/balanced', 'anthropic/claude-sonnet-4.5']),
        contextWindowTokens: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    'kilo-gateway': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => firstEnv(env, ['KILO_GATEWAY_BASE_URL', 'KILO_BASE_URL']) ?? 'https://api.kilo.ai/api/gateway',
        modelEnvKeys: Object.freeze(['KILO_MODEL', 'KILO_DEFAULT_MODEL']),
        bearerTokenEnvKeys: Object.freeze(['KILO_API_KEY', 'KILO_CODE_API_KEY']),
        defaultModel: 'kilo-auto/free',
        staticModels: Object.freeze(['kilo-auto/free', 'kilo-auto/balanced', 'anthropic/claude-sonnet-4.5']),
        contextWindowTokens: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    kilo: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => firstEnv(env, ['KILO_GATEWAY_BASE_URL', 'KILO_BASE_URL']) ?? 'https://api.kilo.ai/api/gateway',
        modelEnvKeys: Object.freeze(['KILO_MODEL', 'KILO_DEFAULT_MODEL']),
        bearerTokenEnvKeys: Object.freeze(['KILO_API_KEY', 'KILO_CODE_API_KEY']),
        defaultModel: 'kilo-auto/free',
        staticModels: Object.freeze(['kilo-auto/free', 'kilo-auto/balanced', 'anthropic/claude-sonnet-4.5']),
        contextWindowTokens: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    openrouter: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://openrouter.ai/api/v1',
        modelEnvKeys: Object.freeze(['OPENROUTER_MODEL', 'OPEN_ROUTER_MODEL']),
        apiKeyEnvKeys: Object.freeze(['OPENROUTER_API_KEY', 'OPEN_ROUTER_KEY']),
        defaultModel: 'openrouter/free',
        staticModels: Object.freeze(['openrouter/free', 'deepseek/deepseek-v4-flash:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'google/gemma-4-31b-it:free']),
        contextWindowTokens: 128_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    groq: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://api.groq.com/openai/v1',
        modelEnvKeys: Object.freeze(['GROQ_MODEL']),
        apiKeyEnvKeys: Object.freeze(['GROQ_API_KEY', 'GROQ_KEY']),
        defaultModel: 'qwen/qwen3-32b',
        staticModels: Object.freeze(['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile']),
        contextWindowTokens: 131_072,
        supportsReasoning: true,
        supportsVision: false,
        requiresAuth: true,
    },
    gemini: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        modelEnvKeys: Object.freeze(['GEMINI_MODEL', 'GOOGLE_GENERATIVE_AI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY', 'GEMINI_KEY']),
        defaultModel: 'gemini-2.5-flash',
        staticModels: Object.freeze(['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-embedding-001']),
        contextWindowTokens: 1_048_576,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    mistral: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://api.mistral.ai/v1',
        modelEnvKeys: Object.freeze(['MISTRAL_MODEL']),
        apiKeyEnvKeys: Object.freeze(['MISTRAL_API_KEY', 'MISTRAL_KEY']),
        defaultModel: 'codestral-latest',
        staticModels: Object.freeze(['codestral-latest', 'mistral-small-latest', 'magistral-medium-latest']),
        contextWindowTokens: 256_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    huggingface: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://router.huggingface.co/v1',
        modelEnvKeys: Object.freeze(['HUGGING_FACE_MODEL', 'HF_MODEL']),
        apiKeyEnvKeys: Object.freeze(['HUGGING_FACE_API_KEY', 'HUGGING_FACE_KEY', 'HF_TOKEN']),
        defaultModel: 'openai/gpt-oss-120b:fastest',
        staticModels: Object.freeze(['openai/gpt-oss-120b:fastest', 'deepseek-ai/DeepSeek-R1:fastest', 'Qwen/Qwen3-Coder-480B-A35B-Instruct:fastest']),
        contextWindowTokens: 128_000,
        supportsReasoning: true,
        supportsVision: false,
        requiresAuth: true,
    },
    'cloudflare-workers-ai': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: (env) => {
            const accountId = firstEnv(env, ['CLOUDFLARE_ACCOUNT_ID']);
            return accountId ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1` : undefined;
        },
        modelEnvKeys: Object.freeze(['CLOUDFLARE_MODEL', 'CLOUDFLARE_WORKERS_AI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_KEY']),
        defaultModel: '@cf/meta/llama-3.1-8b-instruct',
        staticModels: Object.freeze(['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq']),
        contextWindowTokens: 32_768,
        supportsReasoning: false,
        supportsVision: false,
        requiresAuth: true,
    },
    'nvidia-nim': {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelEnvKeys: Object.freeze(['NVIDIA_MODEL', 'NVIDIA_NIM_MODEL']),
        apiKeyEnvKeys: Object.freeze(['NVIDIA_API_KEY', 'NVIDIA_KEY']),
        defaultModel: 'openai/gpt-oss-120b',
        staticModels: Object.freeze(['openai/gpt-oss-120b', 'meta/llama-3.1-70b-instruct', 'meta/llama-3.1-405b-instruct']),
        contextWindowTokens: 131_072,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    cerebras: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://api.cerebras.ai/v1',
        modelEnvKeys: Object.freeze(['CEREBRAS_MODEL']),
        apiKeyEnvKeys: Object.freeze(['CEREBRAS_API_KEY', 'CEREBRAS_KEY']),
        defaultModel: 'gpt-oss-120b',
        staticModels: Object.freeze(['gpt-oss-120b', 'qwen-3-coder-480b', 'llama3.3-70b']),
        contextWindowTokens: 131_072,
        supportsReasoning: true,
        supportsVision: false,
        requiresAuth: true,
    },
    chutes: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://llm.chutes.ai/v1',
        modelEnvKeys: Object.freeze(['CHUTES_MODEL', 'CHUTES_AI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['CHUTES_API_KEY', 'CHUTES_AI']),
        defaultModel: 'Qwen/Qwen3.5-397B-A17B-TEE',
        staticModels: Object.freeze([
            'Qwen/Qwen3.5-397B-A17B-TEE',
            'Qwen/Qwen3-235B-A22B-Thinking-2507',
            'Qwen/Qwen2.5-Coder-32B-Instruct-TEE',
        ]),
        contextWindowTokens: 131_072,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    opencode: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://opencode.ai/zen/v1',
        modelEnvKeys: Object.freeze(['OPENCODE_MODEL', 'OPENCODE_DEFAULT_MODEL']),
        apiKeyEnvKeys: Object.freeze(['OPENCODE_API_KEY']),
        defaultModel: 'gpt-5.1-codex',
        staticModels: Object.freeze(['gpt-5.1-codex', 'claude-sonnet-4-5', 'gemini-3.5-flash', 'glm-5.1', 'deepseek-v4-flash-free']),
        contextWindowTokens: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
    zai: {
        providerType: PROVIDER_TYPES.OPENAI,
        baseUrl: 'https://api.z.ai/api/paas/v4',
        modelEnvKeys: Object.freeze(['ZAI_MODEL', 'Z_AI_MODEL']),
        apiKeyEnvKeys: Object.freeze(['ZAI_API_KEY', 'Z_AI_KEY']),
        defaultModel: 'glm-4.6',
        staticModels: Object.freeze(['glm-5.1', 'glm-4.7', 'glm-4.6', 'glm-4.5-air']),
        contextWindowTokens: 128_000,
        supportsReasoning: true,
        supportsVision: true,
        requiresAuth: true,
    },
});

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

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} keys
 * @returns {string | undefined}
 */
function firstEnv(env, keys) {
    for (const key of keys) {
        const value = env[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return undefined;
}

/**
 * @param {string | undefined} raw
 * @returns {boolean | undefined}
 */
function parseBoolean(raw) {
    if (raw === undefined || raw.trim() === '') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return undefined;
}

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveInteger(raw, fallback) {
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {string | undefined} raw
 * @returns {number | null}
 */
function parseOptionalPositiveInteger(raw) {
    const parsed = parsePositiveInteger(raw, 0);
    return parsed > 0 ? parsed : null;
}

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseCsv(raw) {
    if (!raw || raw.trim() === '') return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {string | undefined} raw
 * @returns {Record<string, string> | undefined}
 */
function parseHeaders(raw) {
    if (!raw || raw.trim() === '') return undefined;
    const parsed = JSON.parse(raw);
    validateHeaders(parsed);
    return /** @type {Record<string, string>} */ (parsed);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalBooleanString(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return optionalString(value);
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalNumberString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    return optionalString(value);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string} canonicalKey
 * @param {string[]} aliases
 * @returns {string | undefined}
 */
function firstProfileString(profile, canonicalKey, aliases = []) {
    const keys = [canonicalKey, ...aliases];
    for (const key of keys) {
        const value = optionalString(profile[key]);
        if (value) return value;
    }
    return undefined;
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, string | undefined>} env
 * @param {string} canonicalKey
 * @param {string[]} directAliases
 * @param {string[]} envRefAliases
 * @returns {string | undefined}
 */
function firstProfileSecret(profile, env, canonicalKey, directAliases = [], envRefAliases = []) {
    const envRef = firstProfileString(profile, `${canonicalKey}Env`, envRefAliases);
    if (envRef) {
        const envValue = firstEnv(env, [envRef]);
        if (envValue) return envValue;
    }
    return firstProfileString(profile, canonicalKey, directAliases);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
function applyProfileToEnv(profile, env) {
    const next = { ...env };
    const preset = firstProfileString(profile, 'preset', ['providerPreset', 'COPILOT_BYOK_PROVIDER_PRESET']);
    const providerType = firstProfileString(profile, 'providerType', ['type', 'COPILOT_BYOK_PROVIDER_TYPE']);
    const baseUrl = firstProfileString(profile, 'baseUrl', ['baseURL', 'url', 'COPILOT_BYOK_BASE_URL']);
    const wireApi = firstProfileString(profile, 'wireApi', ['COPILOT_BYOK_WIRE_API']);
    const azureApiVersion = firstProfileString(profile, 'azureApiVersion', ['apiVersion', 'COPILOT_BYOK_AZURE_API_VERSION']);
    const model = firstProfileString(profile, 'model', ['modelId', 'id', 'COPILOT_BYOK_MODEL']);
    const models = firstProfileString(profile, 'models', ['COPILOT_BYOK_MODELS']);
    const modelsEndpoint = firstProfileString(profile, 'modelsEndpoint', [
        'modelEndpoint',
        'modelsUrl',
        'modelsURL',
        'COPILOT_BYOK_MODELS_ENDPOINT',
    ]);
    const modelDiscoveryEnabled = optionalBooleanString(
        profile['modelDiscoveryEnabled'] ?? profile['discoverModels'] ?? profile['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED'],
    );
    const modelDiscoveryTimeoutMs = optionalNumberString(
        profile['modelDiscoveryTimeoutMs'] ?? profile['COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS'],
    );
    const modelDiscoveryTtlMs = optionalNumberString(
        profile['modelDiscoveryTtlMs'] ?? profile['COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS'],
    );
    const modelsJson = profile['modelsJson'] ?? profile['modelsJSON'] ?? profile['COPILOT_BYOK_MODELS_JSON'];
    const contextWindowTokens = optionalNumberString(
        profile['contextWindowTokens'] ?? profile['contextWindow'] ?? profile['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'],
    );
    const maxRequestTokens = optionalNumberString(
        profile['maxRequestTokens'] ?? profile['maxInputTokens'] ?? profile['COPILOT_BYOK_MAX_REQUEST_TOKENS'],
    );
    const tokensPerMinute = optionalNumberString(
        profile['tokensPerMinute'] ?? profile['tpm'] ?? profile['COPILOT_BYOK_TOKENS_PER_MINUTE'],
    );
    const requestsPerMinute = optionalNumberString(
        profile['requestsPerMinute'] ?? profile['rpm'] ?? profile['COPILOT_BYOK_REQUESTS_PER_MINUTE'],
    );
    const dailyRequests = optionalNumberString(
        profile['dailyRequests'] ?? profile['requestsPerDay'] ?? profile['rpd'] ?? profile['COPILOT_BYOK_DAILY_REQUESTS'],
    );
    const supportsReasoning = optionalBooleanString(
        profile['supportsReasoning'] ?? profile['reasoning'] ?? profile['COPILOT_BYOK_SUPPORTS_REASONING'],
    );
    const supportsVision = optionalBooleanString(
        profile['supportsVision'] ?? profile['vision'] ?? profile['COPILOT_BYOK_SUPPORTS_VISION'],
    );
    const apiKey = firstProfileSecret(profile, env, 'apiKey', ['key', 'COPILOT_BYOK_API_KEY'], ['apiKeyEnv', 'keyEnv']);
    const bearerToken = firstProfileSecret(profile, env, 'bearerToken', ['token', 'COPILOT_BYOK_BEARER_TOKEN'], [
        'bearerTokenEnv',
        'tokenEnv',
    ]);
    const headersJson =
        typeof profile['headers'] === 'object' && profile['headers'] !== null
            ? JSON.stringify(profile['headers'])
            : firstProfileString(profile, 'headersJson', ['headersJSON', 'COPILOT_BYOK_HEADERS_JSON']);

    if (preset) next['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
    if (providerType) next['COPILOT_BYOK_PROVIDER_TYPE'] = providerType;
    if (baseUrl) next['COPILOT_BYOK_BASE_URL'] = baseUrl;
    if (wireApi) next['COPILOT_BYOK_WIRE_API'] = wireApi;
    if (azureApiVersion) next['COPILOT_BYOK_AZURE_API_VERSION'] = azureApiVersion;
    if (model) next['COPILOT_BYOK_MODEL'] = model;
    if (models) next['COPILOT_BYOK_MODELS'] = models;
    if (modelsEndpoint) next['COPILOT_BYOK_MODELS_ENDPOINT'] = modelsEndpoint;
    if (modelDiscoveryEnabled) next['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED'] = modelDiscoveryEnabled;
    if (modelDiscoveryTimeoutMs) next['COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS'] = modelDiscoveryTimeoutMs;
    if (modelDiscoveryTtlMs) next['COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS'] = modelDiscoveryTtlMs;
    if (Array.isArray(modelsJson) || (modelsJson && typeof modelsJson === 'object')) {
        next['COPILOT_BYOK_MODELS_JSON'] = JSON.stringify(modelsJson);
    } else if (typeof modelsJson === 'string' && modelsJson.trim()) {
        next['COPILOT_BYOK_MODELS_JSON'] = modelsJson.trim();
    }
    if (contextWindowTokens) next['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'] = contextWindowTokens;
    if (maxRequestTokens) next['COPILOT_BYOK_MAX_REQUEST_TOKENS'] = maxRequestTokens;
    if (tokensPerMinute) next['COPILOT_BYOK_TOKENS_PER_MINUTE'] = tokensPerMinute;
    if (requestsPerMinute) next['COPILOT_BYOK_REQUESTS_PER_MINUTE'] = requestsPerMinute;
    if (dailyRequests) next['COPILOT_BYOK_DAILY_REQUESTS'] = dailyRequests;
    if (supportsReasoning) next['COPILOT_BYOK_SUPPORTS_REASONING'] = supportsReasoning;
    if (supportsVision) next['COPILOT_BYOK_SUPPORTS_VISION'] = supportsVision;
    if (apiKey) next['COPILOT_BYOK_API_KEY'] = apiKey;
    if (bearerToken) next['COPILOT_BYOK_BEARER_TOKEN'] = bearerToken;
    if (headersJson) next['COPILOT_BYOK_HEADERS_JSON'] = headersJson;
    return next;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, Record<string, unknown>>}
 */
export function readConfiguredByokProfilesFromEnv(env = process.env) {
    const raw = env['COPILOT_BYOK_PROFILES_JSON'];
    if (!raw || raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('[sdk/provider] COPILOT_BYOK_PROFILES_JSON must be an object keyed by profile name');
    }
    /** @type {Record<string, Record<string, unknown>>} */
    const profiles = {};
    for (const [name, value] of Object.entries(parsed)) {
        if (!name.trim()) continue;
        profiles[name.trim()] = asPlainObject(value);
    }
    return profiles;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Array<{ name: string; preset: string | null; providerType: string | null; baseUrl: string | null; model: string | null; ready: boolean; auth: { apiKeyConfigured: boolean; bearerTokenConfigured: boolean; headersConfigured: boolean }; metadataKeys: string[]; warnings: string[]; errors: string[] }>}
 */
export function readConfiguredByokProfileSummaries(env = process.env) {
    const profiles = readConfiguredByokProfilesFromEnv(env);
    return Object.entries(profiles).map(([name, profile]) => {
        const summaryEnv = { ...env, COPILOT_BYOK_ENABLED: 'true', COPILOT_BYOK_PROFILE: name };
        const profileEnv = applyProfileToEnv(profile, env);
        let preset = normalizePreset(profileEnv['COPILOT_BYOK_PROVIDER_PRESET']);
        let providerType = profileEnv['COPILOT_BYOK_PROVIDER_TYPE'] ?? null;
        let baseUrl = profileEnv['COPILOT_BYOK_BASE_URL'] ?? null;
        let model = profileEnv['COPILOT_BYOK_MODEL'] ?? null;
        let ready = false;
        /** @type {string[]} */
        let warnings = [];
        /** @type {string[]} */
        let errors = [];
        try {
            const state = readConfiguredByokState(summaryEnv);
            preset = state.summary.preset ?? preset;
            providerType = state.summary.providerType;
            baseUrl = state.summary.baseUrl;
            model = state.summary.model;
            ready = state.ready;
            warnings = [...state.summary.warnings];
            errors = [...state.summary.errors];
        } catch {
            // Profile list is diagnostic-only; full validation errors are reported by readConfiguredByokState().
        }
        return {
            name,
            preset,
            providerType,
            baseUrl,
            model,
            ready,
            auth: {
                apiKeyConfigured: Boolean(profileEnv['COPILOT_BYOK_API_KEY']),
                bearerTokenConfigured: Boolean(profileEnv['COPILOT_BYOK_BEARER_TOKEN']),
                headersConfigured: Boolean(profileEnv['COPILOT_BYOK_HEADERS_JSON']),
            },
            metadataKeys: Object.keys(asPlainObject(profile['metadata'])).sort(),
            warnings,
            errors,
        };
    });
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ env: Record<string, string | undefined>; profile: string | null; profileError: string | null }}
 */
function resolveProfileEnv(env) {
    const profileName = optionalString(env['COPILOT_BYOK_PROFILE']);
    if (!profileName) return { env, profile: null, profileError: null };
    try {
        const profiles = readConfiguredByokProfilesFromEnv(env);
        const profile = profiles[profileName];
        if (!profile) {
            return {
                env,
                profile: profileName,
                profileError: `COPILOT_BYOK_PROFILE '${profileName}' was not found in COPILOT_BYOK_PROFILES_JSON.`,
            };
        }
        const profileEnv = applyProfileToEnv(profile, env);
        const explicitOverrideKeys = [
            'COPILOT_BYOK_PROVIDER_PRESET',
            'COPILOT_BYOK_PROVIDER_TYPE',
            'COPILOT_BYOK_BASE_URL',
            'COPILOT_BYOK_WIRE_API',
            'COPILOT_BYOK_AZURE_API_VERSION',
            'COPILOT_BYOK_HEADERS_JSON',
            'COPILOT_BYOK_MODEL',
            'COPILOT_BYOK_MODELS',
            'COPILOT_BYOK_MODELS_JSON',
            'COPILOT_BYOK_MODELS_ENDPOINT',
            'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
            'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
            'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
            'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
            'COPILOT_BYOK_MAX_REQUEST_TOKENS',
            'COPILOT_BYOK_TOKENS_PER_MINUTE',
            'COPILOT_BYOK_REQUESTS_PER_MINUTE',
            'COPILOT_BYOK_DAILY_REQUESTS',
            'COPILOT_BYOK_SUPPORTS_REASONING',
            'COPILOT_BYOK_SUPPORTS_VISION',
            'COPILOT_BYOK_API_KEY',
            'COPILOT_BYOK_BEARER_TOKEN',
        ];
        for (const key of explicitOverrideKeys) {
            if (optionalString(env[key])) profileEnv[key] = env[key];
        }
        const explicitCatalogKeys = [
            'COPILOT_BYOK_MODELS',
            'COPILOT_BYOK_MODELS_JSON',
            'COPILOT_BYOK_MODELS_ENDPOINT',
        ];
        if (explicitCatalogKeys.some((key) => optionalString(env[key]))) {
            for (const key of explicitCatalogKeys) {
                if (!optionalString(env[key])) delete profileEnv[key];
            }
        }
        return { env: profileEnv, profile: profileName, profileError: null };
    } catch (error) {
        return { env, profile: profileName, profileError: errorMessage(error) };
    }
}

/**
 * @param {string | undefined} raw
 * @returns {'completions' | 'responses' | undefined}
 */
function normalizeWireApi(raw) {
    if (!raw || raw.trim() === '') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'completions' || normalized === 'responses') return normalized;
    throw new Error(`[sdk/provider] invalid COPILOT_BYOK_WIRE_API: '${raw}'`);
}

/**
 * @param {string | undefined} raw
 * @returns {ProviderType | undefined}
 */
function normalizeProviderType(raw) {
    if (!raw || raw.trim() === '') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (isValidProviderType(normalized)) return /** @type {ProviderType} */ (normalized);
    throw new Error(`[sdk/provider] invalid COPILOT_BYOK_PROVIDER_TYPE: '${raw}'`);
}

/**
 * @param {string | null | undefined} preset
 * @returns {string}
 */
function normalizePreset(preset) {
    const normalized = (preset ?? '').trim().toLowerCase();
    if (!normalized) return 'custom';
    return normalized.replace(/_/gu, '-');
}

/**
 * @param {string} preset
 * @returns {ByokProviderPresetDefinition | undefined}
 */
function getByokPresetDefinition(preset) {
    return BYOK_PROVIDER_PRESETS[preset];
}

/**
 * @param {ByokProviderPresetDefinition | undefined} definition
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
function resolvePresetBaseUrl(definition, env) {
    if (!definition?.baseUrl) return undefined;
    return typeof definition.baseUrl === 'function' ? definition.baseUrl(env) : definition.baseUrl;
}

/**
 * @param {readonly string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function normalizeOllamaBaseUrl(raw) {
    if (!raw || raw.trim() === '') return undefined;
    const trimmed = raw.trim().replace(/\/+$/u, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} preset
 * @returns {ProviderType}
 */
function inferProviderType(env, preset) {
    const explicit = normalizeProviderType(env['COPILOT_BYOK_PROVIDER_TYPE']);
    if (explicit) return explicit;
    const definition = getByokPresetDefinition(preset);
    if (definition?.providerType) return definition.providerType;
    if (preset === 'azure') return PROVIDER_TYPES.AZURE;
    if (preset === 'anthropic' || preset === 'claude') return PROVIDER_TYPES.ANTHROPIC;
    return PROVIDER_TYPES.OPENAI;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} preset
 * @param {ProviderType} providerType
 * @returns {string | undefined}
 */
function inferBaseUrl(env, preset, providerType) {
    const explicit = firstEnv(env, ['COPILOT_BYOK_BASE_URL']);
    if (explicit) return explicit;
    const definition = getByokPresetDefinition(preset);
    const presetBaseUrl = resolvePresetBaseUrl(definition, env);
    if (presetBaseUrl) return presetBaseUrl;
    if (preset === 'ollama-local') {
        return normalizeOllamaBaseUrl(firstEnv(env, ['OLLAMA_LOCAL_BASE_URL', 'OLLAMA_BASE_URL'])) ?? 'http://localhost:11434/v1';
    }
    if (preset === 'ollama-cloud') {
        return normalizeOllamaBaseUrl(firstEnv(env, ['OLLAMA_CLOUD_BASE_URL'])) ?? 'https://ollama.com/v1';
    }
    if (preset === 'kilo-code' || preset === 'kilo-gateway' || preset === 'kilo') {
        return firstEnv(env, ['KILO_GATEWAY_BASE_URL', 'KILO_BASE_URL']) ?? 'https://api.kilo.ai/api/gateway';
    }
    if (providerType === PROVIDER_TYPES.AZURE) return firstEnv(env, ['AZURE_OPENAI_ENDPOINT']);
    if (providerType === PROVIDER_TYPES.ANTHROPIC) return 'https://api.anthropic.com';
    if (preset === 'openai' || preset === 'openai-compatible') return 'https://api.openai.com/v1';
    return undefined;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} preset
 * @param {ProviderType} providerType
 * @returns {string | undefined}
 */
function inferModel(env, preset, providerType) {
    const explicit = firstEnv(env, ['COPILOT_BYOK_MODEL']);
    if (explicit) return explicit;
    const definition = getByokPresetDefinition(preset);
    const presetModel = firstEnv(env, [...(definition?.modelEnvKeys ?? [])]) ?? definition?.defaultModel;
    if (presetModel) return presetModel;
    if (preset.startsWith('ollama')) return firstEnv(env, ['OLLAMA_DEFAULT_MODEL', 'OLLAMA_CHAT_MODEL']);
    if (preset === 'kilo-code' || preset === 'kilo-gateway' || preset === 'kilo') {
        return firstEnv(env, ['KILO_MODEL', 'KILO_DEFAULT_MODEL']);
    }
    if (providerType === PROVIDER_TYPES.ANTHROPIC) return firstEnv(env, ['ANTHROPIC_MODEL', 'CLAUDE_MODEL']);
    if (providerType === PROVIDER_TYPES.AZURE) return firstEnv(env, ['AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_MODEL']);
    return firstEnv(env, ['OPENAI_MODEL']);
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} preset
 * @param {ProviderType} providerType
 * @returns {{ apiKey?: string; bearerToken?: string }}
 */
function inferAuth(env, preset, providerType) {
    const bearerToken = firstEnv(env, ['COPILOT_BYOK_BEARER_TOKEN']);
    if (bearerToken) return { bearerToken };
    const definition = getByokPresetDefinition(preset);
    const presetBearerToken = firstEnv(env, [...(definition?.bearerTokenEnvKeys ?? [])]);
    if (presetBearerToken) return { bearerToken: presetBearerToken };
    if (preset === 'kilo-code' || preset === 'kilo-gateway' || preset === 'kilo') {
        const kiloToken = firstEnv(env, ['KILO_API_KEY', 'KILO_CODE_API_KEY']);
        if (kiloToken) return { bearerToken: kiloToken };
    }
    const apiKey =
        firstEnv(env, ['COPILOT_BYOK_API_KEY']) ??
        firstEnv(env, [...(definition?.apiKeyEnvKeys ?? [])]) ??
        (preset === 'ollama-cloud' ? firstEnv(env, ['OLLAMA_API_KEY', 'OLLAMA_CLOUD_API_KEY']) : undefined) ??
        (providerType === PROVIDER_TYPES.AZURE ? firstEnv(env, ['AZURE_OPENAI_API_KEY']) : undefined) ??
        (providerType === PROVIDER_TYPES.ANTHROPIC
            ? firstEnv(env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'])
            : undefined) ??
        (providerType === PROVIDER_TYPES.OPENAI ? firstEnv(env, ['OPENAI_API_KEY']) : undefined);
    return apiKey ? { apiKey } : {};
}

/**
 * @param {string} message
 * @returns {string}
 */
function toSafeMessage(message) {
    return redactSecretText(message, {
        additionalSecrets: BYOK_SECRET_ENV_KEYS.map((key) => process.env[key]),
    });
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return toSafeMessage(error instanceof Error ? error.message : String(error));
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function modelIdFromUnknown(value) {
    if (typeof value === 'string') return value.trim() || undefined;
    if (!value || typeof value !== 'object') return undefined;
    const item = /** @type {Record<string, unknown>} */ (value);
    for (const key of ['id', 'name', 'model']) {
        const id = optionalString(item[key]);
        if (id) return id;
    }
    return undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positiveNumberFromUnknown(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const normalized = value.trim().replace(/,/gu, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function priceNumberFromUnknown(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number.parseFloat(value.trim().replace(/[$,]/gu, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArrayFromUnknown(value) {
    if (Array.isArray(value)) {
        return uniqueStrings(value.map((item) => (typeof item === 'string' ? item : String(item))));
    }
    if (typeof value === 'string') return parseCsv(value);
    return [];
}

/**
 * @param {Record<string, unknown>} item
 * @returns {number | undefined}
 */
function inferModelContextWindow(item) {
    const architecture = asPlainObject(item['architecture']);
    const caps = asPlainObject(item['capabilities']);
    const limits = asPlainObject(caps['limits']);
    const candidates = [
        item['context_length'],
        item['contextWindow'],
        item['context_window'],
        item['context_window_tokens'],
        item['max_context_length'],
        item['maxContextLength'],
        item['max_context_window_tokens'],
        limits['max_context_window_tokens'],
        architecture['context_length'],
    ];
    for (const candidate of candidates) {
        const value = positiveNumberFromUnknown(candidate);
        if (value) return value;
    }
    return undefined;
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} item
 * @param {{ contextWindowTokens: number; supportsReasoning: boolean; supportsVision: boolean; maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }} caps
 * @param {'static' | 'remote'} source
 * @returns {{
 *   source: 'static' | 'remote';
 *   provider: string | null;
 *   freeTier: boolean | null;
 *   pricing: { prompt: number | null; completion: number | null; request: number | null };
 *   inputModalities: string[];
 *   outputModalities: string[];
 *   supportedParameters: string[];
 *   contextWindowTokens: number;
 *   rateLimits: { maxRequestTokens: number | null; tokensPerMinute: number | null; requestsPerMinute: number | null; dailyRequests: number | null };
 *   supportsReasoning: boolean;
 *   supportsVision: boolean;
 * }}
 */
function buildByokModelMetadata(id, item, caps, source) {
    const architecture = asPlainObject(item['architecture']);
    const pricing = asPlainObject(item['pricing']);
    const provider =
        optionalString(item['provider']) ??
        optionalString(item['owned_by']) ??
        optionalString(item['ownedBy']) ??
        optionalString(item['provider_name']) ??
        null;
    const promptPrice =
        priceNumberFromUnknown(pricing['prompt']) ??
        priceNumberFromUnknown(pricing['input']) ??
        priceNumberFromUnknown(item['input_price']) ??
        null;
    const completionPrice =
        priceNumberFromUnknown(pricing['completion']) ??
        priceNumberFromUnknown(pricing['output']) ??
        priceNumberFromUnknown(item['output_price']) ??
        null;
    const requestPrice = priceNumberFromUnknown(pricing['request']) ?? priceNumberFromUnknown(item['request_price']) ?? null;
    const inputModalities = stringArrayFromUnknown(architecture['input_modalities'] ?? item['input_modalities']);
    const outputModalities = stringArrayFromUnknown(architecture['output_modalities'] ?? item['output_modalities']);
    const supportedParameters = stringArrayFromUnknown(item['supported_parameters'] ?? item['supportedParameters']);
    const lowercaseId = id.toLowerCase();
    const contextWindowTokens = inferModelContextWindow(item) ?? caps.contextWindowTokens;
    const rateLimits = {
        maxRequestTokens:
            positiveNumberFromUnknown(item['max_request_tokens']) ??
            positiveNumberFromUnknown(item['maxRequestTokens']) ??
            positiveNumberFromUnknown(item['max_input_tokens']) ??
            positiveNumberFromUnknown(item['maxInputTokens']) ??
            caps.maxRequestTokens ??
            null,
        tokensPerMinute:
            positiveNumberFromUnknown(item['tokens_per_minute']) ??
            positiveNumberFromUnknown(item['tokensPerMinute']) ??
            positiveNumberFromUnknown(item['tpm']) ??
            caps.tokensPerMinute ??
            null,
        requestsPerMinute:
            positiveNumberFromUnknown(item['requests_per_minute']) ??
            positiveNumberFromUnknown(item['requestsPerMinute']) ??
            positiveNumberFromUnknown(item['rpm']) ??
            caps.requestsPerMinute ??
            null,
        dailyRequests:
            positiveNumberFromUnknown(item['daily_requests']) ??
            positiveNumberFromUnknown(item['dailyRequests']) ??
            positiveNumberFromUnknown(item['requests_per_day']) ??
            positiveNumberFromUnknown(item['rpd']) ??
            caps.dailyRequests ??
            null,
    };
    const pricingKnown = promptPrice !== null || completionPrice !== null || requestPrice !== null;
    const allowProviderCapabilityFallback = source === 'static';
    const explicitFree =
        item['free'] === true ||
        item['is_free'] === true ||
        item['freeTier'] === true ||
        /(?:^|[:/_-])free(?:$|[:/_-])/u.test(lowercaseId);
    const zeroPriced = pricingKnown && (promptPrice ?? 0) === 0 && (completionPrice ?? 0) === 0 && (requestPrice ?? 0) === 0;
    const supportsReasoning =
        (allowProviderCapabilityFallback && caps.supportsReasoning) ||
        supportedParameters.some((param) => /reasoning|include_reasoning|reasoning_effort/u.test(param.toLowerCase())) ||
        /(?:reasoning|deepseek-r1|qwq|qwen3|gpt-oss|magistral|glm-[45]|glm-5|gemini-[23]|o[134])/u.test(lowercaseId);
    const supportsVision =
        (allowProviderCapabilityFallback && caps.supportsVision) ||
        inputModalities.some((modality) => /image|vision|video/u.test(modality.toLowerCase())) ||
        /(?:vision|vlm|vl-|vl\b|pixtral|llava|gemini|gpt-4o|llama-4-scout|internvl)/u.test(lowercaseId);
    return {
        source,
        provider,
        freeTier: explicitFree || zeroPriced ? true : pricingKnown ? false : null,
        pricing: { prompt: promptPrice, completion: completionPrice, request: requestPrice },
        inputModalities,
        outputModalities,
        supportedParameters,
        contextWindowTokens,
        rateLimits,
        supportsReasoning,
        supportsVision,
    };
}

/**
 * @param {ReturnType<typeof buildByokModelMetadata>} metadata
 * @returns {string}
 */
function renderByokModelTerms(metadata) {
    const tags = [];
    if (metadata.freeTier === true) tags.push('byok:free');
    else if (metadata.freeTier === false) tags.push('byok:paid-or-metered');
    else tags.push('byok:cost-unknown');
    if (metadata.provider) tags.push(`provider:${metadata.provider}`);
    if (metadata.pricing.prompt !== null || metadata.pricing.completion !== null) {
        tags.push(`price:${metadata.pricing.prompt ?? '?'}in/${metadata.pricing.completion ?? '?'}out`);
    }
    if (metadata.rateLimits.maxRequestTokens !== null) tags.push(`max-request:${metadata.rateLimits.maxRequestTokens}`);
    if (metadata.rateLimits.tokensPerMinute !== null) tags.push(`tpm:${metadata.rateLimits.tokensPerMinute}`);
    if (metadata.rateLimits.requestsPerMinute !== null) tags.push(`rpm:${metadata.rateLimits.requestsPerMinute}`);
    return tags.join(' ');
}

/**
 * O SDK/CLI do Copilot tambem usa `:` como separador em algumas rotas internas de opções de modelo. Em BYOK,
 * providers como OpenRouter/HuggingFace/Ollama usam `:` como parte legitima do ID (`:free`, `:fastest`,
 * `:80b-cloud`). Nesses casos o modelo pode ser capaz de "raciocinar", mas o parametro SDK `reasoningEffort`
 * não é um canal seguro para configurar esse raciocinio, pois pode ser reinterpretado como chave de opção.
 *
 * @param {string | null | undefined} model
 * @returns {boolean}
 */
function supportsSdkReasoningEffortForByokModel(model) {
    return typeof model === 'string' && model.length > 0 && !model.includes(':');
}

/**
 * @param {string | Record<string, unknown>} item
 * @param {{ contextWindowTokens: number; supportsReasoning: boolean; supportsVision: boolean; maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }} caps
 * @param {'static' | 'remote'} [source]
 * @returns {import('../types.js').ModelInfo}
 */
function createByokModelInfo(item, caps, source = 'static') {
    const id = typeof item === 'string' ? item : modelIdFromUnknown(item);
    if (!id) throw new Error('[sdk/provider] BYOK model id is required');
    const objectItem = typeof item === 'string' ? { id } : item;
    const metadata = buildByokModelMetadata(id, objectItem, caps, source);
    const supportsSdkReasoningEffort = metadata.supportsReasoning && supportsSdkReasoningEffortForByokModel(id);
    const info = {
        id,
        name: optionalString(objectItem['name']) ?? id,
        capabilities: {
            supports: { vision: metadata.supportsVision, reasoningEffort: supportsSdkReasoningEffort },
            limits: { max_context_window_tokens: metadata.contextWindowTokens },
        },
        policy: { state: 'enabled', terms: renderByokModelTerms(metadata) },
        billing: { multiplier: 0 },
    };
    return /** @type {import('../types.js').ModelInfo} */ (Object.assign(info, { byok: metadata }));
}

/**
 * @param {unknown} payload
 * @param {{ contextWindowTokens: number; supportsReasoning: boolean; supportsVision: boolean; maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }} caps
 * @returns {import('../types.js').ModelInfo[]}
 */
function normalizeDiscoveredModels(payload, caps) {
    const root = asPlainObject(payload);
    const rawItems = Array.isArray(payload)
        ? payload
        : Array.isArray(root['data'])
          ? root['data']
          : Array.isArray(root['models'])
            ? root['models']
            : [];
    const seen = new Set();
    /** @type {import('../types.js').ModelInfo[]} */
    const models = [];
    for (const item of rawItems) {
        const id = modelIdFromUnknown(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push(createByokModelInfo(typeof item === 'object' && item !== null ? /** @type {Record<string, unknown>} */ (item) : id, caps, 'remote'));
    }
    return models;
}

/**
 * @param {ProviderConfig} provider
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function resolveByokModelsEndpoint(provider, env) {
    const explicit = firstEnv(env, ['COPILOT_BYOK_MODELS_ENDPOINT']);
    if (explicit) {
        try {
            return new URL(explicit).toString();
        } catch {
            const path = explicit.startsWith('/') ? explicit.slice(1) : explicit;
            return new URL(path, `${provider.baseUrl.replace(/\/+$/u, '')}/`).toString();
        }
    }
    const preset = normalizePreset(env['COPILOT_BYOK_PROVIDER_PRESET']);
    const definition = getByokPresetDefinition(preset);
    if (definition?.modelsEndpoint) return definition.modelsEndpoint;
    return new URL('models', `${provider.baseUrl.replace(/\/+$/u, '')}/`).toString();
}

/**
 * @param {ProviderConfig} provider
 * @returns {Record<string, string>}
 */
function createByokModelDiscoveryHeaders(provider) {
    const headers = { ...(provider.headers ?? {}) };
    if (provider.bearerToken && headers['Authorization'] === undefined && headers['authorization'] === undefined) {
        headers['Authorization'] = `Bearer ${provider.bearerToken}`;
    } else if (provider.apiKey) {
        if (provider.type === PROVIDER_TYPES.AZURE && headers['api-key'] === undefined && headers['Api-Key'] === undefined) {
            headers['api-key'] = provider.apiKey;
        } else if (
            provider.baseUrl.includes('generativelanguage.googleapis.com') &&
            headers['x-goog-api-key'] === undefined &&
            headers['X-Goog-Api-Key'] === undefined
        ) {
            headers['Authorization'] = `Bearer ${provider.apiKey}`;
            headers['x-goog-api-key'] = provider.apiKey;
        } else if (headers['Authorization'] === undefined && headers['authorization'] === undefined) {
            headers['Authorization'] = `Bearer ${provider.apiKey}`;
        }
    }
    return headers;
}

/**
 * @param {string} endpoint
 * @param {ProviderConfig} provider
 * @returns {string}
 */
function byokDiscoveryCacheKey(endpoint, provider) {
    const headerKeys = Object.keys(provider.headers ?? {}).sort().join(',');
    const authMode = provider.bearerToken ? 'bearer' : provider.apiKey ? 'apiKey' : 'none';
    return `${provider.type ?? PROVIDER_TYPES.OPENAI}|${endpoint}|${authMode}|${headerKeys}`;
}

/**
 * A sessão BYOK ainda precisa nascer com um `model` explícito. Quando o catálogo remoto é fresco, o cockpit deve
 * saber se esse seletor continua existindo no provider sem substituir silenciosamente a escolha do operador.
 *
 * @param {string | null} model
 * @param {import('../types.js').ModelInfo[]} models
 * @param {boolean} authoritative
 * @returns {{ id: string | null; inCatalog: boolean | null; authoritative: boolean }}
 */
function summarizeConfiguredByokModelCatalog(model, models, authoritative) {
    if (!model) return { id: null, inCatalog: null, authoritative };
    if (!authoritative) return { id: model, inCatalog: null, authoritative };
    return {
        id: model,
        inCatalog: models.some((candidate) => candidate.id === model),
        authoritative,
    };
}

/**
 * @param {ProviderConfig | null} provider
 * @returns {ProviderConfig | null}
 */
export function redactProviderConfig(provider) {
    if (!provider) return null;
    return /** @type {ProviderConfig} */ (redactSecretRecord(/** @type {Record<string, unknown>} */ (provider)));
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {ConfiguredByokState}
 */
export function readConfiguredByokState(env = process.env) {
    const resolved = resolveProfileEnv(env);
    const effectiveEnv = resolved.env;
    const preset = normalizePreset(effectiveEnv['COPILOT_BYOK_PROVIDER_PRESET']);
    const explicitEnabled = parseBoolean(effectiveEnv['COPILOT_BYOK_ENABLED']);
    const hasIntent = Boolean(
        effectiveEnv['COPILOT_BYOK_PROVIDER_PRESET'] ||
            effectiveEnv['COPILOT_BYOK_PROVIDER_TYPE'] ||
            effectiveEnv['COPILOT_BYOK_BASE_URL'] ||
            effectiveEnv['COPILOT_BYOK_MODEL'] ||
            effectiveEnv['COPILOT_BYOK_PROFILE'],
    );
    const enabled = explicitEnabled ?? hasIntent;
    const warnings = [];
    const errors = [];
    if (resolved.profileError) errors.push(resolved.profileError);
    const presetDefinition = getByokPresetDefinition(preset);
    const contextWindowTokens = parsePositiveInteger(
        effectiveEnv['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'],
        presetDefinition?.contextWindowTokens ?? 128_000,
    );
    const supportsReasoning =
        parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_REASONING']) ?? presetDefinition?.supportsReasoning ?? false;
    const supportsVision = parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_VISION']) ?? presetDefinition?.supportsVision ?? false;
    const limits = {
        maxRequestTokens: parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_MAX_REQUEST_TOKENS']),
        tokensPerMinute: parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_TOKENS_PER_MINUTE']),
        requestsPerMinute: parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_REQUESTS_PER_MINUTE']),
        dailyRequests: parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_DAILY_REQUESTS']),
    };

    /** @type {ByokSummary} */
    const disabledSummary = {
        enabled: false,
        ready: false,
        profile: null,
        preset: null,
        providerType: null,
        baseUrl: null,
        model: null,
        wireApi: null,
        azureApiVersion: null,
        auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
        modelList: { configured: false, count: 0 },
        capabilities: {
            reasoningEffort: supportsReasoning,
            sdkReasoningEffort: false,
            vision: supportsVision,
            contextWindowTokens,
        },
        limits,
        warnings: [],
        errors: [],
    };
    if (!enabled) {
        return { enabled: false, ready: false, provider: null, model: null, modelCapabilities: undefined, summary: disabledSummary, warnings: [], errors: [] };
    }

    /** @type {ProviderType | null} */
    let providerType = null;
    /** @type {ProviderConfig | null} */
    let provider = null;
    let baseUrl = null;
    let model = null;
    let wireApi = null;
    let azureApiVersion = null;
    let headersConfigured = false;
    let apiKeyConfigured = false;
    let bearerTokenConfigured = false;

    try {
        providerType = inferProviderType(effectiveEnv, preset);
        baseUrl = inferBaseUrl(effectiveEnv, preset, providerType) ?? null;
        model = inferModel(effectiveEnv, preset, providerType) ?? null;
        wireApi = normalizeWireApi(effectiveEnv['COPILOT_BYOK_WIRE_API']) ?? null;
        azureApiVersion =
            firstEnv(effectiveEnv, ['COPILOT_BYOK_AZURE_API_VERSION']) ??
            (providerType === PROVIDER_TYPES.AZURE ? '2024-10-21' : null);
        const headers = parseHeaders(effectiveEnv['COPILOT_BYOK_HEADERS_JSON']);
        headersConfigured = headers !== undefined;
        const auth = inferAuth(effectiveEnv, preset, providerType);
        apiKeyConfigured = auth.apiKey !== undefined;
        bearerTokenConfigured = auth.bearerToken !== undefined;
        if (!baseUrl) errors.push('COPILOT_BYOK_BASE_URL is required for the selected BYOK provider.');
        if (!model || model === 'auto') {
            errors.push('COPILOT_BYOK_MODEL must be an explicit provider model id; BYOK cannot use model=auto.');
        }
        if (presetDefinition?.requiresAuth && !apiKeyConfigured && !bearerTokenConfigured && !headersConfigured) {
            const acceptedKeys = uniqueStrings([
                'COPILOT_BYOK_API_KEY',
                'COPILOT_BYOK_BEARER_TOKEN',
                ...(presetDefinition.apiKeyEnvKeys ?? []),
                ...(presetDefinition.bearerTokenEnvKeys ?? []),
            ]);
            warnings.push(`${preset} BYOK is configured without an auth secret. Accepted env keys: ${acceptedKeys.join(', ')}.`);
        }
        if (baseUrl) {
            provider = validateConfig({
                type: providerType,
                baseUrl,
                ...(wireApi !== null ? { wireApi } : {}),
                ...(auth.apiKey !== undefined ? { apiKey: auth.apiKey } : {}),
                ...(auth.bearerToken !== undefined ? { bearerToken: auth.bearerToken } : {}),
                ...(providerType === PROVIDER_TYPES.AZURE && azureApiVersion
                    ? { azure: { apiVersion: azureApiVersion } }
                    : {}),
                ...(headers !== undefined || presetDefinition?.headers !== undefined
                    ? { headers: { ...(presetDefinition?.headers ?? {}), ...(headers ?? {}) } }
                    : {}),
            });
            baseUrl = provider.baseUrl;
        }
    } catch (error) {
        errors.push(errorMessage(error));
    }

    const models = readConfiguredByokModelsFromEnv(effectiveEnv, {
        model,
        contextWindowTokens,
        supportsReasoning,
        supportsVision,
        ...limits,
    });
    const sdkReasoningEffort = supportsReasoning && supportsSdkReasoningEffortForByokModel(model);
    if (supportsReasoning && model && !sdkReasoningEffort) {
        warnings.push(
            `reasoning do modelo BYOK detectado, mas reasoningEffort do SDK sera omitido para '${model}' porque o ID contem ':' e deve ser preservado literalmente pelo provider.`,
        );
    }
    /** @type {ByokSummary} */
    const summary = {
        enabled: true,
        ready: errors.length === 0 && provider !== null && model !== null && model !== 'auto',
        profile: resolved.profile,
        preset,
        providerType,
        baseUrl,
        model,
        wireApi,
        azureApiVersion,
        auth: { apiKeyConfigured, bearerTokenConfigured, headersConfigured },
        modelList: { configured: models.length > 0, count: models.length },
        capabilities: { reasoningEffort: supportsReasoning, sdkReasoningEffort, vision: supportsVision, contextWindowTokens },
        limits,
        warnings,
        errors,
    };
    return {
        enabled: true,
        ready: summary.ready,
        provider,
        model,
        modelCapabilities: {
            supports: { reasoningEffort: sdkReasoningEffort, vision: supportsVision },
            limits: { max_context_window_tokens: contextWindowTokens },
        },
        summary,
        warnings,
        errors,
    };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {ByokSummary}
 */
export function readConfiguredByokSummary(env = process.env) {
    return readConfiguredByokState(env).summary;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {object} [fallback]
 * @param {string | null} [fallback.model]
 * @param {number} [fallback.contextWindowTokens]
 * @param {boolean} [fallback.supportsReasoning]
 * @param {boolean} [fallback.supportsVision]
 * @param {number | null} [fallback.maxRequestTokens]
 * @param {number | null} [fallback.tokensPerMinute]
 * @param {number | null} [fallback.requestsPerMinute]
 * @param {number | null} [fallback.dailyRequests]
 * @returns {import('../types.js').ModelInfo[]}
 */
export function readConfiguredByokModelsFromEnv(env = process.env, fallback = {}) {
    const effectiveEnv = resolveProfileEnv(env).env;
    const preset = normalizePreset(effectiveEnv['COPILOT_BYOK_PROVIDER_PRESET']);
    const presetDefinition = getByokPresetDefinition(preset);
    const contextWindowTokens =
        fallback.contextWindowTokens ??
        parsePositiveInteger(effectiveEnv['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'], presetDefinition?.contextWindowTokens ?? 128_000);
    const supportsReasoning =
        fallback.supportsReasoning ??
        (parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_REASONING']) ?? presetDefinition?.supportsReasoning ?? false);
    const supportsVision =
        fallback.supportsVision ?? (parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_VISION']) ?? presetDefinition?.supportsVision ?? false);
    const rateLimits = {
        maxRequestTokens: fallback.maxRequestTokens ?? parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_MAX_REQUEST_TOKENS']),
        tokensPerMinute: fallback.tokensPerMinute ?? parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_TOKENS_PER_MINUTE']),
        requestsPerMinute: fallback.requestsPerMinute ?? parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_REQUESTS_PER_MINUTE']),
        dailyRequests: fallback.dailyRequests ?? parseOptionalPositiveInteger(effectiveEnv['COPILOT_BYOK_DAILY_REQUESTS']),
    };

    /** @type {Array<string | Record<string, unknown>>} */
    let items = [];
    const json = effectiveEnv['COPILOT_BYOK_MODELS_JSON'];
    if (json && json.trim()) {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) throw new Error('[sdk/provider] COPILOT_BYOK_MODELS_JSON must be an array');
        items = parsed
            .map((item) => {
                if (typeof item === 'string' && item.trim()) return item.trim();
                if (item && typeof item === 'object' && !Array.isArray(item) && modelIdFromUnknown(item)) {
                    return /** @type {Record<string, unknown>} */ (item);
                }
                return null;
            })
            .filter((item) => item !== null);
    }
    if (items.length === 0) items = parseCsv(effectiveEnv['COPILOT_BYOK_MODELS']);
    if (items.length === 0 && presetDefinition?.staticModels?.length) items = [...presetDefinition.staticModels];
    if (items.length === 0 && fallback.model) items = [fallback.model];

    return uniqueStrings(items.map((item) => (typeof item === 'string' ? item : modelIdFromUnknown(item) ?? '')))
        .map((id) => {
            const objectItem = items.find((item) => typeof item !== 'string' && modelIdFromUnknown(item) === id);
            return createByokModelInfo(
                objectItem && typeof objectItem !== 'string' ? objectItem : id,
                { contextWindowTokens, supportsReasoning, supportsVision, ...rateLimits },
                'static',
            );
        });
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<ByokModelDiscoveryResult>}
 */
export async function discoverConfiguredByokModelsFromEnv(env = process.env, options = {}) {
    const state = readConfiguredByokState(env);
    const staticModels = readConfiguredByokModelsFromEnv(env, {
        model: state.model,
        contextWindowTokens: state.summary.capabilities.contextWindowTokens,
        supportsReasoning: state.summary.capabilities.reasoningEffort,
        supportsVision: state.summary.capabilities.vision,
        ...state.summary.limits,
    });
    if (!state.enabled || !state.ready || !state.provider) {
        return {
            models: staticModels,
            source: 'static',
            endpoint: null,
            fromCache: false,
            error: null,
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, staticModels, false),
        };
    }

    const effectiveEnv = resolveProfileEnv(env).env;
    const discoveryEnabled = parseBoolean(effectiveEnv['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED']) ?? true;
    if (!discoveryEnabled) {
        return {
            models: staticModels,
            source: 'static',
            endpoint: null,
            fromCache: false,
            error: null,
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, staticModels, false),
        };
    }
    if (state.provider.type !== PROVIDER_TYPES.OPENAI) {
        return {
            models: staticModels,
            source: 'static',
            endpoint: null,
            fromCache: false,
            error: null,
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, staticModels, false),
        };
    }

    const endpoint = resolveByokModelsEndpoint(state.provider, effectiveEnv);
    const ttlMs = parsePositiveInteger(effectiveEnv['COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS'], 300_000);
    const timeoutMs = parsePositiveInteger(effectiveEnv['COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS'], 7_000);
    const cacheKey = byokDiscoveryCacheKey(endpoint, state.provider);
    const now = Date.now();
    const cached = BYOK_MODEL_DISCOVERY_CACHE.get(cacheKey);
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return {
            models: cached.models,
            source: 'remote-cache',
            endpoint,
            fromCache: true,
            error: null,
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, cached.models, true),
        };
    }

    try {
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: createByokModelDiscoveryHeaders(state.provider),
            signal,
        });
        if (!response.ok) {
            throw new Error(`model discovery failed: HTTP ${response.status}`);
        }
        const payload = await readBoundedResponseJson(response, {
            maxBytes: BYOK_MODEL_DISCOVERY_MAX_RESPONSE_BYTES,
            label: 'BYOK model discovery',
        });
        const models = normalizeDiscoveredModels(payload, {
            contextWindowTokens: state.summary.capabilities.contextWindowTokens,
            supportsReasoning: state.summary.capabilities.reasoningEffort,
            supportsVision: state.summary.capabilities.vision,
            ...state.summary.limits,
        });
        if (models.length === 0) {
            throw new Error('model discovery returned no usable model ids');
        }
        BYOK_MODEL_DISCOVERY_CACHE.set(cacheKey, { expiresAt: now + ttlMs, models });
        return {
            models,
            source: 'remote',
            endpoint,
            fromCache: false,
            error: null,
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, models, true),
        };
    } catch (error) {
        return {
            models: staticModels,
            source: 'static-fallback',
            endpoint,
            fromCache: false,
            error: errorMessage(error),
            configuredModel: summarizeConfiguredByokModelCatalog(state.model, staticModels, false),
        };
    }
}

/**
 * Retorna apenas o cache vivo de descoberta remota do profile BYOK atual. A função é deliberadamente síncrona e não faz
 * fetch: cockpits como `/byok status` podem usar metadados remotos já observados sem transformar status em operação de
 * rede nem sobrepor o banco canônico com uma prova runtime.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {ByokModelDiscoveryCacheResult | null}
 */
export function readConfiguredByokModelDiscoveryCacheFromEnv(env = process.env) {
    const state = readConfiguredByokState(env);
    if (!state.enabled || !state.ready || !state.provider || !state.model) return null;
    if (state.provider.type !== PROVIDER_TYPES.OPENAI) return null;
    const effectiveEnv = resolveProfileEnv(env).env;
    const discoveryEnabled = parseBoolean(effectiveEnv['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED']) ?? true;
    if (!discoveryEnabled) return null;
    const endpoint = resolveByokModelsEndpoint(state.provider, effectiveEnv);
    const cacheKey = byokDiscoveryCacheKey(endpoint, state.provider);
    const cached = BYOK_MODEL_DISCOVERY_CACHE.get(cacheKey);
    if (!cached) return null;
    const now = Date.now();
    if (cached.expiresAt <= now) return null;
    return {
        models: cached.models,
        source: 'remote-cache',
        endpoint,
        fromCache: true,
        error: null,
        configuredModel: summarizeConfiguredByokModelCatalog(state.model, cached.models, true),
        expiresAt: cached.expiresAt,
        ttlMs: Math.max(0, cached.expiresAt - now),
    };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {(() => Promise<import('../types.js').ModelInfo[]>) | undefined}
 */
export function buildConfiguredByokModelListHandler(env = process.env) {
    const state = readConfiguredByokState(env);
    if (!state.enabled) return undefined;
    return async () => (await discoverConfiguredByokModelsFromEnv(env)).models;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [requestedModel]
 * @returns {{
 *     enabled: boolean;
 *     ready: boolean;
 *     provider?: ProviderConfig;
 *     model?: string;
 *     modelCapabilities?: ConfiguredByokState['modelCapabilities'];
 *     supportsReasoning?: boolean;
 *     summary: ByokSummary;
 * }}
 */
export function resolveConfiguredByokSessionOverrides(env = process.env, requestedModel = undefined) {
    const state = readConfiguredByokState(env);
    if (!state.enabled) return { enabled: false, ready: false, summary: state.summary };
    if (!state.ready || !state.provider || !state.model) {
        throw new Error(`[sdk/provider] BYOK is enabled but not ready: ${state.errors.join('; ') || 'invalid configuration'}`);
    }
    const model = requestedModel && requestedModel !== 'auto' ? requestedModel : state.model;
    const sdkReasoningEffort =
        state.summary.capabilities.reasoningEffort && supportsSdkReasoningEffortForByokModel(model);
    return {
        enabled: true,
        ready: true,
        provider: state.provider,
        model,
        modelCapabilities: state.modelCapabilities
            ? {
                  ...state.modelCapabilities,
                  supports: {
                      ...(state.modelCapabilities.supports ?? {}),
                      reasoningEffort: sdkReasoningEffort,
                  },
              }
            : undefined,
        supportsReasoning: sdkReasoningEffort,
        summary: {
            ...state.summary,
            model,
            capabilities: { ...state.summary.capabilities, sdkReasoningEffort },
        },
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
