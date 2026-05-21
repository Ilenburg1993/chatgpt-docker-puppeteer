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
 * @property {{ reasoningEffort: boolean; vision: boolean; contextWindowTokens: number }} capabilities
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
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
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
]);

/** @type {readonly string[]} */
export const BYOK_SECRET_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY',
    'KILO_API_KEY',
    'KILO_CODE_API_KEY',
]);

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
    const modelsJson = profile['modelsJson'] ?? profile['modelsJSON'] ?? profile['COPILOT_BYOK_MODELS_JSON'];
    const contextWindowTokens = optionalNumberString(
        profile['contextWindowTokens'] ?? profile['contextWindow'] ?? profile['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'],
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
    if (Array.isArray(modelsJson) || (modelsJson && typeof modelsJson === 'object')) {
        next['COPILOT_BYOK_MODELS_JSON'] = JSON.stringify(modelsJson);
    } else if (typeof modelsJson === 'string' && modelsJson.trim()) {
        next['COPILOT_BYOK_MODELS_JSON'] = modelsJson.trim();
    }
    if (contextWindowTokens) next['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'] = contextWindowTokens;
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
 * @returns {Array<{ name: string; preset: string | null; providerType: string | null; baseUrl: string | null; model: string | null; auth: { apiKeyConfigured: boolean; bearerTokenConfigured: boolean; headersConfigured: boolean }; metadataKeys: string[] }>}
 */
export function readConfiguredByokProfileSummaries(env = process.env) {
    const profiles = readConfiguredByokProfilesFromEnv(env);
    return Object.entries(profiles).map(([name, profile]) => {
        const profileEnv = applyProfileToEnv(profile, env);
        const preset = normalizePreset(profileEnv['COPILOT_BYOK_PROVIDER_PRESET']);
        let providerType = profileEnv['COPILOT_BYOK_PROVIDER_TYPE'] ?? null;
        let baseUrl = profileEnv['COPILOT_BYOK_BASE_URL'] ?? null;
        let model = profileEnv['COPILOT_BYOK_MODEL'] ?? null;
        try {
            const inferredProviderType = inferProviderType(profileEnv, preset);
            providerType = inferredProviderType;
            baseUrl = inferBaseUrl(profileEnv, preset, inferredProviderType) ?? baseUrl;
            model = inferModel(profileEnv, preset, inferredProviderType) ?? model;
        } catch {
            // Profile list is diagnostic-only; full validation errors are reported by readConfiguredByokState().
        }
        return {
            name,
            preset,
            providerType,
            baseUrl,
            model,
            auth: {
                apiKeyConfigured: Boolean(profileEnv['COPILOT_BYOK_API_KEY']),
                bearerTokenConfigured: Boolean(profileEnv['COPILOT_BYOK_BEARER_TOKEN']),
                headersConfigured: Boolean(profileEnv['COPILOT_BYOK_HEADERS_JSON']),
            },
            metadataKeys: Object.keys(asPlainObject(profile['metadata'])).sort(),
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
        return { env: applyProfileToEnv(profile, env), profile: profileName, profileError: null };
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
    if (preset === 'kilo-code' || preset === 'kilo-gateway' || preset === 'kilo') {
        const kiloToken = firstEnv(env, ['KILO_API_KEY', 'KILO_CODE_API_KEY']);
        if (kiloToken) return { bearerToken: kiloToken };
    }
    const apiKey =
        firstEnv(env, ['COPILOT_BYOK_API_KEY']) ??
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
    let safe = message;
    for (const key of BYOK_SECRET_ENV_KEYS) {
        const value = process.env[key];
        if (typeof value === 'string' && value.length > 0) {
            safe = safe.split(value).join('[redacted]');
        }
    }
    return safe;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return toSafeMessage(error instanceof Error ? error.message : String(error));
}

/**
 * @param {ProviderConfig | null} provider
 * @returns {ProviderConfig | null}
 */
export function redactProviderConfig(provider) {
    if (!provider) return null;
    return {
        ...provider,
        ...(provider.apiKey !== undefined ? { apiKey: '[redacted]' } : {}),
        ...(provider.bearerToken !== undefined ? { bearerToken: '[redacted]' } : {}),
        ...(provider.headers !== undefined ? { headers: Object.fromEntries(Object.keys(provider.headers).map((key) => [key, '[redacted]'])) } : {}),
    };
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
    const contextWindowTokens = parsePositiveInteger(effectiveEnv['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'], 128_000);
    const supportsReasoning = parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_REASONING']) ?? false;
    const supportsVision = parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_VISION']) ?? false;

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
        capabilities: { reasoningEffort: supportsReasoning, vision: supportsVision, contextWindowTokens },
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
        if (preset === 'ollama-cloud' && !apiKeyConfigured && !bearerTokenConfigured) {
            warnings.push('Ollama Cloud BYOK is configured without OLLAMA_API_KEY, OLLAMA_CLOUD_API_KEY, COPILOT_BYOK_API_KEY, or COPILOT_BYOK_BEARER_TOKEN.');
        }
        if ((preset === 'kilo-code' || preset === 'kilo-gateway' || preset === 'kilo') && !bearerTokenConfigured) {
            warnings.push('Kilo Gateway BYOK is configured without KILO_API_KEY, KILO_CODE_API_KEY, or COPILOT_BYOK_BEARER_TOKEN.');
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
                ...(headers !== undefined ? { headers } : {}),
            });
            baseUrl = provider.baseUrl;
        }
    } catch (error) {
        errors.push(errorMessage(error));
    }

    const models = readConfiguredByokModelsFromEnv(effectiveEnv, { model, contextWindowTokens, supportsReasoning, supportsVision });
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
        capabilities: { reasoningEffort: supportsReasoning, vision: supportsVision, contextWindowTokens },
        warnings,
        errors,
    };
    return {
        enabled: true,
        ready: summary.ready,
        provider,
        model,
        modelCapabilities: {
            supports: { reasoningEffort: supportsReasoning, vision: supportsVision },
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
 * @returns {import('../types.js').ModelInfo[]}
 */
export function readConfiguredByokModelsFromEnv(env = process.env, fallback = {}) {
    const effectiveEnv = resolveProfileEnv(env).env;
    const contextWindowTokens =
        fallback.contextWindowTokens ?? parsePositiveInteger(effectiveEnv['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'], 128_000);
    const supportsReasoning =
        fallback.supportsReasoning ?? (parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_REASONING']) ?? false);
    const supportsVision =
        fallback.supportsVision ?? (parseBoolean(effectiveEnv['COPILOT_BYOK_SUPPORTS_VISION']) ?? false);

    /** @type {string[]} */
    let ids = [];
    const json = effectiveEnv['COPILOT_BYOK_MODELS_JSON'];
    if (json && json.trim()) {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) throw new Error('[sdk/provider] COPILOT_BYOK_MODELS_JSON must be an array');
        ids = parsed
            .map((item) => (typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : ''))
            .filter(Boolean);
    }
    ids = ids.length > 0 ? ids : parseCsv(effectiveEnv['COPILOT_BYOK_MODELS']);
    if (ids.length === 0 && fallback.model) ids = [fallback.model];

    return ids.map((id) => ({
        id,
        name: id,
        capabilities: {
            supports: { vision: supportsVision, reasoningEffort: supportsReasoning },
            limits: { max_context_window_tokens: contextWindowTokens },
        },
        policy: { state: 'enabled', terms: '' },
        billing: { multiplier: 0 },
    }));
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {(() => import('../types.js').ModelInfo[]) | undefined}
 */
export function buildConfiguredByokModelListHandler(env = process.env) {
    const state = readConfiguredByokState(env);
    if (!state.enabled) return undefined;
    return () =>
        readConfiguredByokModelsFromEnv(env, {
            model: state.model,
            contextWindowTokens: state.summary.capabilities.contextWindowTokens,
            supportsReasoning: state.summary.capabilities.reasoningEffort,
            supportsVision: state.summary.capabilities.vision,
        });
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
    return {
        enabled: true,
        ready: true,
        provider: state.provider,
        model,
        modelCapabilities: state.modelCapabilities,
        supportsReasoning: state.summary.capabilities.reasoningEffort,
        summary: { ...state.summary, model },
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
