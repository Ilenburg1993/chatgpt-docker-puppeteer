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
} from '../contracts.js';

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
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
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
                const values = [
                    { fieldPath: 'displayName', value: providerModel },
                    { fieldPath: 'aliases.openaiModelId', value: providerModel },
                    { fieldPath: 'lifecycle.createdAt', value: unixSecondsToIso(record['created']) },
                    { fieldPath: 'providerMetadata.ownedBy', value: stringValue(record['owned_by']) },
                ].filter((item) => item.value !== null && item.value !== undefined);
                return values.map((item) =>
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
    };
}
