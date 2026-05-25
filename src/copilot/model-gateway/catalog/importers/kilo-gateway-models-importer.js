// @ts-check
/**
 * Kilo Gateway public `/models` catalog importer.
 *
 * Kilo exposes an OpenAI-compatible gateway plus a public model catalog with pricing, context, modalities, supported
 * parameters and gateway-specific route metadata. This importer keeps those as catalog evidence only; runtime success,
 * account policy and paid-model access remain later overlay/probe layers.
 *
 * @module copilot/model-gateway/catalog/importers/kilo-gateway-models-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createModelMetadataEvidence,
} from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
} from '../normalizers.js';

export const KILO_GATEWAY_MODELS_CATALOG_URL = 'https://api.kilo.ai/api/gateway/models';

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
function parseKiloRows(raw) {
    const data = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : [];
    return data.filter(isRecord);
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
 * @param {unknown} providerModel
 * @returns {string | null}
 */
function upstreamProviderFromModel(providerModel) {
    const id = stringValue(providerModel);
    if (!id || !id.includes('/')) return null;
    return id.split('/')[0] ?? null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const architecture = readArchitecture(row);
    const pricing = readPricing(row);
    const topProvider = readTopProvider(row);
    const created = finiteNumber(row['created']);
    const aliases = normalizeModelAliases({ providerModel: row['id'] });
    const lifecycle = normalizeModelLifecycle({
        created: created && created > 0 ? created : null,
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
        requestUsd: pricing['request'],
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
        { fieldPath: 'providerMetadata.kilo.upstreamProvider', value: upstreamProviderFromModel(row['id']) },
        { fieldPath: 'providerMetadata.kilo.createdUnix', value: created && created > 0 ? created : null },
        { fieldPath: 'providerMetadata.kilo.isFree', value: row['isFree'] },
        { fieldPath: 'providerMetadata.kilo.preferredIndex', value: row['preferredIndex'] },
        { fieldPath: 'providerMetadata.kilo.tokenizer', value: architecture['tokenizer'] },
        { fieldPath: 'providerMetadata.kilo.opencode', value: row['opencode'] },
        { fieldPath: 'providerMetadata.kilo.rawPricing', value: pricing },
        { fieldPath: 'routingHints.kiloTopProvider', value: topProvider },
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
export function createKiloGatewayModelsImporter(options = {}) {
    const url = options.url ?? KILO_GATEWAY_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'kilo-gateway-models',
        providerId: 'kilo',
        sourceKind: 'public_gateway_api',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Kilo Gateway catalog import');
            const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`Kilo Gateway catalog fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseKiloRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'kilo-gateway-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'kilo',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'public_gateway_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
    };
}
