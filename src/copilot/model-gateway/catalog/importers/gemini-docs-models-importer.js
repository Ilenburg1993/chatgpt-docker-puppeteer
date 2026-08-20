// @ts-check
/**
 * Gemini official docs catalog seed importer.
 *
 * Gemini's `models.list` endpoint is account/key-scoped for the Developer API. Public Google docs add cross-surface
 * metadata for Developer API, Vertex AI and OpenAI-compatible access before any account or runtime proof.
 *
 * Sources checked 2026-05-26:
 * - https://ai.google.dev/gemini-api/docs/models
 * - https://ai.google.dev/gemini-api/docs/pricing
 * - https://ai.google.dev/gemini-api/docs/openai
 * - https://cloud.google.com/vertex-ai/generative-ai/docs/models
 *
 * @module copilot/model-gateway/catalog/importers/gemini-docs-models-importer
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

export const GEMINI_MODELS_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/models';
export const GEMINI_PRICING_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/pricing';
export const GEMINI_OPENAI_COMPATIBILITY_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/openai';
export const GEMINI_VERTEX_MODELS_DOCS_URL = 'https://cloud.google.com/vertex-ai/generative-ai/docs/models';

const GEMINI_MODEL_ID_PATTERN = /\bgemini-\d(?:\.\d)?-[a-z0-9][a-z0-9_.-]*\b/giu;
const GEMINI_DISPLAY_NAME_PATTERN = /\bGemini\s+\d(?:\.\d)?\s+(?:Pro Image|Flash Image|Flash-Lite|Flash|Pro|Live API)\b/gu;

/**
 * @typedef {{ id: string; docsText: string; pricingText: string; openaiText: string; vertexText: string }} GeminiDocsModelRow
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
 * @param {string} displayName
 * @returns {string}
 */
function displayNameToModelId(displayName) {
    return displayName
        .trim()
        .toLowerCase()
        .replace(/\s+with\s+gemini\s+live\s+api$/u, '-live')
        .replace(/\s+/gu, '-')
        .replace(/[^a-z0-9_.-]+/gu, '')
        .replace(/-+/gu, '-')
        .replace(/^-|-$/gu, '');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function modelIdsFromText(text) {
    const explicitIds = [...text.matchAll(GEMINI_MODEL_ID_PATTERN)].map((match) => match[0].toLowerCase());
    const displayIds = [...text.matchAll(GEMINI_DISPLAY_NAME_PATTERN)].map((match) => displayNameToModelId(match[0]));
    return [...new Set([...explicitIds, ...displayIds].filter((id) => id.startsWith('gemini-')))].sort();
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
    const match = value.replace(/,/gu, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb]|million)?/iu);
    if (!match?.[1]) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' || suffix === 'million' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(amount * multiplier);
}

/**
 * @param {string} value
 * @returns {number[]}
 */
function pricesFromText(value) {
    return [...value.matchAll(/\$+\s*([0-9]+(?:\.[0-9]+)?)/gu)].map((match) => Number(match[1])).filter(Number.isFinite);
}

/**
 * @param {string} providerModel
 * @returns {{ family: string; tier: string | null; generation: string | null; displayName: string }}
 */
function geminiModelTraits(providerModel) {
    const match = providerModel.match(/^gemini-(\d(?:\.\d)?)-(.+)$/u);
    const generation = match?.[1] ?? null;
    const suffix = match?.[2] ?? providerModel.replace(/^gemini-/u, '');
    const tier = suffix.includes('pro') ? 'pro' : suffix.includes('flash-lite') ? 'flash-lite' : suffix.includes('flash') ? 'flash' : suffix.includes('image') ? 'image' : null;
    const displayName = `Gemini ${generation ?? ''} ${suffix
        .split('-')
        .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
        .join(' ')}`.replace(/\s+/gu, ' ').trim();
    return { family: 'gemini', tier, generation, displayName };
}

