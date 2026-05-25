// @ts-check
/**
 * OpenRouter public `/api/v1/models` catalog importer.
 *
 * OpenRouter exposes rich route metadata in a public catalog. This importer keeps that metadata as field-level evidence
 * instead of promoting catalog claims directly to probe-verified agentic capability.
 *
 * @module copilot/model-gateway/catalog/importers/openrouter-models-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createModelMetadataEvidence,
    createModelRouteOption,
} from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
} from '../normalizers.js';

export const OPENROUTER_MODELS_CATALOG_URL = 'https://openrouter.ai/api/v1/models';

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
function parseOpenRouterRows(raw) {
    if (!isRecord(raw) || !Array.isArray(raw['data'])) return [];
    return raw['data'].filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readArchitecture(row) {
    return isRecord(row['architecture']) ? row['architecture'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readPricing(row) {
    return isRecord(row['pricing']) ? row['pricing'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readTopProvider(row) {
    return isRecord(row['top_provider']) ? row['top_provider'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readLinks(row) {
    return isRecord(row['links']) ? row['links'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const architecture = readArchitecture(row);
    const pricing = readPricing(row);
    const topProvider = readTopProvider(row);
    const links = readLinks(row);
    const aliases = normalizeModelAliases({
        providerModel: row['id'],
        canonicalSlug: row['canonical_slug'],
        huggingFaceId: row['hugging_face_id'],
    });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row['id'],
        displayName: row['name'],
        canonicalSlug: row['canonical_slug'],
        huggingFaceId: row['hugging_face_id'],
    });
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        expiresAt: row['expiration_date'],
        knowledgeCutoff: row['knowledge_cutoff'],
        providerModel: row['id'],
    });
    const modalities = normalizeModelModalities({
        input: architecture['input_modalities'],
        output: architecture['output_modalities'],
        expression: architecture['modality'],
    });
    const supportedParameters = stringList(row['supported_parameters']);
    const capabilities = normalizeOpenAICompatibleModelCapabilities({
        supportedParameters,
        inputModalities: modalities.input,
        outputModalities: modalities.output,
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['context_length'] ?? topProvider['context_length'],
        maxOutputTokens: topProvider['max_completion_tokens'],
    });
    const normalizedPricing = normalizeUsdPricing({
        inputPerTokenUsd: pricing['prompt'],
        outputPerTokenUsd: pricing['completion'],
        cacheReadPerTokenUsd: pricing['input_cache_read'],
        cacheWritePerTokenUsd: pricing['input_cache_write'],
        webSearchUsdPerRequest: pricing['web_search'],
    });
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['name']) },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'supportedParameters', value: supportedParameters },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.openrouter.createdUnix', value: row['created'] },
        { fieldPath: 'providerMetadata.openrouter.canonicalSlug', value: row['canonical_slug'] },
        { fieldPath: 'providerMetadata.openrouter.modality', value: architecture['modality'] },
        { fieldPath: 'providerMetadata.openrouter.tokenizer', value: architecture['tokenizer'] },
        { fieldPath: 'providerMetadata.openrouter.instructType', value: architecture['instruct_type'] },
        { fieldPath: 'providerMetadata.openrouter.defaultParameters', value: row['default_parameters'] },
        { fieldPath: 'providerMetadata.openrouter.supportedVoices', value: row['supported_voices'] },
        { fieldPath: 'providerMetadata.openrouter.perRequestLimits', value: row['per_request_limits'] },
        { fieldPath: 'providerMetadata.openrouter.detailsPath', value: links['details'] },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'routingHints.openrouterTopProvider', value: topProvider },
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
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenRouterModelsImporter(options = {}) {
    const url = options.url ?? OPENROUTER_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'openrouter-models',
        providerId: 'openrouter',
        sourceKind: 'public_api',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenRouter catalog import');
            const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`OpenRouter catalog fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseOpenRouterRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openrouter-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'openrouter',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'public_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openrouter-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'openrouter',
                        providerModel,
                        selectorKind: 'aggregator_auto',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'public_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        providerSpecific: {
                            topProvider: readTopProvider(record),
                        },
                        normalizedPolicy: {
                            routeLayer: 'aggregator',
                            autoSelection: true,
                            supportsProviderOrder: true,
                            supportsFallbackChain: true,
                        },
                    }),
                ];
            });
        },
    };
}
