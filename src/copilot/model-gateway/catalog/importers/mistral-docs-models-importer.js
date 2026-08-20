// @ts-check
/**
 * Mistral official docs catalog seed importer.
 *
 * `/v1/models` is account-visible and remains the access/overlay source. Public Mistral docs add model cards, context
 * limitations, pricing snippets and endpoint hints before any key-scoped collection or runtime proof.
 *
 * Sources checked 2026-05-26:
 *
 * - https://docs.mistral.ai/models/overview
 * - https://docs.mistral.ai/resources/known-limitations
 * - https://docs.mistral.ai/api/endpoint/models
 *
 * @module copilot/model-gateway/catalog/importers/mistral-docs-models-importer
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createModelMetadataEvidence } from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelTokenLimits,
} from '../normalizers.js';
import { htmlText } from './html-docs-parser.js';
import { readCatalogResponseText } from './response-body.js';

export const MISTRAL_MODELS_DOCS_URL = 'https://docs.mistral.ai/models/overview';
export const MISTRAL_KNOWN_LIMITATIONS_DOCS_URL = 'https://docs.mistral.ai/resources/known-limitations';
export const MISTRAL_MODELS_API_DOCS_URL = 'https://docs.mistral.ai/api/endpoint/models';

const MISTRAL_MODEL_ID_PATTERN =
    /\b(?:mistral|ministral|magistral|codestral|devstral|pixtral|voxtral|ocr)[a-z0-9_.-]*-[0-9][a-z0-9_.-]*\b/giu;

/**
 * @typedef {{ id: string; docsText: string; limitsText: string; apiText: string }} MistralDocsModelRow
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
    return [...new Set([...text.matchAll(MISTRAL_MODEL_ID_PATTERN)].map((match) => match[0].toLowerCase()))].sort();
}

/**
 * @param {string} text
 * @param {string} needle
 * @param {number} [radius]
 * @returns {string}
 */
