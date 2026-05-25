// @ts-check
/**
 * OpenCode Zen catalog importer.
 *
 * OpenCode Zen publishes an OpenAI-shaped `/models` list, but runtime endpoints differ by model family
 * (`responses`, Anthropic `messages`, Google `models/{model}`, or OpenAI-compatible `chat/completions`). This importer
 * keeps those routing facts as catalog metadata while account/runtime access remains a later probe.
 *
 * @module copilot/model-gateway/catalog/importers/opencode-zen-models-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
} from '../contracts.js';
import {
    normalizeAccountOverlayControls,
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeUsdPricing,
} from '../normalizers.js';

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const OPENCODE_ZEN_MODELS_URL = `${OPENCODE_ZEN_BASE_URL}/models`;
export const OPENCODE_ZEN_RESPONSES_URL = `${OPENCODE_ZEN_BASE_URL}/responses`;
export const OPENCODE_ZEN_MESSAGES_URL = `${OPENCODE_ZEN_BASE_URL}/messages`;
export const OPENCODE_ZEN_CHAT_COMPLETIONS_URL = `${OPENCODE_ZEN_BASE_URL}/chat/completions`;

/**
 * @typedef {Readonly<{
 *     free?: true;
 *     inputUsdPerMillion?: number;
 *     outputUsdPerMillion?: number;
 *     cacheReadUsdPerMillion?: number;
 *     cacheWriteUsdPerMillion?: number;
 *     priceTierNote?: string;
 * }>} OpenCodePricingSeed
 */

