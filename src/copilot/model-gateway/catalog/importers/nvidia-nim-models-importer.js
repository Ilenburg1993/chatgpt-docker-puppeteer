// @ts-check
/**
 * NVIDIA NIM hosted/self-hosted models importer.
 *
 * NVIDIA hosted NIM uses an OpenAI-compatible `/v1/models` endpoint, while self-hosted NIMs also expose management
 * endpoints such as `/v1/metadata`, `/v1/version`, `/v1/health/ready`, `/v1/metrics`, `/v1/license` and `/v1/manifest`.
 *
 * @module copilot/model-gateway/catalog/importers/nvidia-nim-models-importer
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

export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_NIM_MODELS_CATALOG_URL = `${NVIDIA_NIM_BASE_URL}/models`;
export const NVIDIA_NIM_MANAGEMENT_ENDPOINTS = Object.freeze([
    '/v1/health/ready',
    '/v1/metadata',
    '/v1/version',
    '/v1/metrics',
    '/v1/license',
    '/v1/manifest',
]);

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
function parseNvidiaRows(raw) {
    const data = isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : Array.isArray(raw) ? raw : [];
    return data.filter(isRecord);
}

/**
 * @param {string} providerModel
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromModelId(providerModel) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = { chat: true, streaming: true };
    if (lower.includes('embed')) capabilities['embeddings'] = true;
    if (lower.includes('rerank')) capabilities['rerank'] = true;
    if (lower.includes('vl') || lower.includes('vision') || lower.includes('llava')) capabilities['vision'] = true;
    if (lower.includes('gpt-oss') || lower.includes('nemotron') || lower.includes('deepseek') || lower.includes('qwen')) {
        capabilities['reasoning'] = true;
    }
    return capabilities;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    const aliases = normalizeModelAliases({ providerModel });
    const lifecycle = normalizeModelLifecycle({ created: finiteNumber(row['created']), providerModel });
    const capabilities = providerModel ? capabilitiesFromModelId(providerModel) : {};
    const identityTraits = normalizeModelIdentityTraits({ providerModel });
    const values = [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(row['owned_by']) ?? 'nvidia' },
        { fieldPath: 'providerMetadata.nvidia.object', value: stringValue(row['object']) },
        { fieldPath: 'providerMetadata.nvidia.managementEndpoints', value: [...NVIDIA_NIM_MANAGEMENT_ENDPOINTS] },
        { fieldPath: 'providerMetadata.nvidia.hostedBaseUrl', value: NVIDIA_NIM_BASE_URL },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.created', value: finiteNumber(row['created']) },
        { fieldPath: 'openai.owned_by', value: stringValue(row['owned_by']) ?? 'nvidia' },
    ];
    return values.filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.baseUrl]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createNvidiaNimModelsImporter(options = {}) {
    const baseUrl = (options.baseUrl ?? NVIDIA_NIM_BASE_URL).replace(/\/$/u, '');
    const url = options.url ?? `${baseUrl}/models`;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'nvidia-nim-models',
        providerId: 'nvidia-nim',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['NVIDIA_API_KEY', 'NVIDIA_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for NVIDIA NIM catalog import');
            if (!options.apiKey) throw new Error('NVIDIA_API_KEY is required for NVIDIA NIM catalog import');
            const response = await fetchImpl(url, {
                headers: { accept: 'application/json', authorization: `Bearer ${options.apiKey}` },
            });
            if (!response.ok) throw new Error(`NVIDIA NIM models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseNvidiaRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'nvidia-nim-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'nvidia-nim',
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
            const sourceId = stringValue(context.source['id']) ?? 'nvidia-nim-models';
            return rows.flatMap((row) => {
                const providerModel = stringValue(isRecord(row) ? row['id'] : null);
                if (!providerModel) return [];
                return [
                    createModelRouteOption({
                        providerId: 'nvidia-nim',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'openai_compatible',
                            openAICompatibleBaseUrl: baseUrl,
                            managementEndpoints: [...NVIDIA_NIM_MANAGEMENT_ENDPOINTS],
                            hostedOrSelfHosted: baseUrl === NVIDIA_NIM_BASE_URL ? 'hosted' : 'self_hosted',
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'nvidia-nim-models';
            const enabledModels = rows.map((row) => stringValue(isRecord(row) ? row['id'] : null)).filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'account_visible_models',
                    hostedOrSelfHosted: baseUrl === NVIDIA_NIM_BASE_URL ? 'hosted' : 'self_hosted',
                    managementEndpoints: [...NVIDIA_NIM_MANAGEMENT_ENDPOINTS],
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `nvidia-nim:${options.accountScope ?? 'default'}:${options.secretRef ?? 'NVIDIA_API_KEY'}:${sourceId}`,
                    providerId: 'nvidia-nim',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'NVIDIA_API_KEY',
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
