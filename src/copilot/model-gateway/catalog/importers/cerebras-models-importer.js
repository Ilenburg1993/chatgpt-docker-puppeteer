// @ts-check
/**
 * Cerebras authenticated `/v1/models` importer.
 *
 * The public Cerebras catalog carries rich provider metadata. The authenticated endpoint remains important because it
 * exposes which models the current key can see before runtime.
 *
 * @module copilot/model-gateway/catalog/importers/cerebras-models-importer
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
import { readCatalogResponseJson } from './response-body.js';

export const CEREBRAS_MODELS_CATALOG_URL = 'https://api.cerebras.ai/v1/models';
export const CEREBRAS_OPENAI_BASE_URL = 'https://api.cerebras.ai/v1';

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
export function parseCerebrasModelsRows(raw) {
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
    const identityTraits = normalizeModelIdentityTraits({ providerModel, displayName: providerModel });
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        { fieldPath: 'aliases.providerModel', value: providerModel },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? stringValue(row['ownedBy']) ?? 'cerebras' },
        { fieldPath: 'providerMetadata.cerebras.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.cerebras.authenticatedVisibility', value: true },
        { fieldPath: 'providerMetadata.cerebras.openAICompatibleBaseUrl', value: CEREBRAS_OPENAI_BASE_URL },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) ?? stringValue(row['ownedBy']) ?? 'cerebras' },
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
 * @param {string} [options.baseUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createCerebrasModelsImporter(options = {}) {
    const url = options.url ?? CEREBRAS_MODELS_CATALOG_URL;
    const baseUrl = options.baseUrl ?? CEREBRAS_OPENAI_BASE_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'cerebras-models',
        providerId: 'cerebras',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['CEREBRAS_API_KEY', 'CEREBRAS_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 1800,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Cerebras models import');
            if (!options.apiKey) throw new Error('CEREBRAS_API_KEY is required for Cerebras models import');
            const response = await fetchImpl(url, {
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${options.apiKey}`,
                },
            });
            if (!response.ok) throw new Error(`Cerebras models fetch failed with HTTP ${response.status}`);
            return readCatalogResponseJson(response, { label: 'Cerebras models' });
        },
        parseRows: parseCerebrasModelsRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cerebras-models';
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
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cerebras-models';
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
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'direct_provider',
                            wireApi: 'openai_chat_completions',
                            openAICompatibleBaseUrl: baseUrl,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cerebras-models';
            const enabledModels = rows
                .map((row) => stringValue(isRecord(row) ? row['id'] : null))
                .filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'cerebras_account_visible_models',
                    openAICompatible: true,
                    openAICompatibleBaseUrl: baseUrl,
                    rateLimitDocsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
                    pricingDocsUrl: 'https://inference-docs.cerebras.ai/support/pricing',
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `cerebras:${options.accountScope ?? 'default'}:${options.secretRef ?? 'CEREBRAS_API_KEY'}:${sourceId}`,
                    providerId: 'cerebras',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'CEREBRAS_API_KEY',
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
