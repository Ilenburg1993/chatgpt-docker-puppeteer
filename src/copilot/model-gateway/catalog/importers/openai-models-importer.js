// @ts-check
/**
 * OpenAI authenticated `/v1/models` catalog importer.
 *
 * The OpenAI models endpoint is identity-oriented. It is useful as an account-scoped availability source; richer
 * capabilities still need docs, static seeds and runtime probes.
 *
 * @module copilot/model-gateway/catalog/importers/openai-models-importer
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

export const OPENAI_MODELS_CATALOG_URL = 'https://api.openai.com/v1/models';

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
function parseOpenAiRows(raw) {
    if (!isRecord(raw) || !Array.isArray(raw['data'])) return [];
    return raw['data'].filter(isRecord);
}

/**
 * @param {string} providerModel
 * @returns {{ family: string; wireApi: string; tier: string | null }}
 */
function modelFamily(providerModel) {
    const lower = providerModel.toLowerCase();
    if (lower.startsWith('text-embedding') || lower.includes('embedding')) {
        return { family: 'embedding', wireApi: 'openai_embeddings', tier: null };
    }
    if (lower.startsWith('whisper') || lower.includes('transcribe')) {
        return { family: 'audio', wireApi: 'openai_audio_transcriptions', tier: 'asr' };
    }
    if (lower.startsWith('tts') || lower.includes('speech')) {
        return { family: 'audio', wireApi: 'openai_audio_speech', tier: 'tts' };
    }
    if (lower.startsWith('dall-e') || lower.startsWith('gpt-image')) {
        return { family: 'image', wireApi: 'openai_images', tier: null };
    }
    if (lower.startsWith('o') || lower.startsWith('gpt-5') || lower.includes('reasoning')) {
        return { family: 'reasoning', wireApi: 'openai_responses', tier: null };
    }
    return { family: 'chat', wireApi: 'openai_responses', tier: null };
}

/**
 * @param {string} providerModel
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromModelId(providerModel) {
    const lower = providerModel.toLowerCase();
    const family = modelFamily(providerModel);
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (family.family === 'embedding') capabilities['embeddings'] = true;
    if (family.tier === 'asr') capabilities['asr'] = true;
    if (family.tier === 'tts') capabilities['tts'] = true;
    if (family.family === 'image') capabilities['imageGeneration'] = true;
    if (family.family === 'reasoning') capabilities['reasoning'] = true;
    if (family.family === 'chat' || family.family === 'reasoning') {
        capabilities['chat'] = true;
        capabilities['streaming'] = true;
        capabilities['tools'] = true;
        capabilities['structuredOutputs'] = true;
    }
    if (lower.includes('vision') || lower.includes('gpt-4o') || lower.includes('gpt-5')) capabilities['vision'] = true;
    return capabilities;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(record) {
    const providerModel = stringValue(record['id']);
    if (!providerModel) return [];
    const aliases = normalizeModelAliases({ providerModel });
    const lifecycle = normalizeModelLifecycle({ created: record['created'], providerModel });
    const family = modelFamily(providerModel);
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        family: family.family === 'chat' || family.family === 'reasoning' ? null : family.family,
        tier: family.tier,
    });
    const capabilities = capabilitiesFromModelId(providerModel);
    return [
        { fieldPath: 'displayName', value: providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        { fieldPath: 'aliases.openaiModelId', value: providerModel },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: stringValue(record['owned_by']) },
        { fieldPath: 'providerMetadata.openai.object', value: stringValue(record['object']) },
        { fieldPath: 'providerMetadata.openai.family', value: family.family },
        { fieldPath: 'providerMetadata.openai.wireApi', value: family.wireApi },
        { fieldPath: 'providerMetadata.openai.tier', value: family.tier },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.created', value: finiteNumber(record['created']) },
        { fieldPath: 'openai.owned_by', value: stringValue(record['owned_by']) ?? 'openai' },
    ].filter((item) => item.value !== null && item.value !== undefined);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.organizationIdRef]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenAIModelsImporter(options = {}) {
    const url = options.url ?? OPENAI_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'openai-models',
        providerId: 'openai',
        sourceKind: 'authenticated_api',
        requiresAuth: true,
        url,
        envRequirements: ['OPENAI_API_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenAI catalog import');
            if (!options.apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI catalog import');
            const response = await fetchImpl(url, {
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${options.apiKey}`,
                },
            });
            if (!response.ok) throw new Error(`OpenAI models fetch failed with HTTP ${response.status}`);
            return response.json();
        },
        parseRows: parseOpenAiRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openai-models';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'openai',
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
            const sourceId = stringValue(context.source['id']) ?? 'openai-models';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                const family = modelFamily(providerModel);
                const capabilities = capabilitiesFromModelId(providerModel);
                return [
                    createModelRouteOption({
                        providerId: 'openai',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'authenticated_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        normalizedPolicy: {
                            routeLayer: 'direct_provider',
                            wireApi: family.wireApi,
                            family: family.family,
                            supportsResponses: family.wireApi === 'openai_responses',
                            supportsTools: capabilities['tools'] === true,
                            supportsStreaming: capabilities['streaming'] === true,
                        },
                    }),
                ];
            });
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openai-models';
            const enabledModels = rows
                .map((row) => stringValue(isRecord(row) ? row['id'] : null))
                .filter((id) => id !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/v1/models',
                    semantics: 'account_visible_models',
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `openai:${options.accountScope ?? 'default'}:${options.secretRef ?? 'OPENAI_API_KEY'}:${sourceId}`,
                    providerId: 'openai',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'OPENAI_API_KEY',
                    organizationIdRef: options.organizationIdRef,
                    sourceId,
                    sourceKind: 'authenticated_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    quota: controls.quota,
                    rateLimits: controls.rateLimits,
                    spendingLimits: controls.spendingLimits,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
