// @ts-check
/**
 * Mistral authenticated `/v1/models` catalog importer.
 *
 * Mistral's models endpoint returns account-visible model cards with capabilities, context length, aliases,
 * deprecation/replacement hints and fine-tuned metadata. Runtime proof still belongs to probes.
 *
 * @module copilot/model-gateway/catalog/importers/mistral-models-importer
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
} from '../normalizers.js';

export const MISTRAL_MODELS_CATALOG_URL = 'https://api.mistral.ai/v1/models';

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
function parseMistralRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function unixSecondsToIso(value) {
    const seconds = finiteNumber(value);
    if (seconds === null) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {Record<string, unknown>} capabilities
 * @returns {Record<string, boolean>}
 */
function normalizeMistralCapabilities(capabilities) {
    /** @type {Record<string, boolean>} */
    const normalized = {};
    if (capabilities['completion_chat'] === true) normalized['chat'] = true;
    if (capabilities['function_calling'] === true) normalized['tools'] = true;
    if (capabilities['completion_fim'] === true) normalized['codeCompletion'] = true;
    if (capabilities['vision'] === true) normalized['vision'] = true;
    if (capabilities['classification'] === true) normalized['classification'] = true;
    if (capabilities['fine_tuning'] === true) normalized['fineTuning'] = true;
    return normalized;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const capabilities = isRecord(row['capabilities']) ? row['capabilities'] : {};
    const aliases = normalizeModelAliases({
        providerModel: row['id'],
        canonicalSlug: row['root'],
    });
    const deprecation = stringValue(row['deprecation']);
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        expiresAt: deprecation,
        lifecycle: row['archived'] === true ? 'retired' : deprecation ? 'scheduled_retirement' : null,
        providerModel: row['id'],
    });
    const modalities = normalizeModelModalities({
        input: capabilities['vision'] === true ? ['text', 'image'] : ['text'],
        output: ['text'],
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['max_context_length'],
    });
    const normalizedCapabilities = normalizeMistralCapabilities(capabilities);
    const aliasesList = stringList(row['aliases']);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['name']) ?? stringValue(row['id']) },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        { fieldPath: 'aliases.mistralAliases', value: aliasesList },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'lifecycle.replacementModel', value: stringValue(row['deprecation_replacement_model']) },
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(normalizedCapabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) },
        { fieldPath: 'providerMetadata.mistral.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.mistral.root', value: stringValue(row['root']) },
        { fieldPath: 'providerMetadata.mistral.job', value: stringValue(row['job']) },
        { fieldPath: 'providerMetadata.mistral.type', value: stringValue(row['TYPE']) ?? stringValue(row['type']) },
        { fieldPath: 'providerMetadata.mistral.archived', value: row['archived'] },
        { fieldPath: 'providerMetadata.mistral.defaultTemperature', value: finiteNumber(row['default_model_temperature']) },
        { fieldPath: 'openai.created', value: unixSecondsToIso(row['created']) },
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) },
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
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createMistralModelsImporter(options = {}) {
    const url = options.url ?? MISTRAL_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'mistral-models',
        providerId: 'mistral',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['MISTRAL_API_KEY', 'MISTRAL_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Mistral catalog import');
            if (!options.apiKey) throw new Error('MISTRAL_API_KEY is required for Mistral catalog import');
            const response = await fetchImpl(url, {
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${options.apiKey}`,
                },
            });
            if (!response.ok) throw new Error(`Mistral models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseMistralRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'mistral-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'mistral',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'mistral-models';
            return rows.flatMap((row) => {
                const providerModel = stringValue(isRecord(row) ? row['id'] : null);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'mistral',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: { routeLayer: 'direct_provider' },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'mistral-models';
            const enabledModels = rows.map((row) => stringValue(isRecord(row) ? row['id'] : null)).filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'account_visible_models',
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `mistral:${options.accountScope ?? 'default'}:${options.secretRef ?? 'MISTRAL_API_KEY'}:${sourceId}`,
                    providerId: 'mistral',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'MISTRAL_API_KEY',
                    sourceId,
                    sourceKind: 'authenticated_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