/**
 * @param {string} providerModel
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesForModel(providerModel) {
    const lower = providerModel.toLowerCase();
    if (lower.includes('image')) return normalizeModelModalities({ input: ['text', 'image'], output: ['image', 'text'] });
    if (lower.includes('live')) return normalizeModelModalities({ input: ['text', 'image', 'audio', 'video'], output: ['text', 'audio'] });
    return normalizeModelModalities({ input: ['text', 'image', 'audio', 'video'], output: ['text'] });
}

/**
 * @param {string} providerModel
 * @param {string} combinedWindow
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(providerModel, combinedWindow) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = {
        chat: true,
        streaming: true,
        tools: true,
        jsonMode: true,
        tokenCounting: true,
    };
    if (/thinking|reasoning|agentic|coding/iu.test(combinedWindow) || lower.includes('2.5') || lower.includes('3-')) capabilities['reasoning'] = true;
    if (/grounding|search/iu.test(combinedWindow)) capabilities['grounding'] = true;
    if (lower.includes('image')) capabilities['imageGeneration'] = true;
    if (lower.includes('live') || /Live API|audio/iu.test(combinedWindow)) capabilities['liveApi'] = true;
    return capabilities;
}

/**
 * @param {string} providerModel
 * @param {string} combinedWindow
 * @returns {Record<string, number>}
 */
function tokenLimitsForModel(providerModel, combinedWindow) {
    const contextFromDocs =
        combinedWindow.match(/([0-9.,]+\s*(?:k|m|million)?)\s+token context/iu)?.[1] ??
        combinedWindow.match(/context window\s+(?:of\s+)?([0-9.,]+\s*(?:k|m|million)?)/iu)?.[1];
    const lower = providerModel.toLowerCase();
    const inferredContext = lower.includes('1.5-pro') ? 2_000_000 : lower.includes('2.5') || lower.includes('3-') ? 1_000_000 : null;
    return normalizeModelTokenLimits({ contextWindowTokens: compactTokenLimit(contextFromDocs ?? '') ?? inferredContext });
}

/**
 * @param {string} displayName
 * @param {string} pricingText
 * @returns {Record<string, number>}
 */
function pricingForDisplayName(displayName, pricingText) {
    const start = pricingText.toLowerCase().indexOf(displayName.toLowerCase());
    if (start < 0) return {};
    const segment = pricingText.slice(start);
    const afterName = segment.slice(displayName.length);
    const nextModel = afterName.search(/\bGemini\s+\d/u);
    const window = nextModel >= 0 ? segment.slice(0, displayName.length + nextModel) : segment.slice(0, 900);
    const prices = pricesFromText(window);
    /** @type {Record<string, number>} */
    const pricing = {};
    if (prices[0] !== undefined) pricing['inputUsdPerMillion'] = prices[0];
    if (prices[1] !== undefined) pricing['outputUsdPerMillion'] = prices[1];
    if (prices[2] !== undefined) pricing['cacheReadUsdPerMillion'] = prices[2];
    return pricing;
}

