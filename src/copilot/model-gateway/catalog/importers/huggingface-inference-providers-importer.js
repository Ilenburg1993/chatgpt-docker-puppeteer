// @ts-check
/**
 * Hugging Face Inference Providers router catalog importer.
 *
 * The router is OpenAI-compatible, but the important metadata lives one layer above the model id: provider variants,
 * pricing, context, latency and selection suffixes such as `:fastest`, `:cheapest`, `:preferred` and explicit providers.
 *
 * @module copilot/model-gateway/catalog/importers/huggingface-inference-providers-importer
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
    normalizeModelTokenLimits,
    normalizeUsdPricing,
} from '../normalizers.js';

export const HUGGINGFACE_ROUTER_BASE_URL = 'https://router.huggingface.co/v1';
export const HUGGINGFACE_ROUTER_MODELS_URL = `${HUGGINGFACE_ROUTER_BASE_URL}/models`;
export const HUGGINGFACE_ROUTE_POLICY_SUFFIXES = Object.freeze(['fastest', 'cheapest', 'preferred']);

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
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    const text = stringValue(value)?.toLowerCase();
    if (text === 'yes' || text === 'true') return true;
    if (text === 'no' || text === 'false') return false;
    return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => stringValue(item)).filter((item) => item !== null))];
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseHuggingFaceRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : isRecord(raw) && Array.isArray(raw['models']) ? raw['models'] : [];
    return data.filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>[]}
 */
function providerRows(row) {
    const candidates = [row['providers'], row['provider_mapping'], row['inferenceProviders'], row['providerMapping']];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.filter(isRecord);
    }
    return stringValue(row['provider']) ? [row] : [];
}

/**
 * @param {Record<string, unknown>} provider
 * @returns {string | null}
 */
function providerName(provider) {
    return (
        stringValue(provider['provider']) ??
        stringValue(provider['name']) ??
        stringValue(provider['id']) ??
        stringValue(provider['providerId'])
    );
}

/**
 * @param {Record<string, unknown>} provider
 * @returns {Record<string, unknown>}
 */
function normalizedProviderVariant(provider) {
    const pricing = isRecord(provider['pricing']) ? provider['pricing'] : {};
    return {
        provider: providerName(provider),
        routing: stringArray(provider['routing'] ?? provider['policies'] ?? provider['badges']),
        inputUsdPerMillion: finiteNumber(provider['inputUsdPerMillion'] ?? pricing['inputUsdPerMillion'] ?? pricing['input']),
        outputUsdPerMillion: finiteNumber(provider['outputUsdPerMillion'] ?? pricing['outputUsdPerMillion'] ?? pricing['output']),
        contextWindowTokens: finiteNumber(provider['context'] ?? provider['context_length'] ?? provider['contextWindow']),
        latencySeconds: finiteNumber(provider['latency'] ?? provider['latencySeconds']),
        throughputTokensPerSecond: finiteNumber(provider['throughput'] ?? provider['throughputTokensPerSecond']),
        tools: booleanValue(provider['tools'] ?? provider['toolUse']),
        structuredOutputs: booleanValue(provider['structured'] ?? provider['structuredOutputs']),
    };
}

/**
 * @param {Record<string, unknown>[]} variants
 * @param {string} policy
 * @returns {string | null}
 */
function providerForPolicy(variants, policy) {
    const variant = variants.find((item) => stringArray(item['routing']).includes(policy));
    return stringValue(variant?.['provider']);
}

/**
 * @param {Record<string, unknown>[]} variants
 * @returns {number | null}
 */
