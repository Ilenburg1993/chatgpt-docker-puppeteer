// @ts-check
/**
 * Generic OpenAI-compatible `/models` importer.
 *
 * Many providers and local daemons expose an OpenAI-like model list. This importer intentionally treats that endpoint
 * as identity/account-visibility metadata only; rich capabilities still need provider catalogs, docs and runtime probes.
 *
 * @module copilot/model-gateway/catalog/importers/openai-compatible-models-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
} from '../contracts.js';
import {
    normalizeAccountOverlayControls,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
} from '../normalizers.js';

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
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseOpenAICompatibleRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    const created = finiteNumber(row['created']);
    const lifecycle = normalizeModelLifecycle({
        created: created && created > 0 ? created : null,
        providerModel,
    });
    const identityTraits = normalizeModelIdentityTraits({ providerModel });
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        { fieldPath: 'aliases.providerModel', value: providerModel },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? stringValue(row['ownedBy']) },
        { fieldPath: 'providerMetadata.object', value: stringValue(row['object']) },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {string} [options.providerId]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.url]
 * @param {string} [options.baseUrl]
 * @param {string} [options.sourceKind]
 * @param {string[]} [options.envRequirements]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenAICompatibleModelsImporter(options = {}) {
    const providerId = stringValue(options.providerId);
    if (!providerId) throw new Error('[model-gateway/catalog] providerId is required for generic OpenAI-compatible importer');
    if (!options.url && !options.baseUrl) {
        throw new Error('[model-gateway/catalog] url or baseUrl is required for generic OpenAI-compatible importer');
    }
    const url = options.url ?? `${String(options.baseUrl ?? '').replace(/\/$/u, '')}/models`;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = options.sourceKind ?? (options.apiKey ? 'authenticated_api' : 'openai_compatible_api');
    const importerId = options.id ?? `${providerId}-openai-compatible-models`;
    return {
        id: importerId,
        providerId,
        sourceKind,
        requiresAuth: Boolean(options.apiKey),
        url,
        envRequirements: options.envRequirements ?? (options.secretRef ? [options.secretRef] : []),
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenAI-compatible catalog import');
            const headers = options.apiKey
                ? { accept: 'application/json', authorization: `Bearer ${options.apiKey}` }
                : { accept: 'application/json' };
            const response = await fetchImpl(url, { headers });
            if (!response.ok) throw new Error(`${providerId} OpenAI-compatible models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseOpenAICompatibleRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? importerId;
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId,
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
            const sourceId = stringValue(context.source['id']) ?? importerId;
            return rows.flatMap((row) => {
                const providerModel = stringValue(isRecord(row) ? row['id'] : null);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId,
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind,
                        confidence: options.apiKey
                            ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                            : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: { routeLayer: 'openai_compatible' },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiKey) return [];
            const sourceId = stringValue(context.source['id']) ?? importerId;
            const enabledModels = rows
                .map((row) => stringValue(isRecord(row) ? row['id'] : null))
                .filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/models',
                    semantics: 'account_visible_models',
                    openAICompatible: true,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `${providerId}:${options.accountScope ?? 'default'}:${options.secretRef ?? 'api_key'}:${sourceId}`,
                    providerId,
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef,
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
