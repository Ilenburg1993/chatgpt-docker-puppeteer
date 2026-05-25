// @ts-check
/**
 * Chutes public/authenticated `/v1/models` catalog importer.
 *
 * Chutes exposes an OpenAI-shaped model list with unusually rich provider metadata: prices, modalities, context,
 * supported parameters, feature flags, quantization and confidential-compute markers. This importer treats those facts
 * as catalog evidence only; account/runtime access is still established by overlays and later probes.
 *
 * @module copilot/model-gateway/catalog/importers/chutes-models-importer
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
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
} from '../normalizers.js';

export const CHUTES_OPENAI_BASE_URL = 'https://llm.chutes.ai/v1';
export const CHUTES_MODELS_CATALOG_URL = `${CHUTES_OPENAI_BASE_URL}/models`;

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
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(stringValue).filter((item) => item !== null))];
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseChutesRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * Chutes reports pricing in dollars per million tokens. The shared normalizer accepts dollars per token.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function perMillionToPerToken(value) {
    const number = finiteNumber(value);
    return number === null ? null : number / 1_000_000;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readPricing(row) {
    const pricing = isRecord(row['pricing']) ? row['pricing'] : {};
    const price = isRecord(row['price']) ? row['price'] : {};
    const nestedInput = isRecord(price['input']) ? price['input'] : {};
    const nestedOutput = isRecord(price['output']) ? price['output'] : {};
    const nestedCacheRead = isRecord(price['input_cache_read']) ? price['input_cache_read'] : {};
    return {
        prompt: pricing['prompt'] ?? nestedInput['usd'],
        completion: pricing['completion'] ?? nestedOutput['usd'],
        input_cache_read: pricing['input_cache_read'] ?? nestedCacheRead['usd'],
        input_cache_write: pricing['input_cache_write'],
    };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    if (!providerModel) return [];
    const supportedFeatures = stringList(row['supported_features']);
    const supportedParameters = stringList(row['supported_sampling_parameters']);
    const aliases = normalizeModelAliases({
        providerModel,
        canonicalSlug: row['root'],
        huggingFaceId: row['root'],
    });
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        providerModel,
    });
    const modalities = normalizeModelModalities({
        input: row['input_modalities'],
        output: row['output_modalities'],
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['context_length'] ?? row['max_model_len'],
        maxOutputTokens: row['max_output_length'],
    });
    const pricing = readPricing(row);
    const normalizedPricing = normalizeUsdPricing({
        inputPerTokenUsd: perMillionToPerToken(pricing['prompt']),
        outputPerTokenUsd: perMillionToPerToken(pricing['completion']),
        cacheReadPerTokenUsd: perMillionToPerToken(pricing['input_cache_read']),
        cacheWritePerTokenUsd: perMillionToPerToken(pricing['input_cache_write']),
    });
    /** @type {Record<string, boolean>} */
    const capabilities = {
        chat: true,
        streaming: true,
        ...normalizeOpenAICompatibleModelCapabilities({
            supportedParameters: [...supportedFeatures, ...supportedParameters],
            inputModalities: modalities.input,
            outputModalities: modalities.output,
        }),
    };
    if (supportedFeatures.includes('tools')) capabilities['tools'] = true;
    if (supportedFeatures.includes('json_mode')) capabilities['jsonMode'] = true;
    if (supportedFeatures.includes('structured_outputs')) capabilities['structuredOutputs'] = true;
    if (supportedFeatures.includes('reasoning')) capabilities['reasoning'] = true;
    if (row['confidential_compute'] === true) capabilities['confidentialCompute'] = true;

    const values = [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'supportedParameters', value: supportedParameters },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? 'chutes' },
        { fieldPath: 'providerMetadata.chutes.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.chutes.root', value: stringValue(row['root']) },
        { fieldPath: 'providerMetadata.chutes.parent', value: stringValue(row['parent']) },
        { fieldPath: 'providerMetadata.chutes.chuteId', value: stringValue(row['chute_id']) },
        { fieldPath: 'providerMetadata.chutes.quantization', value: stringValue(row['quantization']) },
        { fieldPath: 'providerMetadata.chutes.maxModelLen', value: finiteNumber(row['max_model_len']) },
        { fieldPath: 'providerMetadata.chutes.confidentialCompute', value: row['confidential_compute'] === true },
        { fieldPath: 'providerMetadata.chutes.supportedFeatures', value: supportedFeatures },
        { fieldPath: 'providerMetadata.chutes.supportedSamplingParameters', value: supportedParameters },
        { fieldPath: 'providerMetadata.chutes.permission', value: row['permission'] },
        { fieldPath: 'openai.created', value: finiteNumber(row['created']) },
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) ?? 'chutes' },
    ];
    return values.filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        if (isRecord(item.value) && Object.keys(item.value).length === 0) return false;
        return true;
    });
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.baseUrl]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createChutesModelsImporter(options = {}) {
    const baseUrl = (options.baseUrl ?? CHUTES_OPENAI_BASE_URL).replace(/\/$/u, '');
    const url = options.url ?? `${baseUrl}/models`;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = options.apiKey ? 'authenticated_api' : 'public_api';
    return {
        id: 'chutes-models',
        providerId: 'chutes',
        sourceKind,
        requiresAuth: Boolean(options.apiKey),
        url,
        envRequirements: ['CHUTES_API_KEY', 'CHUTES_AI'],
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Chutes catalog import');
            const headers = options.apiKey
                ? { accept: 'application/json', authorization: `Bearer ${options.apiKey}` }
                : { accept: 'application/json' };
            const response = await fetchImpl(url, { headers });
            if (!response.ok) throw new Error(`Chutes models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseChutesRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'chutes-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'chutes',
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
            const sourceId = stringValue(context.source['id']) ?? 'chutes-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'chutes',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind,
                        confidence: options.apiKey
                            ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                            : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible',
                            openAICompatibleBaseUrl: baseUrl,
                            confidentialCompute: record['confidential_compute'] === true,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiKey) return [];
            const sourceId = stringValue(context.source['id']) ?? 'chutes-models';
            const enabledModels = rows
                .map((row) => (isRecord(row) ? stringValue(row['id']) : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'catalog_visible_models',
                    openAICompatible: true,
                    publicCatalogAvailable: true,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `chutes:${options.accountScope ?? 'default'}:${options.secretRef ?? 'CHUTES_API_KEY'}:${sourceId}`,
                    providerId: 'chutes',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'CHUTES_API_KEY',
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
