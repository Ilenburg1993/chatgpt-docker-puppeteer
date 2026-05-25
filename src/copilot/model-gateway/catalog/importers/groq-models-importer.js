// @ts-check
/**
 * Groq authenticated `/openai/v1/models` catalog importer.
 *
 * Groq's models endpoint is OpenAI-compatible but includes useful Groq-specific fields such as `active`,
 * `context_window` and `public_apps`. This importer enriches the list with per-model retrieve calls.
 *
 * @module copilot/model-gateway/catalog/importers/groq-models-importer
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

export const GROQ_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_MODELS_CATALOG_URL = `${GROQ_OPENAI_BASE_URL}/models`;

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
function parseGroqRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
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
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromModelId(providerModel) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (lower.includes('whisper')) capabilities['asr'] = true;
    else {
        capabilities['chat'] = true;
        capabilities['streaming'] = true;
        capabilities['tools'] = true;
        capabilities['jsonMode'] = true;
    }
    if (lower.includes('gpt-oss') || lower.includes('qwen3') || lower.includes('deepseek-r1')) {
        capabilities['reasoning'] = true;
    }
    if (lower.includes('compound')) {
        capabilities['webSearch'] = true;
        capabilities['codeExecution'] = true;
    }
    return capabilities;
}

/**
 * @param {string} providerModel
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesFromModelId(providerModel) {
    return providerModel.toLowerCase().includes('whisper')
        ? normalizeModelModalities({ input: ['audio'], output: ['text'] })
        : normalizeModelModalities({ input: ['text'], output: ['text'] });
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    const lifecycle = normalizeModelLifecycle({
        created: row['created'],
        lifecycle: row['active'] === false ? 'inactive' : 'active',
        providerModel,
    });
    const aliases = normalizeModelAliases({ providerModel });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['context_window'],
        maxOutputTokens: row['max_completion_tokens'],
    });
    const capabilities = providerModel ? capabilitiesFromModelId(providerModel) : {};
    const modalities = providerModel ? modalitiesFromModelId(providerModel) : { input: ['text'], output: ['text'] };
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(modalities).map(([key, value]) => ({ fieldPath: `modalities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? 'groq' },
        { fieldPath: 'providerMetadata.groq.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.groq.active', value: typeof row['active'] === 'boolean' ? row['active'] : null },
        { fieldPath: 'providerMetadata.groq.contextWindow', value: finiteNumber(row['context_window']) },
        { fieldPath: 'providerMetadata.groq.maxCompletionTokens', value: finiteNumber(row['max_completion_tokens']) },
        { fieldPath: 'providerMetadata.groq.publicApps', value: row['public_apps'] ?? null },
        { fieldPath: 'providerMetadata.groq.batchEndpoint', value: '/openai/v1/batches' },
        { fieldPath: 'openai.created', value: finiteNumber(row['created']) },
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) ?? 'groq' },
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
 * @param {boolean} [options.includeModelDetails]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createGroqModelsImporter(options = {}) {
    const url = options.url ?? GROQ_MODELS_CATALOG_URL;
    const includeModelDetails = options.includeModelDetails ?? true;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'groq-models',
        providerId: 'groq',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['GROQ_API_KEY', 'GROQ_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Groq catalog import');
            if (!options.apiKey) throw new Error('GROQ_API_KEY is required for Groq catalog import');
            const headers = { accept: 'application/json', authorization: `Bearer ${options.apiKey}` };
            const response = await fetchImpl(url, { headers });
            if (!response.ok) throw new Error(`Groq models fetch failed with HTTP ${response.status}`);
            const payload = await response.json();
            const rows = parseGroqRows(payload);
            if (!includeModelDetails) return payload;
            /** @type {Record<string, unknown>[]} */
            const data = [];
            /** @type {Array<{ model: string; status: number }>} */
            const retrieveErrors = [];
            for (const row of rows) {
                const providerModel = stringValue(row['id']);
                if (!providerModel) {
                    data.push(row);
                    continue;
                }
                const detailResponse = await fetchImpl(retrieveUrl(url, providerModel), { headers });
                if (!detailResponse.ok) {
                    retrieveErrors.push({ model: providerModel, status: detailResponse.status });
                    data.push(row);
                    continue;
                }
                const detail = await detailResponse.json();
                data.push(isRecord(detail) ? { ...row, ...detail } : row);
            }
            return retrieveErrors.length > 0 ? { object: 'list', data, retrieveErrors } : { object: 'list', data };
        },
        parseRows: parseGroqRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'groq-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'groq',
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
            const sourceId = stringValue(context.source['id']) ?? 'groq-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                const capabilities = capabilitiesFromModelId(providerModel);
                return [
                    createModelRouteOption({
                        providerId: 'groq',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible',
                            openAICompatibleBaseUrl: GROQ_OPENAI_BASE_URL,
                            active: record['active'] !== false,
                            supportsBatch: record['active'] !== false && capabilities['chat'] === true,
                            supportsTools: capabilities['tools'] === true,
                            supportsStreaming: capabilities['streaming'] === true,
                            batchEndpoint: '/openai/v1/batches',
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'groq-models';
            const enabledModels = rows
                .filter((row) => (isRecord(row) ? row['active'] !== false : false))
                .map((row) => stringValue(isRecord(row) ? row['id'] : null))
                .filter((model) => model !== null);
            const blockedModels = rows
                .filter((row) => (isRecord(row) ? row['active'] === false : false))
                .map((row) => stringValue(isRecord(row) ? row['id'] : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                blockedModels,
                providerMetadata: {
                    endpoint: '/openai/v1/models',
                    retrieveEndpoint: '/openai/v1/models/{model}',
                    batchEndpoint: '/openai/v1/batches',
                    semantics: 'account_visible_models',
                    openAICompatible: true,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `groq:${options.accountScope ?? 'default'}:${options.secretRef ?? 'GROQ_API_KEY'}:${sourceId}`,
                    providerId: 'groq',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'GROQ_API_KEY',
                    sourceId,
                    sourceKind: 'authenticated_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    blockedModels: controls.blockedModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
