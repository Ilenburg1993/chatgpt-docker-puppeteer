// @ts-check
/**
 * Cerebras public `/public/v1/models` catalog importer.
 *
 * The public Cerebras catalog is richer than a plain OpenAI-compatible `/models` list: it includes pricing, limits,
 * capabilities, architecture and lifecycle hints. Runtime access still depends on account overlays and probes.
 *
 * @module copilot/model-gateway/catalog/importers/cerebras-public-models-importer
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
    normalizeUsdPricing,
} from '../normalizers.js';
import { readCatalogResponseJson } from './response-body.js';

export const CEREBRAS_PUBLIC_MODELS_CATALOG_URL = 'https://api.cerebras.ai/public/v1/models';

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
function parseCerebrasRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function readRecordField(row, field) {
    return isRecord(row[field]) ? row[field] : {};
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function bool(value) {
    return value === true;
}

/**
 * @param {Record<string, unknown>} capabilities
 * @returns {Record<string, boolean>}
 */
function normalizeCerebrasCapabilities(capabilities) {
    /** @type {Record<string, boolean>} */
    const normalized = {};
    if (bool(capabilities['streaming'])) normalized['streaming'] = true;
    if (bool(capabilities['tools']) || bool(capabilities['function_calling'])) normalized['tools'] = true;
    if (bool(capabilities['tool_choice'])) normalized['forcedToolChoice'] = true;
    if (bool(capabilities['parallel_tool_calls'])) normalized['parallelToolCalls'] = true;
    if (bool(capabilities['json_mode']) || bool(capabilities['response_format'])) normalized['jsonMode'] = true;
    if (bool(capabilities['structured_outputs'])) normalized['structuredOutputs'] = true;
    if (bool(capabilities['reasoning'])) normalized['reasoningEffort'] = true;
    if (bool(capabilities['vision'])) normalized['vision'] = true;
    return normalized;
}

/**
 * @param {Record<string, unknown>} supportedParameters
 * @returns {string[]}
 */
function supportedParameterList(supportedParameters) {
    return Object.entries(supportedParameters)
        .filter(([, value]) => value === true)
        .map(([key]) => key);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const architecture = readRecordField(row, 'architecture');
    const pricing = readRecordField(row, 'pricing');
    const limits = readRecordField(row, 'limits');
    const capabilities = readRecordField(row, 'capabilities');
    const supportedParameters = readRecordField(row, 'supported_parameters');
    const aliases = normalizeModelAliases({
        providerModel: row['id'],
        huggingFaceId: row['hugging_face_id'],
    });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row['id'],
        displayName: row['name'],
        huggingFaceId: row['hugging_face_id'],
        quantization: row['quantization'],
    });
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        providerModel: row['id'],
        lifecycle: row['deprecated'] === true ? 'deprecated' : row['preview'] === true ? 'preview' : null,
    });
    const modalities = normalizeModelModalities({ expression: architecture['modality'] });
    const normalizedCapabilities = normalizeCerebrasCapabilities(capabilities);
    const normalizedLimits = normalizeModelTokenLimits({
        contextWindowTokens: limits['max_context_length'],
        maxOutputTokens: limits['max_completion_tokens'],
        requestsPerMinute: limits['requests_per_minute'],
        tokensPerMinute: limits['tokens_per_minute'],
    });
    const normalizedPricing = normalizeUsdPricing({
        inputPerTokenUsd: pricing['prompt'],
        outputPerTokenUsd: pricing['completion'],
    });
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['name']) ?? stringValue(row['id']) },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(normalizedLimits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'supportedParameters', value: supportedParameterList(supportedParameters) },
        ...Object.entries(normalizedCapabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) },
        { fieldPath: 'providerMetadata.cerebras.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.cerebras.huggingFaceId', value: stringValue(row['hugging_face_id']) },
        { fieldPath: 'providerMetadata.cerebras.tokenizer', value: stringValue(architecture['tokenizer']) },
        { fieldPath: 'providerMetadata.cerebras.instructType', value: stringValue(architecture['instruct_type']) },
        { fieldPath: 'providerMetadata.cerebras.datacenterLocations', value: row['datacenter_locations'] },
        { fieldPath: 'providerMetadata.cerebras.deprecated', value: row['deprecated'] },
        { fieldPath: 'providerMetadata.cerebras.preview', value: row['preview'] },
        { fieldPath: 'providerMetadata.cerebras.quantization', value: stringValue(row['quantization']) },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
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
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createCerebrasPublicModelsImporter(options = {}) {
    const url = options.url ?? CEREBRAS_PUBLIC_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'cerebras-public-models',
        providerId: 'cerebras',
        sourceKind: 'public_api',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Cerebras public catalog import');
            const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`Cerebras public catalog fetch failed with HTTP ${response.status}`);
            return readCatalogResponseJson(response, { label: 'Cerebras public models' });
        },
        parseRows: parseCerebrasRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cerebras-public-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'cerebras',
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
            const sourceId = stringValue(context.source['id']) ?? 'cerebras-public-models';
            return rows.flatMap((row) => {
                const providerModel = stringValue(isRecord(row) ? row['id'] : null);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'cerebras',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'public_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: { routeLayer: 'direct_provider' },
                    }),
                ];
            });
        },
    };
}