function textWindow(text, needle, radius = 1000) {
    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return '';
    return text.slice(Math.max(0, index - radius), Math.min(text.length, index + needle.length + radius));
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function compactTokenLimit(value) {
    const match = value.replace(/,/gu, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/iu);
    if (!match?.[1]) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(amount * multiplier);
}

/**
 * @param {string} value
 * @returns {number[]}
 */
function pricesFromText(value) {
    return [...value.matchAll(/\$+\s*([0-9]+(?:\.[0-9]+)?)/gu)]
        .map((match) => Number(match[1]))
        .filter(Number.isFinite);
}

/**
 * @param {string} providerModel
 * @returns {{ family: string; tier: string | null; generation: string | null; displayName: string }}
 */
function mistralModelTraits(providerModel) {
    const family = providerModel.split('-')[0] ?? 'mistral';
    const lower = providerModel.toLowerCase();
    const tier = lower.includes('large')
        ? 'large'
        : lower.includes('medium')
          ? 'medium'
          : lower.includes('small')
            ? 'small'
            : lower.includes('embed')
              ? 'embed'
              : null;
    const generation =
        lower.match(/-(\d{2,4}(?:\d{2})?)$/u)?.[1] ?? lower.match(/-(\d+(?:-\d+)?)$/u)?.[1]?.replace('-', '.') ?? null;
    const displayName = providerModel
        .split('-')
        .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
        .join(' ');
    return { family, tier, generation, displayName };
}

/**
 * @param {string} providerModel
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesForModel(providerModel) {
    const lower = providerModel.toLowerCase();
    if (lower.includes('embed')) return normalizeModelModalities({ input: ['text'], output: ['embedding'] });
    if (lower.includes('ocr')) return normalizeModelModalities({ input: ['document', 'image'], output: ['text'] });
    if (lower.includes('voxtral')) return normalizeModelModalities({ input: ['audio', 'text'], output: ['text'] });
    if (
        lower.includes('pixtral') ||
        lower.includes('ministral') ||
        lower.includes('large') ||
        lower.includes('medium')
    ) {
        return normalizeModelModalities({ input: ['text', 'image'], output: ['text'] });
    }
    return normalizeModelModalities({ input: ['text'], output: ['text'] });
}

/**
 * @param {string} providerModel
 * @param {string} combinedWindow
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(providerModel, combinedWindow) {
    const lower = providerModel.toLowerCase();
    const explicitToolCalling = /\b(?:function[- ]calling|tool[- ]calling|tool use|function calls?)\b/iu.test(
        combinedWindow,
    );
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (lower.includes('embed')) capabilities['embeddings'] = true;
    else if (lower.includes('ocr')) capabilities['ocr'] = true;
    else if (lower.includes('moderation')) capabilities['moderation'] = true;
    else if (lower.includes('voxtral')) {
        capabilities['chat'] = true;
        capabilities['streaming'] = true;
        if (explicitToolCalling) capabilities['tools'] = true;
    } else {
        capabilities['chat'] = true;
        capabilities['streaming'] = true;
        capabilities['tools'] = true;
        capabilities['jsonMode'] = true;
    }
    if (lower.includes('codestral') || lower.includes('devstral')) capabilities['codeCompletion'] = true;
    if (lower.includes('magistral') || /reasoning/iu.test(combinedWindow)) capabilities['reasoning'] = true;
    if (/vision|image|multimodal/iu.test(combinedWindow)) capabilities['vision'] = true;
    if (/structured outputs/iu.test(combinedWindow)) capabilities['structuredOutputs'] = true;
    return capabilities;
}

/**
 * @param {string} providerModel
 * @param {string} combinedWindow
 * @returns {Record<string, number>}
 */
function tokenLimitsForModel(providerModel, combinedWindow) {
    const limitFromWindow =
        combinedWindow.match(/context\s+(?:length|window)?\s*([0-9.,]+\s*[kmb]?)/iu)?.[1] ??
        combinedWindow.match(/([0-9.,]+\s*[kmb]?)\s+context/iu)?.[1];
    const lower = providerModel.toLowerCase();
    const inferred =
        lower.includes('large') || lower.includes('pixtral') || lower.includes('ministral')
            ? 131_072
            : lower.includes('small') || lower.includes('codestral')
              ? 32_768
              : null;
    return normalizeModelTokenLimits({ contextWindowTokens: compactTokenLimit(limitFromWindow ?? '') ?? inferred });
}

/**
 * @param {string} combinedWindow
 * @returns {Record<string, number>}
 */
function pricingFromWindow(combinedWindow) {
    const prices = pricesFromText(combinedWindow);
    /** @type {Record<string, number>} */
    const pricing = {};
    if (prices[0] !== undefined) pricing['inputUsdPerMillion'] = prices[0];
    if (prices[1] !== undefined) pricing['outputUsdPerMillion'] = prices[1];
    return pricing;
}

/**
 * @param {MistralDocsModelRow} row
 * @returns {{ fieldPath: string; value: unknown }[]}
 */
function evidenceValues(row) {
    const traits = mistralModelTraits(row.id);
    const docsWindow = textWindow(row.docsText, row.id, 1400) || textWindow(row.docsText, traits.displayName, 1400);
    const limitsWindow = textWindow(row.limitsText, traits.family, 900) || textWindow(row.limitsText, row.id, 900);
    const combinedWindow = `${docsWindow} ${limitsWindow} ${row.apiText}`;
    const aliases = normalizeModelAliases({ providerModel: row.id, canonicalSlug: row.id });
    const lifecycle = normalizeModelLifecycle({
        providerModel: row.id,
        lifecycle: /deprecated|legacy/iu.test(combinedWindow) ? 'deprecated' : 'active',
    });
    const modalities = modalitiesForModel(row.id);
    const capabilities = capabilitiesForModel(row.id, combinedWindow);
    const tokenLimits = tokenLimitsForModel(row.id, combinedWindow);
    const pricing = pricingFromWindow(docsWindow);
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row.id,
        displayName: traits.displayName,
        family: traits.family,
        tier: traits.tier,
        generation: traits.generation,
    });
    const values = [
        { fieldPath: 'displayName', value: traits.displayName },
        { fieldPath: 'providerMetadata.mistral.docsUrl', value: MISTRAL_MODELS_DOCS_URL },
        { fieldPath: 'providerMetadata.mistral.knownLimitationsUrl', value: MISTRAL_KNOWN_LIMITATIONS_DOCS_URL },
        { fieldPath: 'providerMetadata.mistral.modelsApiDocsUrl', value: MISTRAL_MODELS_API_DOCS_URL },
        { fieldPath: 'providerMetadata.mistral.family', value: traits.family },
        { fieldPath: 'providerMetadata.mistral.tier', value: traits.tier },
        { fieldPath: 'providerMetadata.mistral.generation', value: traits.generation },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(tokenLimits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(pricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        ...Object.entries(identityTraits).map(([key, value]) => ({
            fieldPath: `providerMetadata.modelTraits.${key}`,
            value,
        })),
        { fieldPath: 'openai.owned_by', value: 'mistral' },
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
 * @returns {MistralDocsModelRow[]}
 */
export function parseMistralDocsRows(raw) {
    const record = isRecord(raw) ? raw : {};
    const docsText = normalizeDocsText(String(record['models'] ?? ''));
    const limitsText = normalizeDocsText(String(record['limits'] ?? ''));
    const apiText = normalizeDocsText(String(record['api'] ?? ''));
    const ids = [
        ...new Set([...modelIdsFromText(docsText), ...modelIdsFromText(limitsText), ...modelIdsFromText(apiText)]),
    ].sort();
    return ids.map((id) => ({ id, docsText, limitsText, apiText }));
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.modelsUrl]
 * @param {string} [options.limitsUrl]
 * @param {string} [options.apiDocsUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createMistralDocsModelsImporter(options = {}) {
    const modelsUrl = options.modelsUrl ?? MISTRAL_MODELS_DOCS_URL;
    const limitsUrl = options.limitsUrl ?? MISTRAL_KNOWN_LIMITATIONS_DOCS_URL;
    const apiDocsUrl = options.apiDocsUrl ?? MISTRAL_MODELS_API_DOCS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'mistral-docs-models',
        providerId: 'mistral',
        sourceKind: 'official_docs',
        requiresAuth: false,
        url: modelsUrl,
        refreshPolicy: 'scheduled',
        ttlSeconds: 86_400,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function')
                throw new Error('fetch is unavailable for Mistral docs catalog import');
            /** @param {string} url */
            const fetchText = async (url) => {
                const response = await fetchImpl(url, {
                    headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
                });
                if (!response.ok) throw new Error(`Mistral docs fetch failed for ${url} with HTTP ${response.status}`);
                return readCatalogResponseText(response, { label: `Mistral docs ${url}` });
            };
            const [models, limits, api] = await Promise.all([
                fetchText(modelsUrl),
                fetchText(limitsUrl),
                fetchText(apiDocsUrl),
            ]);
            return { models, limits, api };
        },
        parseRows: parseMistralDocsRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'mistral-docs-models';
            return rows.flatMap((row) => {
                const record = /** @type {MistralDocsModelRow} */ (row);
                return evidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${record.id}:${item.fieldPath}`,
                        providerId: 'mistral',
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
