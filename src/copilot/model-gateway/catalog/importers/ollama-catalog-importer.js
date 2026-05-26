// @ts-check
/**
 * Ollama local daemon catalog importer.
 *
 * Ollama's local API exposes installed tags via `/api/tags` and richer per-model metadata via `/api/show`. This source
 * proves local availability on the daemon, not cloud availability or runtime behavior under a particular prompt.
 *
 * @module copilot/model-gateway/catalog/importers/ollama-catalog-importer
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
    normalizeModelModalities,
    normalizeModelTokenLimits,
} from '../normalizers.js';

export const OLLAMA_LOCAL_API_BASE_URL = 'http://localhost:11434/api';
export const OLLAMA_LOCAL_TAGS_URL = `${OLLAMA_LOCAL_API_BASE_URL}/tags`;
export const OLLAMA_LOCAL_SHOW_URL = `${OLLAMA_LOCAL_API_BASE_URL}/show`;
export const OLLAMA_LOCAL_OPENAI_BASE_URL = 'http://localhost:11434/v1';

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
function stringArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => stringValue(item)).filter((item) => item !== null))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeApiBaseUrl(value) {
    const trimmed = value.replace(/\/$/u, '');
    if (trimmed.endsWith('/api')) return trimmed;
    if (trimmed.endsWith('/v1')) return trimmed.replace(/\/v1$/u, '/api');
    return `${trimmed}/api`;
}

/**
 * @param {string} apiBaseUrl
 * @returns {string}
 */