/**
 * @param {GeminiDocsModelRow} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function evidenceValues(row) {
    const traits = geminiModelTraits(row.id);
    const docsWindow = textWindow(row.docsText, row.id, 1400) || textWindow(row.docsText, traits.displayName, 1400);
    const vertexWindow = textWindow(row.vertexText, row.id, 1400) || textWindow(row.vertexText, traits.displayName, 1400);
    const pricingWindow = textWindow(row.pricingText, row.id, 900) || textWindow(row.pricingText, traits.displayName, 900);
    const combinedWindow = `${docsWindow} ${vertexWindow} ${pricingWindow} ${row.openaiText}`;
    const aliases = normalizeModelAliases({ providerModel: row.id, canonicalSlug: row.id });
    const lifecycle = normalizeModelLifecycle({
        providerModel: row.id,
        lifecycle: /preview/iu.test(combinedWindow) ? 'preview' : 'active',
    });
    const modalities = modalitiesForModel(row.id);
    const capabilities = capabilitiesForModel(row.id, combinedWindow);
    const tokenLimits = tokenLimitsForModel(row.id, combinedWindow);
    const pricing = pricingForDisplayName(traits.displayName, row.pricingText);
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row.id,
        displayName: traits.displayName,
        family: traits.family,
        tier: traits.tier,
        generation: traits.generation,
    });
    const values = [
        { fieldPath: 'displayName', value: traits.displayName },
        { fieldPath: 'providerMetadata.gemini.docsUrl', value: GEMINI_MODELS_DOCS_URL },
        { fieldPath: 'providerMetadata.gemini.pricingUrl', value: GEMINI_PRICING_DOCS_URL },
        { fieldPath: 'providerMetadata.gemini.openAiCompatibilityUrl', value: GEMINI_OPENAI_COMPATIBILITY_DOCS_URL },
        { fieldPath: 'providerMetadata.gemini.vertexDocsUrl', value: GEMINI_VERTEX_MODELS_DOCS_URL },
        { fieldPath: 'providerMetadata.gemini.family', value: traits.family },
        { fieldPath: 'providerMetadata.gemini.tier', value: traits.tier },
        { fieldPath: 'providerMetadata.gemini.generation', value: traits.generation },
        { fieldPath: 'providerMetadata.gemini.surfaces', value: ['developer_api', 'vertex_ai', 'openai_compatible'] },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(tokenLimits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(pricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.owned_by', value: 'google' },
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
 * @returns {GeminiDocsModelRow[]}
 */
export function parseGeminiDocsRows(raw) {
    const record = isRecord(raw) ? raw : {};
    const docsText = normalizeDocsText(String(record['models'] ?? ''));
    const pricingText = normalizeDocsText(String(record['pricing'] ?? ''));
    const openaiText = normalizeDocsText(String(record['openai'] ?? ''));
    const vertexText = normalizeDocsText(String(record['vertex'] ?? ''));
    const ids = [...new Set([...modelIdsFromText(docsText), ...modelIdsFromText(pricingText), ...modelIdsFromText(openaiText), ...modelIdsFromText(vertexText)])].sort();
    return ids.map((id) => ({ id, docsText, pricingText, openaiText, vertexText }));
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.modelsUrl]
 * @param {string} [options.pricingUrl]
 * @param {string} [options.openaiUrl]
 * @param {string} [options.vertexUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createGeminiDocsModelsImporter(options = {}) {
    const modelsUrl = options.modelsUrl ?? GEMINI_MODELS_DOCS_URL;
    const pricingUrl = options.pricingUrl ?? GEMINI_PRICING_DOCS_URL;
    const openaiUrl = options.openaiUrl ?? GEMINI_OPENAI_COMPATIBILITY_DOCS_URL;
    const vertexUrl = options.vertexUrl ?? GEMINI_VERTEX_MODELS_DOCS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'gemini-docs-models',
        providerId: 'gemini',
        sourceKind: 'official_docs',
        requiresAuth: false,
        url: modelsUrl,
        refreshPolicy: 'scheduled',
        ttlSeconds: 86_400,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Gemini docs catalog import');
            /** @param {string} url */
            const fetchText = async (url) => {
                const response = await fetchImpl(url, { headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' } });
                if (!response.ok) throw new Error(`Gemini docs fetch failed for ${url} with HTTP ${response.status}`);
                return readCatalogResponseText(response, { label: `Gemini docs ${url}` });
            };
            const [models, pricing, openai, vertex] = await Promise.all([
                fetchText(modelsUrl),
                fetchText(pricingUrl),
                fetchText(openaiUrl),
                fetchText(vertexUrl),
            ]);
            return { models, pricing, openai, vertex };
        },
        parseRows: parseGeminiDocsRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'gemini-docs-models';
            return rows.flatMap((row) => {
                const record = /** @type {GeminiDocsModelRow} */ (row);
                return evidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${record.id}:${item.fieldPath}`,
                        providerId: 'gemini',
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
