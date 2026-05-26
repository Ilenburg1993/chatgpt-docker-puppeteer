// @ts-check
/**
 * Anthropic official docs catalog seed importer.
 *
 * `/v1/models` remains account-scoped evidence of visibility. Anthropic's public model docs add model-family metadata,
 * cross-cloud aliases, context/output limits, pricing and capability hints that should be collected before runtime.
 *
 * Sources checked 2026-05-26:
 * - https://docs.anthropic.com/en/docs/about-claude/models/overview
 * - https://docs.anthropic.com/en/docs/about-claude/pricing
 * - https://docs.anthropic.com/en/api/models-list
 *
 * @module copilot/model-gateway/catalog/importers/anthropic-docs-models-importer
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

export const ANTHROPIC_MODELS_DOCS_URL = 'https://docs.anthropic.com/en/docs/about-claude/models/overview';
export const ANTHROPIC_PRICING_DOCS_URL = 'https://docs.anthropic.com/en/docs/about-claude/pricing';
export const ANTHROPIC_MODELS_API_DOCS_URL = 'https://docs.anthropic.com/en/api/models-list';

const CLAUDE_MODEL_ID_PATTERN = /\bclaude-(?=[a-z0-9_.-]*(?:\d{8}|latest)\b)[a-z0-9][a-z0-9_.-]*\b/giu;

/**
 * @typedef {{ id: string; docsText: string; pricingText: string; apiText: string }} AnthropicDocsModelRow
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
    return [...new Set([...text.matchAll(CLAUDE_MODEL_ID_PATTERN)].map((match) => match[0].toLowerCase().replace(/-v\d+$/u, '')))].sort();
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
    return [...value.matchAll(/\$+\s*([0-9]+(?:\.[0-9]+)?)/gu)].map((match) => Number(match[1])).filter(Number.isFinite);
}

/**
 * @param {string} providerModel
 * @returns {{ family: string; tier: string | null; generation: string | null; displayName: string }}
 */