/** @type {Readonly<Record<string, OpenCodePricingSeed>>} */
const OPENCODE_PRICING_SEED = Object.freeze({
    'big-pickle': Object.freeze({ free: true }),
    'deepseek-v4-flash-free': Object.freeze({ free: true }),
    'nemotron-3-super-free': Object.freeze({ free: true }),
    'qwen3.6-plus-free': Object.freeze({ free: true }),
    'minimax-m2.5-free': Object.freeze({ free: true }),
    'minimax-m2.7': Object.freeze({ inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, cacheReadUsdPerMillion: 0.06, cacheWriteUsdPerMillion: 0.375 }),
    'minimax-m2.5': Object.freeze({ inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, cacheReadUsdPerMillion: 0.06, cacheWriteUsdPerMillion: 0.375 }),
    'glm-5.1': Object.freeze({ inputUsdPerMillion: 1.4, outputUsdPerMillion: 4.4, cacheReadUsdPerMillion: 0.26 }),
    'glm-5': Object.freeze({ inputUsdPerMillion: 1, outputUsdPerMillion: 3.2, cacheReadUsdPerMillion: 0.2 }),
    'kimi-k2.5': Object.freeze({ inputUsdPerMillion: 0.6, outputUsdPerMillion: 3, cacheReadUsdPerMillion: 0.1 }),
    'kimi-k2.6': Object.freeze({ inputUsdPerMillion: 0.95, outputUsdPerMillion: 4, cacheReadUsdPerMillion: 0.16 }),
    'qwen3.6-plus': Object.freeze({ inputUsdPerMillion: 0.5, outputUsdPerMillion: 3, cacheReadUsdPerMillion: 0.05, cacheWriteUsdPerMillion: 0.625 }),
    'qwen3.5-plus': Object.freeze({ inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, cacheReadUsdPerMillion: 0.02, cacheWriteUsdPerMillion: 0.25 }),
    'grok-build-0.1': Object.freeze({ inputUsdPerMillion: 1, outputUsdPerMillion: 2, cacheReadUsdPerMillion: 0.2 }),
    'claude-opus-4-7': Object.freeze({ inputUsdPerMillion: 5, outputUsdPerMillion: 25, cacheReadUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 6.25 }),
    'claude-opus-4-6': Object.freeze({ inputUsdPerMillion: 5, outputUsdPerMillion: 25, cacheReadUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 6.25 }),
    'claude-opus-4-5': Object.freeze({ inputUsdPerMillion: 5, outputUsdPerMillion: 25, cacheReadUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 6.25 }),
    'claude-opus-4-1': Object.freeze({ inputUsdPerMillion: 15, outputUsdPerMillion: 75, cacheReadUsdPerMillion: 1.5, cacheWriteUsdPerMillion: 18.75 }),
    'claude-sonnet-4-6': Object.freeze({ inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75 }),
    'claude-sonnet-4-5': Object.freeze({ inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75, priceTierNote: 'higher tier above 200K tokens' }),
    'claude-sonnet-4': Object.freeze({ inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75, priceTierNote: 'higher tier above 200K tokens' }),
    'claude-haiku-4-5': Object.freeze({ inputUsdPerMillion: 1, outputUsdPerMillion: 5, cacheReadUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 1.25 }),
    'gemini-3.5-flash': Object.freeze({ inputUsdPerMillion: 1.5, outputUsdPerMillion: 9, cacheReadUsdPerMillion: 0.15 }),
    'gemini-3.1-pro': Object.freeze({ inputUsdPerMillion: 2, outputUsdPerMillion: 12, cacheReadUsdPerMillion: 0.2, priceTierNote: 'higher tier above 200K tokens' }),
    'gemini-3-flash': Object.freeze({ inputUsdPerMillion: 0.5, outputUsdPerMillion: 3, cacheReadUsdPerMillion: 0.05 }),
    'gpt-5.5': Object.freeze({ inputUsdPerMillion: 5, outputUsdPerMillion: 30, cacheReadUsdPerMillion: 0.5, priceTierNote: 'higher tier above 272K tokens' }),
    'gpt-5.5-pro': Object.freeze({ inputUsdPerMillion: 30, outputUsdPerMillion: 180, cacheReadUsdPerMillion: 30 }),
    'gpt-5.4': Object.freeze({ inputUsdPerMillion: 2.5, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.25, priceTierNote: 'higher tier above 272K tokens' }),
    'gpt-5.4-pro': Object.freeze({ inputUsdPerMillion: 30, outputUsdPerMillion: 180, cacheReadUsdPerMillion: 30 }),
    'gpt-5.4-mini': Object.freeze({ inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5, cacheReadUsdPerMillion: 0.075 }),
    'gpt-5.4-nano': Object.freeze({ inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.25, cacheReadUsdPerMillion: 0.02 }),
    'gpt-5.3-codex-spark': Object.freeze({ inputUsdPerMillion: 1.75, outputUsdPerMillion: 14, cacheReadUsdPerMillion: 0.175 }),
    'gpt-5.3-codex': Object.freeze({ inputUsdPerMillion: 1.75, outputUsdPerMillion: 14, cacheReadUsdPerMillion: 0.175 }),
    'gpt-5.2': Object.freeze({ inputUsdPerMillion: 1.75, outputUsdPerMillion: 14, cacheReadUsdPerMillion: 0.175 }),
    'gpt-5.2-codex': Object.freeze({ inputUsdPerMillion: 1.75, outputUsdPerMillion: 14, cacheReadUsdPerMillion: 0.175 }),
    'gpt-5.1': Object.freeze({ inputUsdPerMillion: 1.07, outputUsdPerMillion: 8.5, cacheReadUsdPerMillion: 0.107 }),
    'gpt-5.1-codex': Object.freeze({ inputUsdPerMillion: 1.07, outputUsdPerMillion: 8.5, cacheReadUsdPerMillion: 0.107 }),
    'gpt-5.1-codex-max': Object.freeze({ inputUsdPerMillion: 1.25, outputUsdPerMillion: 10, cacheReadUsdPerMillion: 0.125 }),
    'gpt-5.1-codex-mini': Object.freeze({ inputUsdPerMillion: 0.25, outputUsdPerMillion: 2, cacheReadUsdPerMillion: 0.025 }),
    'gpt-5': Object.freeze({ inputUsdPerMillion: 1.07, outputUsdPerMillion: 8.5, cacheReadUsdPerMillion: 0.107 }),
    'gpt-5-codex': Object.freeze({ inputUsdPerMillion: 1.07, outputUsdPerMillion: 8.5, cacheReadUsdPerMillion: 0.107 }),
    'gpt-5-nano': Object.freeze({ inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4, cacheReadUsdPerMillion: 0.005 }),
});

