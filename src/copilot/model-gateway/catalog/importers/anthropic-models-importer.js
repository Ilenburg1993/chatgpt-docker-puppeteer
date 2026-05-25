// @ts-check
/**
 * Anthropic authenticated `/v1/models` catalog importer.
 *
 * The Anthropic models endpoint is account-scoped and paginated. It is strong evidence of model availability and release
 * metadata, but does not prove Messages/runtime behavior.
 *
 * @module copilot/model-gateway/catalog/importers/anthropic-models-importer
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
} from '../normalizers.js';

export const ANTHROPIC_MODELS_CATALOG_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_MODELS_API_VERSION = '2023-06-01';

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
function parseAnthropicRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {string} baseUrl
 * @param {string | null} afterId
 * @returns {string}
 */
function paginatedUrl(baseUrl, afterId) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);
    return url.toString();
}

/**
 * @param {string} baseUrl
 * @param {string} providerModel
 * @returns {string}
 */
function retrieveUrl(baseUrl, providerModel) {
    return `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(providerModel)}`;
}

/**
 * @param {string} providerModel
 * @returns {{ family: string; tier: string | null; generation: string | null }}
 */
function modelFamily(providerModel) {
    const lower = providerModel.toLowerCase();
    const tier = lower.includes('opus')
        ? 'opus'
        : lower.includes('sonnet')
          ? 'sonnet'
          : lower.includes('haiku')
            ? 'haiku'
            : null;
    const generation =
        lower.match(/claude-(?:opus|sonnet|haiku)-(\d+(?:-\d+)?)/u)?.[1]?.replace('-', '.') ??
        lower.match(/claude-(\d+(?:-\d+)?)/u)?.[1]?.replace('-', '.') ??
        null;
    return { family: lower.startsWith('claude-') ? 'claude' : 'unknown', tier, generation };
}

/**
 * @param {string} providerModel
 * @param {Record<string, unknown>} row
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromModel(providerModel, row) {
    /** @type {Record<string, boolean>} */
    const capabilities = {
        chat: true,
        streaming: true,
        tools: true,
    };
    const lower = providerModel.toLowerCase();
    if (lower.includes('opus') || lower.includes('sonnet')) capabilities['reasoning'] = true;
    if (row['supports_batch'] === true || row['supports_batches'] === true) capabilities['batch'] = true;
    if (row['supports_prompt_caching'] === true || row['prompt_caching'] === true) capabilities['promptCaching'] = true;
    return capabilities;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    const requestedModel = stringValue(row['requested_id']);
    const aliases = normalizeModelAliases({ providerModel });
    const lifecycle = normalizeModelLifecycle({ created: row['created_at'], providerModel });
    const family = providerModel ? modelFamily(providerModel) : { family: 'unknown', tier: null, generation: null };
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        displayName: row['display_name'],
        family: family.family === 'unknown' ? null : family.family,
        tier: family.tier,
        generation: family.generation,
    });
    const capabilities = providerModel ? capabilitiesFromModel(providerModel, row) : {};
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['display_name']) ?? providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        { fieldPath: 'aliases.anthropicModelId', value: providerModel },
        { fieldPath: 'aliases.anthropicRequestedModel', value: requestedModel && requestedModel !== providerModel ? requestedModel : null },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'anthropic' },
        { fieldPath: 'providerMetadata.anthropic.type', value: stringValue(row['type']) },
        { fieldPath: 'providerMetadata.anthropic.family', value: family.family },
        { fieldPath: 'providerMetadata.anthropic.tier', value: family.tier },
        { fieldPath: 'providerMetadata.anthropic.generation', value: family.generation },
        { fieldPath: 'providerMetadata.anthropic.supportsBatch', value: row['supports_batch'] ?? row['supports_batches'] },
        { fieldPath: 'providerMetadata.anthropic.supportsPromptCaching', value: row['supports_prompt_caching'] ?? row['prompt_caching'] },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.created', value: stringValue(row['created_at']) },
        { fieldPath: 'openai.owned_by', value: 'anthropic' },
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} baseUrl
 * @param {Record<string, unknown>[]} rows
 * @param {string} apiVersion
 * @param {string | undefined} apiKey
 * @returns {Promise<{ data: Record<string, unknown>[]; detailErrors: Array<{ model: string; status: number }> }>}
 */
