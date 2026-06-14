// @ts-check
/**
 * OpenAI official docs catalog seed importer.
 *
 * `/v1/models` is account-scoped and authoritative for visibility. The public docs add richer model-family metadata
 * such as docs URLs, pricing hints and lifecycle words. This importer keeps that evidence separate from access.
 *
 * Sources checked 2026-05-26:
 * - https://developers.openai.com/docs/models
 * - https://developers.openai.com/docs/pricing
 * - https://developers.openai.com/docs/models/compare
 *
 * @module copilot/model-gateway/catalog/importers/openai-docs-models-importer
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createModelMetadataEvidence } from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeOpenAICompatibleModelCapabilities,
} from '../normalizers.js';
import { htmlText } from './html-docs-parser.js';
import { readCatalogResponseText } from './response-body.js';

export const OPENAI_MODELS_DOCS_URL = 'https://developers.openai.com/docs/models';
export const OPENAI_PRICING_URL = 'https://developers.openai.com/docs/pricing';
export const OPENAI_MODEL_COMPARE_URL = 'https://developers.openai.com/docs/models/compare';

const MODEL_ID_PATTERN =
    /\b(?:gpt-[a-z0-9][a-z0-9_.-]*(?:-[a-z0-9][a-z0-9_.-]*)?|o[134](?:-[a-z0-9][a-z0-9_.-]*)?|text-embedding-[a-z0-9_.-]+|omni-moderation-[a-z0-9_.-]+|computer-use-preview|whisper-1|tts-1(?:-hd)?)\b/giu;

/**
 * @typedef {{ id: string; docsText: string; pricingText: string; compareText: string }} OpenAiDocsModelRow
 */

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
 * @param {string} text
 * @returns {string}
 */
function normalizeDocsText(text) {
    return htmlText(text, { decodeBeforeStrip: true, unescapeJsStrings: true });
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function modelIdsFromText(text) {
    return [...new Set([...text.matchAll(MODEL_ID_PATTERN)].map((match) => match[0].toLowerCase()))].sort();
}

/**
 * @param {string} text
 * @param {string} id
 * @param {number} [radius]
 * @returns {string}
 */
function textWindow(text, id, radius = 900) {
    const index = text.toLowerCase().indexOf(id.toLowerCase());
    if (index < 0) return '';
    return text.slice(Math.max(0, index - radius), Math.min(text.length, index + id.length + radius));
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function priceFromText(text) {
    const match = text.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)/u);
    if (!match?.[1]) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {string} window
 * @returns {Record<string, number>}
 */
function pricingFromWindow(window) {
    const input = window.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*)?(?:1M|million)?\s*(?:input|in\b|prompt)/iu)?.[0];
    const output = window.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*)?(?:1M|million)?\s*(?:output|out\b|completion)/iu)?.[0];
    const cacheRead = window.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*)?(?:1M|million)?\s*(?:cached|cache read)/iu)?.[0];
    /** @type {Record<string, number>} */
    const pricing = {};
    const inputPrice = input ? priceFromText(input) : null;
    const outputPrice = output ? priceFromText(output) : null;
    const cacheReadPrice = cacheRead ? priceFromText(cacheRead) : null;
    if (inputPrice !== null) pricing['inputUsdPerMillion'] = inputPrice;
    if (outputPrice !== null) pricing['outputUsdPerMillion'] = outputPrice;
    if (cacheReadPrice !== null) pricing['cacheReadUsdPerMillion'] = cacheReadPrice;
    return pricing;
}

