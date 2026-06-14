// @ts-check
/**
 * Z.AI docs/pricing catalog importer.
 *
 * Z.AI exposes OpenAI-compatible runtime endpoints, but the stable public metadata source is currently the developer
 * docs/pricing surface. This importer parses those docs into normalized catalog evidence while account access remains
 * an authenticated overlay and runtime probes remain a separate phase.
 *
 * @module copilot/model-gateway/catalog/importers/zai-models-importer
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
    normalizeModelModalities,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeUsdPricing,
} from '../normalizers.js';
import { readCatalogResponseText } from './response-body.js';

export const ZAI_OPENAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
export const ZAI_DOCS_PRICING_URL = 'https://docs.z.ai/guides/overview/pricing.md';
export const ZAI_OPENAPI_URL = 'https://docs.z.ai/openapi.json';
export const ZAI_CHAT_COMPLETIONS_PATH = '/chat/completions';
export const ZAI_BUILT_IN_WEB_SEARCH_USD_PER_USE = 0.01;

/**
 * @typedef {Readonly<{
 *     id: string;
 *     displayName: string;
 *     section: 'text' | 'vision';
 *     inputUsdPerMillion: number | null;
 *     cachedInputUsdPerMillion: number | null;
 *     outputUsdPerMillion: number | null;
 *     cacheWriteNote: string | null;
 *     sourceLine: string;
 * }>} ZaiPricingRow
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
 * @param {string} value
 * @returns {string}
 */