/** @type {Readonly<Record<string, string>>} */
const OPENCODE_DEPRECATION_SEED = Object.freeze({
    'gpt-5.2-codex': '2026-07-23T00:00:00.000Z',
    'gpt-5.1-codex': '2026-07-23T00:00:00.000Z',
    'gpt-5.1-codex-max': '2026-07-23T00:00:00.000Z',
    'gpt-5.1-codex-mini': '2026-07-23T00:00:00.000Z',
    'gpt-5-codex': '2026-07-23T00:00:00.000Z',
    'claude-sonnet-4': '2026-06-15T00:00:00.000Z',
    'glm-5': '2026-05-14T00:00:00.000Z',
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseOpenCodeRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {string} providerModel
 * @returns {{ endpoint: string; wireApi: string; aiSdkPackage: string; family: string }}
 */
function endpointForModel(providerModel) {
    if (providerModel.startsWith('gpt-')) {
        return { endpoint: OPENCODE_ZEN_RESPONSES_URL, wireApi: 'openai_responses', aiSdkPackage: '@ai-sdk/openai', family: 'openai' };
    }
    if (providerModel.startsWith('claude-') || providerModel.startsWith('qwen3.')) {
        return { endpoint: OPENCODE_ZEN_MESSAGES_URL, wireApi: 'anthropic_messages', aiSdkPackage: '@ai-sdk/anthropic', family: 'anthropic_compatible' };
    }
    if (providerModel.startsWith('gemini-')) {
        return { endpoint: `${OPENCODE_ZEN_BASE_URL}/models/${providerModel}`, wireApi: 'google_generative_model', aiSdkPackage: '@ai-sdk/google', family: 'google' };
    }
    return { endpoint: OPENCODE_ZEN_CHAT_COMPLETIONS_URL, wireApi: 'openai_chat_completions', aiSdkPackage: '@ai-sdk/openai-compatible', family: 'openai_compatible' };
}

/**
 * @param {string} providerModel
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(providerModel) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = { chat: true, tools: true };
    if (lower.includes('codex') || lower.includes('coder') || lower.includes('build')) capabilities['code'] = true;
    if (lower.includes('gpt-') || lower.includes('claude') || lower.includes('gemini') || lower.includes('qwen')) {
        capabilities['reasoning'] = true;
    }
    return capabilities;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} nowMs
 * @returns {Array<{ fieldPath: string; value: unknown; confidence?: string }>}
 */
function modelEvidenceValues(row, nowMs) {
    const providerModel = stringValue(row['id']);
    if (!providerModel) return [];
    const endpoint = endpointForModel(providerModel);
    const pricingSeed = OPENCODE_PRICING_SEED[/** @type {keyof typeof OPENCODE_PRICING_SEED} */ (providerModel)] ?? {};
    const free = pricingSeed['free'] === true;
    const pricing = free
        ? { currency: 'USD', tokenUnit: 'per_million_tokens', inputUsdPerMillion: 0, outputUsdPerMillion: 0 }
        : normalizeUsdPricing({
              inputPerTokenUsd: typeof pricingSeed['inputUsdPerMillion'] === 'number' ? pricingSeed['inputUsdPerMillion'] / 1_000_000 : null,
              outputPerTokenUsd: typeof pricingSeed['outputUsdPerMillion'] === 'number' ? pricingSeed['outputUsdPerMillion'] / 1_000_000 : null,
              cacheReadPerTokenUsd: typeof pricingSeed['cacheReadUsdPerMillion'] === 'number' ? pricingSeed['cacheReadUsdPerMillion'] / 1_000_000 : null,
              cacheWritePerTokenUsd: typeof pricingSeed['cacheWriteUsdPerMillion'] === 'number' ? pricingSeed['cacheWriteUsdPerMillion'] / 1_000_000 : null,
          });
    const aliases = normalizeModelAliases({ providerModel, canonicalSlug: `opencode/${providerModel}` });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        canonicalSlug: `opencode/${providerModel}`,
    });
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        expiresAt: OPENCODE_DEPRECATION_SEED[/** @type {keyof typeof OPENCODE_DEPRECATION_SEED} */ (providerModel)],
        providerModel,
        nowMs,
    });
    const capabilities = capabilitiesForModel(providerModel);
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        { fieldPath: 'aliases.opencodeConfigModel', value: `opencode/${providerModel}` },
        ...Object.entries(lifecycle).map(([key, value]) => ({
            fieldPath: `lifecycle.${key}`,
            value,
            confidence:
                OPENCODE_DEPRECATION_SEED[/** @type {keyof typeof OPENCODE_DEPRECATION_SEED} */ (providerModel)] && key !== 'createdAt'
                    ? MODEL_GATEWAY_CATALOG_CONFIDENCE.STATIC_SEED
                    : undefined,
        })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(pricing).map(([key, value]) => ({
            fieldPath: `pricing.${key}`,
            value,
            confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.STATIC_SEED,
        })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? 'opencode' },
        { fieldPath: 'providerMetadata.opencode.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.opencode.endpoint', value: endpoint.endpoint },
        { fieldPath: 'providerMetadata.opencode.wireApi', value: endpoint.wireApi },
        { fieldPath: 'providerMetadata.opencode.aiSdkPackage', value: endpoint.aiSdkPackage },
        { fieldPath: 'providerMetadata.opencode.family', value: endpoint.family },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        {
            fieldPath: 'providerMetadata.opencode.free',
            value: free || null,
            confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.STATIC_SEED,
        },
        {
            fieldPath: 'providerMetadata.opencode.priceTierNote',
            value: stringValue(pricingSeed['priceTierNote']),
            confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.STATIC_SEED,
        },
        { fieldPath: 'openai.created', value: row['created'] },
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) ?? 'opencode' },
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.url]
 * @param {() => Date} [options.now]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenCodeZenModelsImporter(options = {}) {
    const url = options.url ?? OPENCODE_ZEN_MODELS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = options.apiKey ? 'authenticated_api' : 'public_api';
    return {
        id: 'opencode-zen-models',
        providerId: 'opencode',
        sourceKind,
        requiresAuth: Boolean(options.apiKey),
        url,
        envRequirements: ['OPENCODE_API_KEY'],
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenCode Zen catalog import');
            const headers = options.apiKey
                ? { accept: 'application/json', authorization: `Bearer ${options.apiKey}` }
                : { accept: 'application/json' };
            const response = await fetchImpl(url, { headers });
            if (!response.ok) throw new Error(`OpenCode Zen models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseOpenCodeRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'opencode-zen-models';
            const nowMs = (options.now?.() ?? new Date()).getTime();
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record, nowMs).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'opencode',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind,
                        confidence:
                            item.confidence ??
                            (options.apiKey
                                ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                                : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG),
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'opencode-zen-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                const endpoint = endpointForModel(providerModel);
                return [
                    createModelRouteOption({
                        providerId: 'opencode',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind,
                        confidence: options.apiKey
                            ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                            : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: {
                            routeLayer: endpoint.wireApi === 'openai_chat_completions' ? 'openai_compatible' : 'direct_provider',
                            baseUrl: OPENCODE_ZEN_BASE_URL,
                            endpoint: endpoint.endpoint,
                            wireApi: endpoint.wireApi,
                            family: endpoint.family,
                            aiSdkPackage: endpoint.aiSdkPackage,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiKey) return [];
            const sourceId = stringValue(context.source['id']) ?? 'opencode-zen-models';
            const enabledModels = rows
                .map((row) => (isRecord(row) ? stringValue(row['id']) : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/zen/v1/models',
                    semantics: 'zen_visible_models',
                    supportsBringYourOwnKey: true,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `opencode:${options.accountScope ?? 'default'}:${options.secretRef ?? 'OPENCODE_API_KEY'}:${sourceId}`,
                    providerId: 'opencode',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'OPENCODE_API_KEY',
                    sourceId,
                    sourceKind,
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