function anthropicModelTraits(providerModel) {
    const lower = providerModel.toLowerCase();
    const direct = lower.match(/claude-(opus|sonnet|haiku)-(\d(?:-\d)?)(?:-\d{8}|-latest)?$/u);
    const legacy = lower.match(/claude-(\d+)-(\d+)-(sonnet|haiku)(?:-\d{8}|-latest)?$/u);
    const tier = direct?.[1] ?? legacy?.[3] ?? (lower.includes('opus') ? 'opus' : lower.includes('sonnet') ? 'sonnet' : lower.includes('haiku') ? 'haiku' : null);
    const generation = direct?.[2]?.replace('-', '.') ?? (legacy ? `${legacy[1]}.${legacy[2]}` : null);
    const titleTier = tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)}` : 'Model';
    const displayName = generation ? `Claude ${titleTier} ${generation}` : `Claude ${titleTier}`;
    return { family: 'claude', tier, generation, displayName };
}

/**
 * @param {string} providerModel
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesForModel(providerModel) {
    const lower = providerModel.toLowerCase();
    const supportsVision = /(?:opus|sonnet|haiku)/u.test(lower);
    return normalizeModelModalities({ input: supportsVision ? ['text', 'image'] : ['text'], output: ['text'] });
}

/**
 * @param {string} providerModel
 * @param {string} docsWindow
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(providerModel, docsWindow) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = {
        chat: true,
        streaming: true,
        tools: true,
        promptCaching: true,
        batch: true,
    };
    if (/vision|image input/iu.test(docsWindow) || /(?:opus|sonnet|haiku)/u.test(lower)) capabilities['vision'] = true;
    if (/extended thinking|superior reasoning|reasoning/iu.test(docsWindow) || /(?:opus|sonnet|3-7)/u.test(lower)) {
        capabilities['reasoning'] = true;
    }
    if (/priority tier/iu.test(docsWindow)) capabilities['priorityTier'] = true;
    return capabilities;
}

/**
 * @param {string} providerModel
 * @param {string} docsWindow
 * @returns {Record<string, number | string>}
 */
function tokenLimitsForModel(providerModel, docsWindow) {
    const lower = providerModel.toLowerCase();
    const contextFromDocs = docsWindow.match(/context window\s+([0-9.,]+\s*[kmb]?)/iu)?.[1] ?? docsWindow.match(/([0-9.,]+\s*[kmb]?)\s*context window/iu)?.[1];
    const maxOutputFromDocs = docsWindow.match(/max output\s+([0-9.,]+\s*(?:tokens?)?)/iu)?.[1];
    const inferredContext = lower.includes('sonnet-4') && /1M|1 million/iu.test(docsWindow) ? 1_000_000 : 200_000;
    const maxOutputTokens = compactTokenLimit(maxOutputFromDocs ?? '') ?? (lower.includes('sonnet-4') || lower.includes('3-7-sonnet') ? 64_000 : lower.includes('opus-4') ? 32_000 : lower.includes('3-5-haiku') ? 8_192 : lower.includes('3-haiku') ? 4_096 : null);
    return normalizeModelTokenLimits({
        contextWindowTokens: compactTokenLimit(contextFromDocs ?? '') ?? inferredContext,
        maxOutputTokens,
    });
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
    const nextModel = afterName.search(/\bClaude\s+[A-Z]/u);
    const window = nextModel >= 0 ? segment.slice(0, displayName.length + nextModel) : segment.slice(0, 650);
    const prices = pricesFromText(window);
    /** @type {Record<string, number>} */
    const pricing = {};
    if (prices[0] !== undefined) pricing['inputUsdPerMillion'] = prices[0];
    if (prices[1] !== undefined) pricing['cacheWrite5mUsdPerMillion'] = prices[1];
    if (prices[2] !== undefined) pricing['cacheWrite1hUsdPerMillion'] = prices[2];
    if (prices[3] !== undefined) pricing['cacheReadUsdPerMillion'] = prices[3];
    if (prices[4] !== undefined) pricing['outputUsdPerMillion'] = prices[4];
    return pricing;
}

/**
 * @param {string} providerModel
 * @param {string} docsText
 * @returns {string[]}
 */
function cloudAliases(providerModel, docsText) {
    const docsWindow = textWindow(docsText, providerModel, 700);
    return [...new Set([...docsWindow.matchAll(/\b(?:anthropic\.)?claude[-@.:a-z0-9_]+(?:v1:0|@\d{8})?\b/giu)].map((match) => match[0]))].sort();
}

/**
 * @param {AnthropicDocsModelRow} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function evidenceValues(row) {
    const traits = anthropicModelTraits(row.id);
    const docsWindow = textWindow(row.docsText, row.id, 1400) || textWindow(row.docsText, traits.displayName, 1400);
    const capabilities = capabilitiesForModel(row.id, docsWindow);
    const modalities = modalitiesForModel(row.id);
    const aliases = normalizeModelAliases({ providerModel: row.id, canonicalSlug: row.id });
    const lifecycle = normalizeModelLifecycle({
        providerModel: row.id,
        lifecycle: /deprecated/iu.test(`${docsWindow} ${textWindow(row.pricingText, traits.displayName, 500)}`) ? 'deprecated' : 'active',
    });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row.id,
        displayName: traits.displayName,
        family: traits.family,
        tier: traits.tier,
        generation: traits.generation,
    });
    const pricing = pricingForDisplayName(traits.displayName, row.pricingText);
    const tokenLimits = tokenLimitsForModel(row.id, docsWindow);
    const aliasesByCloud = cloudAliases(row.id, row.docsText);
    const values = [
        { fieldPath: 'displayName', value: traits.displayName },
        { fieldPath: 'providerMetadata.anthropic.docsUrl', value: ANTHROPIC_MODELS_DOCS_URL },
        { fieldPath: 'providerMetadata.anthropic.pricingUrl', value: ANTHROPIC_PRICING_DOCS_URL },
        { fieldPath: 'providerMetadata.anthropic.modelsApiDocsUrl', value: ANTHROPIC_MODELS_API_DOCS_URL },
        { fieldPath: 'providerMetadata.anthropic.family', value: traits.family },
        { fieldPath: 'providerMetadata.anthropic.tier', value: traits.tier },
        { fieldPath: 'providerMetadata.anthropic.generation', value: traits.generation },
        { fieldPath: 'providerMetadata.anthropic.cloudAliases', value: aliasesByCloud },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(tokenLimits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
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
 * @returns {AnthropicDocsModelRow[]}
 */
export function parseAnthropicDocsRows(raw) {
    const record = isRecord(raw) ? raw : {};
    const docsText = normalizeDocsText(String(record['models'] ?? ''));
    const pricingText = normalizeDocsText(String(record['pricing'] ?? ''));
    const apiText = normalizeDocsText(String(record['api'] ?? ''));
    const ids = [...new Set([...modelIdsFromText(docsText), ...modelIdsFromText(pricingText), ...modelIdsFromText(apiText)])].sort();
    return ids.map((id) => ({ id, docsText, pricingText, apiText }));
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.modelsUrl]
 * @param {string} [options.pricingUrl]
 * @param {string} [options.apiDocsUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createAnthropicDocsModelsImporter(options = {}) {
    const modelsUrl = options.modelsUrl ?? ANTHROPIC_MODELS_DOCS_URL;
    const pricingUrl = options.pricingUrl ?? ANTHROPIC_PRICING_DOCS_URL;
    const apiDocsUrl = options.apiDocsUrl ?? ANTHROPIC_MODELS_API_DOCS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'anthropic-docs-models',
        providerId: 'anthropic',
        sourceKind: 'official_docs',
        requiresAuth: false,
        url: modelsUrl,
        refreshPolicy: 'scheduled',
        ttlSeconds: 86_400,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Anthropic docs catalog import');
            /** @param {string} url */
            const fetchText = async (url) => {
                const response = await fetchImpl(url, { headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' } });
                if (!response.ok) throw new Error(`Anthropic docs fetch failed for ${url} with HTTP ${response.status}`);
                return response.text();
            };
            const [models, pricing, api] = await Promise.all([fetchText(modelsUrl), fetchText(pricingUrl), fetchText(apiDocsUrl)]);
            return { models, pricing, api };
        },
        parseRows: parseAnthropicDocsRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'anthropic-docs-models';
            return rows.flatMap((row) => {
                const record = /** @type {AnthropicDocsModelRow} */ (row);
                return evidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${record.id}:${item.fieldPath}`,
                        providerId: 'anthropic',
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