function cleanMarkdownCell(value) {
    return value
        .replace(/\\\|/gu, '|')
        .replace(/<br\s*\/?>/giu, ' ')
        .replace(/\*\*/gu, '')
        .replace(/`/gu, '')
        .trim();
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitMarkdownRow(line) {
    return line
        .trim()
        .replace(/^\|/u, '')
        .replace(/\|$/u, '')
        .split('|')
        .map(cleanMarkdownCell);
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function usdPerMillionValue(value) {
    const cleaned = value.replace(/,/gu, '').trim().toLowerCase();
    if (!cleaned || cleaned === '-' || cleaned === 'n/a') return null;
    if (cleaned.includes('free')) return 0;
    const match = cleaned.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/u);
    return match ? Number(match[1]) : null;
}

/**
 * @param {string} name
 * @returns {string}
 */
function modelIdFromDisplayName(name) {
    return name
        .trim()
        .replace(/^model\s+/iu, '')
        .replace(/\s+/gu, '-')
        .replace(/_/gu, '-')
        .toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {ZaiPricingRow[]}
 */
function parseZaiPricingRows(raw) {
    const markdown = typeof raw === 'string' ? raw : isRecord(raw) && typeof raw['markdown'] === 'string' ? raw['markdown'] : '';
    /** @type {'text' | 'vision' | null} */
    let section = null;
    /** @type {ZaiPricingRow[]} */
    const rows = [];
    for (const line of markdown.split(/\r?\n/u)) {
        const heading = line.trim().toLowerCase();
        if (heading.startsWith('### text models')) {
            section = 'text';
            continue;
        }
        if (heading.startsWith('### vision models')) {
            section = 'vision';
            continue;
        }
        if (heading.startsWith('### ') && section) {
            section = null;
            continue;
        }
        if (!section || !line.trim().startsWith('|')) continue;
        const cells = splitMarkdownRow(line);
        if (cells.length < 4) continue;
        if (/^-+$/u.test(cells.join('').replace(/:/gu, ''))) continue;
        const displayName = cells[0] ?? '';
        if (displayName.toLowerCase() === 'model') continue;
        if (!displayName) continue;
        rows.push(
            Object.freeze({
                id: modelIdFromDisplayName(displayName),
                displayName,
                section,
                inputUsdPerMillion: usdPerMillionValue(cells[1] ?? ''),
                cachedInputUsdPerMillion: usdPerMillionValue(cells[2] ?? ''),
                cacheWriteNote: cleanMarkdownCell(cells[3] ?? '') || null,
                outputUsdPerMillion: usdPerMillionValue(cells[4] ?? ''),
                sourceLine: line.trim(),
            }),
        );
    }
    return rows;
}

/**
 * @param {number | null} value
 * @returns {number | null}
 */
function perMillionToPerToken(value) {
    return typeof value === 'number' ? value / 1_000_000 : null;
}

/**
 * @param {ZaiPricingRow} row
 * @returns {Record<string, boolean>}
 */
function capabilitiesForRow(row) {
    const raw = row.id.toLowerCase();
    const modalities = modalitiesForRow(row);
    /** @type {Record<string, boolean>} */
    const capabilities = {
        chat: true,
        streaming: true,
        tools: true,
        ...normalizeOpenAICompatibleModelCapabilities({
            supportedParameters: ['stream', 'tools', 'tool_choice', 'response_format'],
            inputModalities: modalities.input,
            outputModalities: modalities.output,
        }),
    };
    if (raw.includes('glm-5') || raw.includes('glm-4.6') || raw.includes('glm-4.7')) capabilities['reasoning'] = true;
    if (raw.includes('ocr')) capabilities['ocr'] = true;
    return capabilities;
}

/**
 * @param {ZaiPricingRow} row
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesForRow(row) {
    if (row.section === 'vision') return normalizeModelModalities({ input: ['text', 'image'], output: ['text'] });
    return normalizeModelModalities({ input: ['text'], output: ['text'] });
}

/**
 * @param {ZaiPricingRow} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const modalities = modalitiesForRow(row);
    const aliases = normalizeModelAliases({ providerModel: row.id, canonicalSlug: row.id });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: row.id,
        displayName: row.displayName,
        canonicalSlug: row.id,
    });
    const lifecycle = normalizeModelLifecycle({ providerModel: row.id });
    const pricing = normalizeUsdPricing({
        inputPerTokenUsd: perMillionToPerToken(row.inputUsdPerMillion),
        outputPerTokenUsd: perMillionToPerToken(row.outputUsdPerMillion),
        cacheReadPerTokenUsd: perMillionToPerToken(row.cachedInputUsdPerMillion),
        webSearchUsdPerRequest: ZAI_BUILT_IN_WEB_SEARCH_USD_PER_USE,
    });
    const capabilities = capabilitiesForRow(row);
    const values = [
        { fieldPath: 'displayName', value: row.displayName },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'supportedParameters', value: ['stream', 'tools', 'tool_choice', 'response_format'] },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(pricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'zai' },
        { fieldPath: 'providerMetadata.zai.section', value: row.section },
        { fieldPath: 'providerMetadata.zai.pricingSource', value: ZAI_DOCS_PRICING_URL },
        { fieldPath: 'providerMetadata.zai.openApiUrl', value: ZAI_OPENAPI_URL },
        { fieldPath: 'providerMetadata.zai.openAICompatibleBaseUrl', value: ZAI_OPENAI_BASE_URL },
        { fieldPath: 'providerMetadata.zai.cacheWriteNote', value: row.cacheWriteNote },
        { fieldPath: 'providerMetadata.zai.builtInWebSearchUsdPerUse', value: ZAI_BUILT_IN_WEB_SEARCH_USD_PER_USE },
        { fieldPath: 'providerMetadata.zai.sourceLine', value: row.sourceLine },
        ...Object.entries(identityTraits).map(([key, value]) => ({ fieldPath: `providerMetadata.modelTraits.${key}`, value })),
        { fieldPath: 'openai.owned_by', value: 'zai' },
    ];
    return values.filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        if (isRecord(item.value) && Object.keys(item.value).length === 0) return false;
        return true;
    });
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
export function createZaiModelsImporter(options = {}) {
    const baseUrl = (options.baseUrl ?? ZAI_OPENAI_BASE_URL).replace(/\/$/u, '');
    const url = options.url ?? ZAI_DOCS_PRICING_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = 'public_docs';
    return {
        id: 'zai-models',
        providerId: 'zai',
        sourceKind,
        requiresAuth: false,
        url,
        envRequirements: ['ZAI_API_KEY', 'Z_AI_KEY'],
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Z.AI catalog import');
            const response = await fetchImpl(url, {
                headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
            });
            if (!response.ok) throw new Error(`Z.AI pricing docs fetch failed with HTTP ${response.status}`);
            return readCatalogResponseText(response, { label: 'Z.AI pricing docs' });
        },
        parseRows: parseZaiPricingRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'zai-models';
            return rows.flatMap((row) => {
                const record = /** @type {ZaiPricingRow} */ (row);
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${record.id}:${item.fieldPath}`,
                        providerId: 'zai',
                        providerModel: record.id,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind,
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'zai-models';
            return rows.map((row) => {
                const record = /** @type {ZaiPricingRow} */ (row);
                const capabilities = capabilitiesForRow(record);
                return createModelRouteOption({
                    providerId: 'zai',
                    providerModel: record.id,
                    selectorKind: 'exact_model',
                    selectorSyntax: record.id,
                    sourceId,
                    sourceKind,
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                    normalizedPolicy: {
                        routeLayer: 'openai_compatible',
                        openAICompatibleBaseUrl: baseUrl,
                        endpoint: ZAI_CHAT_COMPLETIONS_PATH,
                        acceptLanguage: 'en-US,en',
                        supportsTools: capabilities['tools'] === true,
                        supportsThinking: capabilities['reasoning'] === true,
                        visionFamily: record.section === 'vision',
                    },
                });
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiKey) return [];
            const sourceId = stringValue(context.source['id']) ?? 'zai-models';
            const enabledModels = rows.map((row) => /** @type {ZaiPricingRow} */ (row).id);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: ZAI_CHAT_COMPLETIONS_PATH,
                    semantics: 'docs_seed_models_with_configured_key',
                    openAICompatible: true,
                    openApiUrl: ZAI_OPENAPI_URL,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `zai:${options.accountScope ?? 'default'}:${options.secretRef ?? 'ZAI_API_KEY'}:${sourceId}`,
                    providerId: 'zai',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'ZAI_API_KEY',
                    sourceId,
                    sourceKind,
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
