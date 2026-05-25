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
} from '../contracts.js';
import {
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
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const architecture = readArchitecture(row);
    const pricing = readPricing(row);
    const topProvider = readTopProvider(row);
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
        { fieldPath: 'aliases.canonicalSlug', value: stringValue(row['canonical_slug']) },
        { fieldPath: 'aliases.huggingFaceId', value: stringValue(row['hugging_face_id']) },
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'supportedParameters', value: supportedParameters },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
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
    };
}