/**
 * @param {string} id
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesForModel(id) {
    if (id.startsWith('text-embedding-')) return { input: ['text'], output: ['embedding'] };
    if (id.startsWith('tts-')) return { input: ['text'], output: ['audio'] };
    if (id.startsWith('whisper-')) return { input: ['audio'], output: ['text'] };
    if (id.startsWith('omni-moderation-')) return { input: ['text', 'image'], output: ['text'] };
    return normalizeModelModalities({ input: ['text'], output: ['text'] });
}

/**
 * @param {string} id
 * @param {string} docsWindow
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(id, docsWindow) {
    const supportedParameters = [];
    if (/gpt|^o[134]/u.test(id)) supportedParameters.push('tools', 'tool_choice', 'response_format', 'stream');
    if (/gpt-[5o]|^o[134]/u.test(id)) supportedParameters.push('reasoning_effort');
    if (/search/iu.test(docsWindow)) supportedParameters.push('web_search');
    return normalizeOpenAICompatibleModelCapabilities({
        supportedParameters,
        inputModalities: modalitiesForModel(id).input,
        outputModalities: modalitiesForModel(id).output,
    });
}

/**
 * @param {OpenAiDocsModelRow} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function evidenceValues(row) {
    const docsWindow = textWindow(row.docsText, row.id);
    const pricingWindow = textWindow(row.pricingText, row.id, 1200);
    const compareWindow = textWindow(row.compareText, row.id, 1200);
    const modalities = modalitiesForModel(row.id);
    const capabilities = capabilitiesForModel(row.id, `${docsWindow} ${compareWindow}`);
    const aliases = normalizeModelAliases({ providerModel: row.id, canonicalSlug: row.id });
    const lifecycle = normalizeModelLifecycle({
        providerModel: row.id,
        lifecycle: /deprecated/iu.test(`${docsWindow} ${compareWindow}`) ? 'deprecated' : 'active',
    });
    const identityTraits = normalizeModelIdentityTraits({ providerModel: row.id });
    const pricing = pricingFromWindow(pricingWindow);
    const values = [
        { fieldPath: 'displayName', value: row.id },
        { fieldPath: 'providerMetadata.openai.docsUrl', value: OPENAI_MODELS_DOCS_URL },
        { fieldPath: 'providerMetadata.openai.pricingUrl', value: OPENAI_PRICING_URL },
        { fieldPath: 'providerMetadata.openai.compareUrl', value: OPENAI_MODEL_COMPARE_URL },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(pricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
    ];
    return values.filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        if (isRecord(item.value) && Object.keys(item.value).length === 0) return false;
        return true;
    });
}

/**
 * @param {unknown} raw
 * @returns {OpenAiDocsModelRow[]}
 */
export function parseOpenAiDocsRows(raw) {
    const record = isRecord(raw) ? raw : {};
    const docsText = normalizeDocsText(String(record['models'] ?? ''));
    const pricingText = normalizeDocsText(String(record['pricing'] ?? ''));
    const compareText = normalizeDocsText(String(record['compare'] ?? ''));
    const ids = [...new Set([...modelIdsFromText(docsText), ...modelIdsFromText(pricingText), ...modelIdsFromText(compareText)])].sort();
    return ids.map((id) => ({ id, docsText, pricingText, compareText }));
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.modelsUrl]
 * @param {string} [options.pricingUrl]
 * @param {string} [options.compareUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenAiDocsModelsImporter(options = {}) {
    const modelsUrl = options.modelsUrl ?? OPENAI_MODELS_DOCS_URL;
    const pricingUrl = options.pricingUrl ?? OPENAI_PRICING_URL;
    const compareUrl = options.compareUrl ?? OPENAI_MODEL_COMPARE_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'openai-docs-models',
        providerId: 'openai',
        sourceKind: 'official_docs',
        requiresAuth: false,
        url: modelsUrl,
        refreshPolicy: 'scheduled',
        ttlSeconds: 86_400,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenAI docs catalog import');
            /** @param {string} url */
            const fetchText = async (url) => {
                const response = await fetchImpl(url, {
                    headers: {
                        accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
                        'user-agent': 'model-gateway-catalog-importer/1.0',
                    },
                });
                if (!response.ok) throw new Error(`OpenAI docs fetch failed for ${url} with HTTP ${response.status}`);
                return readCatalogResponseText(response, { label: `OpenAI docs ${url}` });
            };
            const [models, pricing, compare] = await Promise.all([fetchText(modelsUrl), fetchText(pricingUrl), fetchText(compareUrl)]);
            return { models, pricing, compare };
        },
        parseRows: parseOpenAiDocsRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openai-docs-models';
            return rows.flatMap((row) => {
                const record = /** @type {OpenAiDocsModelRow} */ (row);
                return evidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${record.id}:${item.fieldPath}`,
                        providerId: 'openai',
                        providerModel: record.id,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'official_docs',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
    };
}