async function fetchAnthropicModelDetails(fetchImpl, baseUrl, rows, apiVersion, apiKey) {
    /** @type {Record<string, unknown>[]} */
    const data = [];
    /** @type {Array<{ model: string; status: number }>} */
    const detailErrors = [];
    for (const row of rows) {
        const requestedModel = stringValue(row['id']);
        if (!requestedModel) {
            data.push(row);
            continue;
        }
        const response = await fetchImpl(retrieveUrl(baseUrl, requestedModel), {
            headers: {
                accept: 'application/json',
                'anthropic-version': apiVersion,
                'x-api-key': apiKey ?? '',
            },
        });
        if (!response.ok) {
            detailErrors.push({ model: requestedModel, status: response.status });
            data.push(row);
            continue;
        }
        const detail = await response.json();
        data.push(isRecord(detail) ? { ...row, ...detail, requested_id: requestedModel } : row);
    }
    return { data, detailErrors };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.url]
 * @param {string} [options.apiVersion]
 * @param {boolean} [options.includeModelDetails]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createAnthropicModelsImporter(options = {}) {
    const url = options.url ?? ANTHROPIC_MODELS_CATALOG_URL;
    const apiVersion = options.apiVersion ?? ANTHROPIC_MODELS_API_VERSION;
    const includeModelDetails = options.includeModelDetails ?? true;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'anthropic-models',
        providerId: 'anthropic',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Anthropic catalog import');
            if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY is required for Anthropic catalog import');
            /** @type {Record<string, unknown>[]} */
            const data = [];
            /** @type {string | null} */
            let afterId = null;
            /** @type {Record<string, unknown> | null} */
            let lastPage = null;
            for (let page = 0; page < 20; page += 1) {
                const response = await fetchImpl(paginatedUrl(url, afterId), {
                    headers: {
                        accept: 'application/json',
                        'anthropic-version': apiVersion,
                        'x-api-key': options.apiKey,
                    },
                });
                if (!response.ok) throw new Error(`Anthropic models fetch failed with HTTP ${response.status}`);
                const payload = await response.json();
                const pageRecord = isRecord(payload) ? payload : {};
                data.push(...parseAnthropicRows(pageRecord));
                lastPage = pageRecord;
                if (pageRecord['has_more'] !== true) break;
                afterId = stringValue(pageRecord['last_id']);
                if (!afterId) break;
            }
            if (!includeModelDetails) {
                return {
                    object: 'list',
                    data,
                    first_id: lastPage?.['first_id'] ?? null,
                    last_id: lastPage?.['last_id'] ?? null,
                    has_more: lastPage?.['has_more'] === true,
                };
            }
            const details = await fetchAnthropicModelDetails(fetchImpl, url, data, apiVersion, options.apiKey);
            return {
                object: 'list',
                data: details.data,
                first_id: lastPage?.['first_id'] ?? null,
                last_id: lastPage?.['last_id'] ?? null,
                has_more: lastPage?.['has_more'] === true,
                detailErrors: details.detailErrors.length > 0 ? details.detailErrors : undefined,
            };
        },
        parseRows: parseAnthropicRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'anthropic-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'anthropic',
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
            const sourceId = stringValue(context.source['id']) ?? 'anthropic-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                const capabilities = capabilitiesFromModel(providerModel, record);
                const family = modelFamily(providerModel);
                return [
                    createModelRouteOption({
                        providerId: 'anthropic',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'direct_provider',
                            wireApi: 'anthropic_messages',
                            family: family.family,
                            tier: family.tier,
                            supportsStreaming: capabilities['streaming'] === true,
                            supportsTools: capabilities['tools'] === true,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'anthropic-models';
            const enabledModels = rows.map((row) => stringValue(isRecord(row) ? row['id'] : null)).filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'account_visible_models',
                    anthropicVersion: apiVersion,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `anthropic:${options.accountScope ?? 'default'}:${options.secretRef ?? 'ANTHROPIC_API_KEY'}:${sourceId}`,
                    providerId: 'anthropic',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'ANTHROPIC_API_KEY',
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
