// @ts-check
/**
 * Gemini authenticated Models API catalog importer.
 *
 * Gemini exposes richer static metadata than many account-scoped `/models` endpoints. This importer uses `models.list`
 * plus per-model `models.get` enrichment, while still treating the output as catalog evidence rather than runtime
 * proof.
 *
 * @module copilot/model-gateway/catalog/importers/gemini-models-importer
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
} from '../normalizers.js';
import { readCatalogResponseJson, readCatalogResponseText } from './response-body.js';

export const GEMINI_MODELS_API_VERSION = 'v1beta';
export const GEMINI_MODELS_CATALOG_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_OPENAI_COMPATIBLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

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
    if (text === 'true') return true;
    if (text === 'false') return false;
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
 * @param {string} resourceName
 * @returns {string}
 */
function providerModelFromResourceName(resourceName) {
    return resourceName.startsWith('models/') ? resourceName.slice('models/'.length) : resourceName;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function rowProviderModel(row) {
    const name = stringValue(row['name']);
    if (name) return providerModelFromResourceName(name);
    return stringValue(row['baseModelId']);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseGeminiRows(raw) {
    const models = isRecord(raw) && Array.isArray(raw['models']) ? raw['models'] : Array.isArray(raw) ? raw : [];
    return models.filter(isRecord);
}

/**
 * @param {import('./http-port.js').CatalogHttpResponse} response
 * @param {string} operation
 * @returns {Promise<Error>}
 */
async function geminiHttpError(response, operation) {
    const text = await readCatalogResponseText(response, { label: `Gemini ${operation} error` }).catch(() => '');
    const record = (() => {
        try {
            const parsed = JSON.parse(text);
            return isRecord(parsed) ? parsed : {};
        } catch {
            return {};
        }
    })();
    const error = isRecord(record['error']) ? record['error'] : {};
    const details = Array.isArray(error['details']) ? error['details'].filter(isRecord) : [];
    const reason = details.map((detail) => stringValue(detail['reason'])).find((item) => item !== null);
    const status = stringValue(error['status']);
    const message = stringValue(error['message']) ?? text.slice(0, 300).trim();
    return new Error(
        `Gemini ${operation} failed with HTTP ${response.status}${message ? `: ${message}` : ''}${status ? ` [${status}${reason ? `/${reason}` : ''}]` : ''}`,
    );
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Gemini catalog import failed';
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function looksLikeKeyDisabled(message) {
    return /\b(api key (?:expired|invalid|disabled)|invalid api key|permission denied|unauthori[sz]ed|forbidden|authentication)\b/iu.test(
        message,
    );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function looksLikeRateLimited(message) {
    return /\b(rate limit|too many requests|quota exceeded|resource exhausted)\b/iu.test(message);
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string | null} pageToken
 * @returns {string}
 */
function listUrl(baseUrl, apiKey, pageToken) {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('key', apiKey);
    return url.toString();
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} resourceName
 * @returns {string}
 */
function getUrl(baseUrl, apiKey, resourceName) {
    const root = baseUrl.replace(/\/models$/u, '');
    const url = new URL(`${root}/${resourceName}`);
    url.searchParams.set('key', apiKey);
    return url.toString();
}

/**
 * @param {string[]} methods
 * @param {boolean | null} thinking
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromMethods(methods, thinking) {
    const methodSet = new Set(methods);
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (methodSet.has('generateContent')) capabilities['chat'] = true;
    if (methodSet.has('streamGenerateContent')) capabilities['streaming'] = true;
    if (methodSet.has('countTokens')) capabilities['tokenCounting'] = true;
    if (methodSet.has('embedContent') || methodSet.has('batchEmbedContents')) capabilities['embeddings'] = true;
    if (methodSet.has('batchGenerateContent')) capabilities['batch'] = true;
    if (methodSet.has('predict') || methodSet.has('predictLongRunning')) capabilities['prediction'] = true;
    if (thinking === true) capabilities['reasoning'] = true;
    return capabilities;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ fieldPath: string; value: unknown }[]}
 */
function modelEvidenceValues(row) {
    const providerModel = rowProviderModel(row);
    const resourceName = stringValue(row['name']) ?? (providerModel ? `models/${providerModel}` : null);
    const methods = stringArray(row['supportedGenerationMethods']);
    const thinking = booleanValue(row['thinking']);
    const aliases = normalizeModelAliases({
        providerModel,
        canonicalSlug: stringValue(row['baseModelId']),
    });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        displayName: row['displayName'],
        canonicalSlug: row['baseModelId'],
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['inputTokenLimit'],
        maxOutputTokens: row['outputTokenLimit'],
    });
    const capabilities = capabilitiesFromMethods(methods, thinking);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['displayName']) ?? providerModel },
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'google' },
        { fieldPath: 'providerMetadata.gemini.name', value: resourceName },
        { fieldPath: 'providerMetadata.gemini.baseModelId', value: stringValue(row['baseModelId']) },
        { fieldPath: 'providerMetadata.gemini.version', value: stringValue(row['version']) },
        { fieldPath: 'providerMetadata.gemini.supportedGenerationMethods', value: methods.length > 0 ? methods : null },
        { fieldPath: 'providerMetadata.gemini.thinking', value: thinking },
        { fieldPath: 'providerMetadata.gemini.temperature', value: finiteNumber(row['temperature']) },
        { fieldPath: 'providerMetadata.gemini.maxTemperature', value: finiteNumber(row['maxTemperature']) },
        { fieldPath: 'providerMetadata.gemini.topP', value: finiteNumber(row['topP']) },
        { fieldPath: 'providerMetadata.gemini.topK', value: finiteNumber(row['topK']) },
        ...Object.entries(identityTraits).map(([key, value]) => ({
            fieldPath: `providerMetadata.modelTraits.${key}`,
            value,
        })),
        { fieldPath: 'openai.owned_by', value: 'google' },
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.url]
 * @param {string} [options.apiVersion]
 * @param {boolean} [options.includeModelDetails]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createGeminiModelsImporter(options = {}) {
    const url = options.url ?? GEMINI_MODELS_CATALOG_URL;
    const apiVersion = options.apiVersion ?? GEMINI_MODELS_API_VERSION;
    const includeModelDetails = options.includeModelDetails ?? true;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'gemini-models',
        providerId: 'gemini',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Gemini catalog import');
            if (!options.apiKey) throw new Error('GEMINI_API_KEY is required for Gemini catalog import');
            /** @type {Record<string, unknown>[]} */
            const models = [];
            /** @type {string | null} */
            let pageToken = null;
            for (let page = 0; page < 20; page += 1) {
                const response = await fetchImpl(listUrl(url, options.apiKey, pageToken), {
                    headers: { accept: 'application/json' },
                });
                if (!response.ok) throw await geminiHttpError(response, 'models.list');
                const payload = await readCatalogResponseJson(response, { label: 'Gemini models page' });
                const pageRecord = isRecord(payload) ? payload : {};
                models.push(...parseGeminiRows(pageRecord));
                pageToken = stringValue(pageRecord['nextPageToken']);
                if (!pageToken) break;
            }
            if (!includeModelDetails) return { models };
            /** @type {{ name: string; status: number; message?: string }[]} */
            const detailErrors = [];
            /** @type {Record<string, unknown>[]} */
            const detailedModels = [];
            for (const model of models) {
                const resourceName = stringValue(model['name']);
                if (!resourceName) {
                    detailedModels.push(model);
                    continue;
                }
                const response = await fetchImpl(getUrl(url, options.apiKey, resourceName), {
                    headers: { accept: 'application/json' },
                });
                if (!response.ok) {
                    const error = await geminiHttpError(response, `models.get ${resourceName}`);
                    detailErrors.push({ name: resourceName, status: response.status, message: error.message });
                    detailedModels.push(model);
                    continue;
                }
                const detail = await readCatalogResponseJson(response, {
                    label: `Gemini model detail ${resourceName}`,
                });
                detailedModels.push(isRecord(detail) ? { ...model, ...detail } : model);
            }
            return detailErrors.length > 0 ? { models: detailedModels, detailErrors } : { models: detailedModels };
        },
        parseRows: parseGeminiRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'gemini-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = rowProviderModel(record);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'gemini',
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
            const sourceId = stringValue(context.source['id']) ?? 'gemini-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = rowProviderModel(record);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'gemini',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible',
                            apiVersion,
                            directWireApi: 'gemini_generate_content',
                            openAICompatibleBaseUrl: GEMINI_OPENAI_COMPATIBLE_BASE_URL,
                            resourceName: stringValue(record['name']) ?? `models/${providerModel}`,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'gemini-models';
            const enabledModels = rows
                .map((row) => rowProviderModel(isRecord(row) ? row : {}))
                .filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1beta/models',
                    semantics: 'account_visible_models',
                    apiVersion,
                    authPlacement: 'query_key',
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `gemini:${options.accountScope ?? 'default'}:${options.secretRef ?? 'GEMINI_API_KEY'}:${sourceId}`,
                    providerId: 'gemini',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'GEMINI_API_KEY',
                    sourceId,
                    sourceKind: 'authenticated_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
        toFailureAccountOverlays(error, context) {
            const sourceId = stringValue(context.source['id']) ?? 'gemini-models';
            const message = errorMessage(error);
            const disabled = looksLikeKeyDisabled(message);
            const rateLimited = looksLikeRateLimited(message);
            const controls = normalizeAccountOverlayControls({
                providerMetadata: {
                    endpoint: '/v1beta/models',
                    semantics: 'account_visible_models_failed',
                    apiVersion,
                    authPlacement: 'query_key',
                    catalogImportStatus: 'failed',
                    failureMessage: message,
                    apiKeyDisabled: disabled,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `gemini:${options.accountScope ?? 'default'}:${options.secretRef ?? 'GEMINI_API_KEY'}:${sourceId}:failure`,
                    providerId: 'gemini',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'GEMINI_API_KEY',
                    sourceId,
                    sourceKind: 'authenticated_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    rateLimits: rateLimited ? { limited: true } : controls.rateLimits,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