function maxContextWindow(variants) {
    const values = variants.map((item) => finiteNumber(item['contextWindowTokens'])).filter((item) => item !== null);
    return values.length > 0 ? Math.max(...values) : null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']) ?? stringValue(row['model']);
    const variants = providerRows(row).map(normalizedProviderVariant).filter((item) => stringValue(item['provider']));
    const aliases = normalizeModelAliases({ providerModel, huggingFaceId: providerModel });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        displayName: row['name'],
        huggingFaceId: providerModel,
    });
    const limits = normalizeModelTokenLimits({ contextWindowTokens: maxContextWindow(variants) });
    const tools = variants.some((item) => item['tools'] === true);
    const structuredOutputs = variants.some((item) => item['structuredOutputs'] === true);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['name']) ?? providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'capabilities.chat', value: true },
        { fieldPath: 'capabilities.tools', value: tools || null },
        { fieldPath: 'capabilities.structuredOutputs', value: structuredOutputs || null },
        { fieldPath: 'providerMetadata.ownedBy', value: 'huggingface' },
        { fieldPath: 'providerMetadata.huggingface.providers', value: variants },
        { fieldPath: 'providerMetadata.huggingface.fastestProvider', value: providerForPolicy(variants, 'fastest') },
        { fieldPath: 'providerMetadata.huggingface.cheapestProvider', value: providerForPolicy(variants, 'cheapest') },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.owned_by', value: 'huggingface' },
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
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createHuggingFaceInferenceProvidersImporter(options = {}) {
    const url = options.url ?? HUGGINGFACE_ROUTER_MODELS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = options.apiKey ? 'authenticated_api' : 'public_catalog';
    return {
        id: 'huggingface-inference-providers',
        providerId: 'huggingface',
        sourceKind,
        requiresAuth: Boolean(options.apiKey),
        url,
        envRequirements: ['HF_TOKEN', 'HUGGINGFACE_API_TOKEN'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Hugging Face catalog import');
            const headers = options.apiKey
                ? { accept: 'application/json', authorization: `Bearer ${options.apiKey}` }
                : { accept: 'application/json' };
            const response = await fetchImpl(url, { headers });
            if (!response.ok) throw new Error(`Hugging Face router models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseHuggingFaceRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'huggingface-inference-providers';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']) ?? stringValue(record['model']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'huggingface',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind,
                        confidence: options.apiKey
                            ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                            : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'huggingface-inference-providers';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']) ?? stringValue(record['model']);
                if (!providerModel) return [];
                const variants = providerRows(record).map(normalizedProviderVariant).filter((item) => stringValue(item['provider']));
                const policyRoutes = HUGGINGFACE_ROUTE_POLICY_SUFFIXES.map((policy) =>
                    createModelRouteOption({
                        providerId: 'huggingface',
                        providerModel,
                        selectorKind: policy,
                        selectorSyntax: `${providerModel}:${policy}`,
                        sourceId,
                        sourceKind,
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible_aggregator',
                            openAICompatibleBaseUrl: HUGGINGFACE_ROUTER_BASE_URL,
                            providerSelectionPolicy: policy,
                            selectedProviderHint: providerForPolicy(variants, policy),
                        },
                    }),
                );
                const explicitRoutes = variants.map((variant) => {
                    const provider = stringValue(variant['provider']) ?? '';
                    return createModelRouteOption({
                        providerId: 'huggingface',
                        providerModel,
                        selectorKind: 'provider_explicit',
                        selectorSyntax: `${providerModel}:${provider}`,
                        sourceId,
                        sourceKind,
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        providerSpecific: {
                            huggingFaceProvider: provider,
                            pricing: normalizeUsdPricing({
                                inputPerTokenUsd: finiteNumber(variant['inputUsdPerMillion']) === null ? null : Number(variant['inputUsdPerMillion']) / 1_000_000,
                                outputPerTokenUsd: finiteNumber(variant['outputUsdPerMillion']) === null ? null : Number(variant['outputUsdPerMillion']) / 1_000_000,
                            }),
                        },
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible_aggregator',
                            openAICompatibleBaseUrl: HUGGINGFACE_ROUTER_BASE_URL,
                            providerSelectionPolicy: 'provider_explicit',
                            provider,
                        },
                    });
                });
                return [...policyRoutes, ...explicitRoutes];
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiKey) return [];
            const sourceId = stringValue(context.source['id']) ?? 'huggingface-inference-providers';
            const enabledModels = rows
                .map((row) => (isRecord(row) ? stringValue(row['id']) ?? stringValue(row['model']) : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'router_visible_models',
                    openAICompatible: true,
                    routePolicySuffixes: [...HUGGINGFACE_ROUTE_POLICY_SUFFIXES],
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `huggingface:${options.accountScope ?? 'default'}:${options.secretRef ?? 'HF_TOKEN'}:${sourceId}`,
                    providerId: 'huggingface',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'HF_TOKEN',
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