function openAIBaseUrlFromApiBaseUrl(apiBaseUrl) {
    return apiBaseUrl.replace(/\/api$/u, '/v1');
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseOllamaRows(raw) {
    const models = isRecord(raw) && Array.isArray(raw['models']) ? raw['models'] : Array.isArray(raw) ? raw : [];
    return models.filter(isRecord);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ollama catalog import failed';
}

/**
 * @param {unknown} text
 * @returns {Record<string, string | number | boolean>}
 */
function parseParametersText(text) {
    const value = stringValue(text);
    if (!value) return {};
    /** @type {Record<string, string | number | boolean>} */
    const parameters = {};
    for (const rawLine of value.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const [key, ...rest] = line.split(/\s+/u);
        const rawValue = rest.join(' ').trim();
        if (!key || !rawValue) continue;
        if (rawValue === 'true') parameters[key] = true;
        else if (rawValue === 'false') parameters[key] = false;
        else parameters[key] = finiteNumber(rawValue) ?? rawValue;
    }
    return parameters;
}

/**
 * @param {Record<string, unknown>} modelInfo
 * @param {Record<string, string | number | boolean>} parameters
 * @returns {number | null}
 */
function resolveContextLength(modelInfo, parameters) {
    const explicit = finiteNumber(parameters['num_ctx']);
    if (explicit !== null) return explicit;
    for (const [key, value] of Object.entries(modelInfo)) {
        if (key.endsWith('.context_length')) return finiteNumber(value);
    }
    return null;
}

/**
 * @param {string[]} capabilities
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromOllama(capabilities) {
    const set = new Set(capabilities.map((item) => item.toLowerCase()));
    /** @type {Record<string, boolean>} */
    const normalized = {};
    if (set.has('completion')) normalized['chat'] = true;
    if (set.has('vision')) normalized['vision'] = true;
    if (set.has('embedding') || set.has('embeddings')) normalized['embeddings'] = true;
    if (set.has('tools') || set.has('tool')) normalized['tools'] = true;
    return normalized;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['model']) ?? stringValue(row['name']);
    const details = isRecord(row['details']) ? row['details'] : {};
    const modelInfo = isRecord(row['model_info']) ? row['model_info'] : {};
    const parameters = parseParametersText(row['parameters']);
    const capabilities = capabilitiesFromOllama(stringArray(row['capabilities']));
    const modalities = normalizeModelModalities({
        input: capabilities['vision'] ? ['text', 'image'] : ['text'],
        output: ['text'],
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: resolveContextLength(modelInfo, parameters),
    });
    const aliases = normalizeModelAliases({ providerModel });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        family: details['family'],
        parameterSize: details['parameter_size'],
        quantization: details['quantization_level'],
    });
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(modalities).map(([key, value]) => ({ fieldPath: `modalities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'local' },
        { fieldPath: 'providerMetadata.ollama.digest', value: stringValue(row['digest']) },
        { fieldPath: 'providerMetadata.ollama.sizeBytes', value: finiteNumber(row['size']) },
        { fieldPath: 'providerMetadata.ollama.modifiedAt', value: stringValue(row['modified_at']) },
        { fieldPath: 'providerMetadata.ollama.format', value: stringValue(details['format']) },
        { fieldPath: 'providerMetadata.ollama.family', value: stringValue(details['family']) },
        { fieldPath: 'providerMetadata.ollama.families', value: stringArray(details['families']) },
        { fieldPath: 'providerMetadata.ollama.parameterSize', value: stringValue(details['parameter_size']) },
        { fieldPath: 'providerMetadata.ollama.quantizationLevel', value: stringValue(details['quantization_level']) },
        { fieldPath: 'providerMetadata.ollama.parentModel', value: stringValue(details['parent_model']) },
        { fieldPath: 'providerMetadata.ollama.parameters', value: Object.keys(parameters).length > 0 ? parameters : null },
        { fieldPath: 'providerMetadata.ollama.parametersText', value: stringValue(row['parameters']) },
        { fieldPath: 'providerMetadata.ollama.template', value: stringValue(row['template']) },
        { fieldPath: 'providerMetadata.ollama.license', value: stringValue(row['license']) },
        { fieldPath: 'providerMetadata.ollama.modelInfo', value: Object.keys(modelInfo).length > 0 ? modelInfo : null },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.owned_by', value: 'local' },
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.baseUrl]
 * @param {string} [options.accountScope]
 * @param {boolean} [options.verboseShow]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOllamaCatalogImporter(options = {}) {
    const apiBaseUrl = normalizeApiBaseUrl(options.baseUrl ?? OLLAMA_LOCAL_API_BASE_URL);
    const tagsUrl = `${apiBaseUrl}/tags`;
    const showUrl = `${apiBaseUrl}/show`;
    const openAIBaseUrl = openAIBaseUrlFromApiBaseUrl(apiBaseUrl);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'ollama-catalog',
        providerId: 'ollama-local',
        sourceKind: 'local_daemon',
        requiresAuth: false,
        url: tagsUrl,
        envRequirements: ['OLLAMA_BASE_URL', 'OLLAMA_HOST'],
        refreshPolicy: 'manual',
        ttlSeconds: 300,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Ollama catalog import');
            const tagsResponse = await fetchImpl(tagsUrl, { headers: { accept: 'application/json' } });
            if (!tagsResponse.ok) throw new Error(`Ollama /api/tags fetch failed with HTTP ${tagsResponse.status}`);
            const tagsPayload = await tagsResponse.json();
            const tagRows = parseOllamaRows(tagsPayload);
            /** @type {Record<string, unknown>[]} */
            const models = [];
            /** @type {Array<{ model: string; status: number }>} */
            const showErrors = [];
            for (const tagRow of tagRows) {
                const providerModel = stringValue(tagRow['model']) ?? stringValue(tagRow['name']);
                if (!providerModel) {
                    models.push(tagRow);
                    continue;
                }
                const showResponse = await fetchImpl(showUrl, {
                    method: 'POST',
                    headers: { accept: 'application/json', 'content-type': 'application/json' },
                    body: JSON.stringify({ model: providerModel, verbose: options.verboseShow ?? false }),
                });
                if (!showResponse.ok) {
                    showErrors.push({ model: providerModel, status: showResponse.status });
                    models.push(tagRow);
                    continue;
                }
                const showPayload = await showResponse.json();
                const showRecord = isRecord(showPayload) ? showPayload : {};
                models.push({
                    ...tagRow,
                    ...showRecord,
                    model: providerModel,
                    name: stringValue(tagRow['name']) ?? providerModel,
                    details: {
                        ...(isRecord(tagRow['details']) ? tagRow['details'] : {}),
                        ...(isRecord(showRecord['details']) ? showRecord['details'] : {}),
                    },
                });
            }
            return showErrors.length > 0 ? { models, showErrors } : { models };
        },
        parseRows: parseOllamaRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'ollama-catalog';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['model']) ?? stringValue(record['name']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'ollama-local',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'local_daemon',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'ollama-catalog';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['model']) ?? stringValue(record['name']);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'ollama-local',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'local_daemon',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible',
                            runtimeKind: 'local',
                            localPrivate: true,
                            nativeApiBaseUrl: apiBaseUrl,
                            openAICompatibleBaseUrl: openAIBaseUrl,
                            digest: stringValue(record['digest']),
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'ollama-catalog';
            const enabledModels = rows
                .map((row) => (isRecord(row) ? stringValue(row['model']) ?? stringValue(row['name']) : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/api/tags+/api/show',
                    semantics: 'locally_installed_models',
                    runtimeKind: 'local',
                    localPrivate: true,
                    nativeApiBaseUrl: apiBaseUrl,
                    openAICompatibleBaseUrl: openAIBaseUrl,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `ollama-local:${options.accountScope ?? apiBaseUrl}:${sourceId}`,
                    providerId: 'ollama-local',
                    accountScope: options.accountScope ?? apiBaseUrl,
                    sourceId,
                    sourceKind: 'local_daemon',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
        toFailureAccountOverlays(error, context) {
            const sourceId = stringValue(context.source['id']) ?? 'ollama-catalog';
            const controls = normalizeAccountOverlayControls({
                providerMetadata: {
                    endpoint: '/api/tags',
                    semantics: 'local_daemon_failed',
                    catalogImportStatus: 'failed',
                    localDaemonReachable: false,
                    disabled: true,
                    failureMessage: errorMessage(error),
                    openAICompatibleBaseUrl: openAIBaseUrl,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `ollama-local:${options.accountScope ?? apiBaseUrl}:${sourceId}:failure`,
                    providerId: 'ollama-local',
                    accountScope: options.accountScope ?? apiBaseUrl,
                    sourceId,
                    sourceKind: 'local_daemon',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
