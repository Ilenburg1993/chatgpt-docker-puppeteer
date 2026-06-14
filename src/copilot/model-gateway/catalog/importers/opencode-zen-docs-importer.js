// @ts-check
/**
 * OpenCode Zen public docs importer.
 *
 * `/zen/v1/models` is intentionally OpenAI-shaped and identity-only. The public Zen docs carry the rich catalog data:
 * model display names, exact runtime endpoint, AI SDK package, pricing tiers and deprecation dates.
 *
 * @module copilot/model-gateway/catalog/importers/opencode-zen-docs-importer
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createModelMetadataEvidence, createModelRouteOption } from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeUsdPricing,
} from '../normalizers.js';
import {
    OPENCODE_ZEN_BASE_URL,
    OPENCODE_ZEN_CHAT_COMPLETIONS_URL,
} from './opencode-zen-models-importer.js';
import { htmlTables } from './html-docs-parser.js';
import { readCatalogResponseText } from './response-body.js';

export const OPENCODE_ZEN_DOCS_URL = 'https://opencode.ai/docs/zen/';

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
function displayKey(value) {
    return value
        .replace(/\([^)]*\)/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim();
}

/**
 * @param {string} value
 * @returns {{ displayName: string; tierLabel: string | null }}
 */
function splitTierLabel(value) {
    const match = value.match(/^(.*?)\s*\(([^)]*)\)\s*$/u);
    return {
        displayName: match?.[1]?.trim() || value.trim(),
        tierLabel: match?.[2]?.trim() || null,
    };
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function pricePerMillion(value) {
    const text = value.trim().toLowerCase();
    if (!text || text === '-' || text === 'n/a') return null;
    if (text === 'free') return 0;
    const number = Number(text.replace(/\$/gu, '').replace(/,/gu, ''));
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function isoDateFromDocs(value) {
    const parsed = Date.parse(`${value} 00:00:00 UTC`);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * @param {string} endpoint
 * @returns {{ wireApi: string; family: string; routeLayer: string }}
 */
function endpointPolicy(endpoint) {
    if (endpoint.endsWith('/responses')) return { wireApi: 'openai_responses', family: 'openai', routeLayer: 'direct_provider' };
    if (endpoint.endsWith('/messages')) return { wireApi: 'anthropic_messages', family: 'anthropic_compatible', routeLayer: 'direct_provider' };
    if (endpoint.includes('/models/')) return { wireApi: 'google_generative_model', family: 'google', routeLayer: 'direct_provider' };
    return { wireApi: 'openai_chat_completions', family: 'openai_compatible', routeLayer: 'openai_compatible' };
}

/**
 * @param {string} providerModel
 * @returns {Record<string, boolean>}
 */
function capabilitiesForModel(providerModel) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = { chat: true, tools: true };
    if (lower.includes('codex') || lower.includes('coder') || lower.includes('build')) capabilities['code'] = true;
    if (lower.includes('gpt-') || lower.includes('claude') || lower.includes('gemini') || lower.includes('qwen')) {
        capabilities['reasoning'] = true;
    }
    return capabilities;
}

/**
 * @param {string} html
 * @returns {Record<string, unknown>[]}
 */
function parseOpenCodeDocsRows(html) {
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    /** @type {Map<string, string>} */
    const idByDisplay = new Map();
    const tables = htmlTables(html);
    for (const rows of tables) {
        const header = rows[0]?.map((cell) => cell.toLowerCase()) ?? [];
        if (header.includes('model id') && header.includes('endpoint')) {
            for (const cells of rows.slice(1)) {
                const displayName = stringValue(cells[0]);
                const providerModel = stringValue(cells[1]);
                const endpoint = stringValue(cells[2]);
                const aiSdkPackage = stringValue(cells[3]);
                if (!displayName || !providerModel || !endpoint) continue;
                idByDisplay.set(displayKey(displayName), providerModel);
                byId.set(providerModel, {
                    id: providerModel,
                    displayName,
                    endpoint,
                    aiSdkPackage,
                    docsUrl: OPENCODE_ZEN_DOCS_URL,
                });
            }
        }
    }
    for (const rows of tables) {
        const header = rows[0]?.map((cell) => cell.toLowerCase()) ?? [];
        if (header.includes('cached read') && header.includes('cached write')) {
            for (const cells of rows.slice(1)) {
                const rawDisplay = stringValue(cells[0]);
                if (!rawDisplay) continue;
                const { displayName, tierLabel } = splitTierLabel(rawDisplay);
                const providerModel = idByDisplay.get(displayKey(displayName));
                if (!providerModel) continue;
                const row = byId.get(providerModel) ?? { id: providerModel, displayName, docsUrl: OPENCODE_ZEN_DOCS_URL };
                const tier = {
                    label: tierLabel,
                    inputUsdPerMillion: pricePerMillion(cells[1] ?? ''),
                    outputUsdPerMillion: pricePerMillion(cells[2] ?? ''),
                    cacheReadUsdPerMillion: pricePerMillion(cells[3] ?? ''),
                    cacheWriteUsdPerMillion: pricePerMillion(cells[4] ?? ''),
                };
                const tiers = Array.isArray(row['pricingTiers']) ? row['pricingTiers'] : [];
                tiers.push(tier);
                row['pricingTiers'] = tiers;
                if (!isRecord(row['pricing'])) row['pricing'] = tier;
                byId.set(providerModel, row);
            }
        }
        if (header.includes('deprecation date')) {
            for (const cells of rows.slice(1)) {
                const displayName = stringValue(cells[0]);
                const providerModel = displayName ? idByDisplay.get(displayKey(displayName)) : null;
                const expiresAt = isoDateFromDocs(cells[1] ?? '');
                if (!providerModel || !expiresAt) continue;
                const row = byId.get(providerModel) ?? { id: providerModel, displayName, docsUrl: OPENCODE_ZEN_DOCS_URL };
                row['expiresAt'] = expiresAt;
                byId.set(providerModel, row);
            }
        }
    }
    return [...byId.values()];
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseOpenCodeDocsRaw(raw) {
    return parseOpenCodeDocsRows(isRecord(raw) ? stringValue(raw['html']) ?? '' : String(raw ?? ''));
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} nowMs
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row, nowMs) {
    const providerModel = stringValue(row['id']);
    if (!providerModel) return [];
    const pricing = isRecord(row['pricing']) ? row['pricing'] : {};
    const endpoint = stringValue(row['endpoint']);
    const policy = endpoint ? endpointPolicy(endpoint) : endpointPolicy(OPENCODE_ZEN_CHAT_COMPLETIONS_URL);
    const lifecycle = normalizeModelLifecycle({ expiresAt: row['expiresAt'], providerModel, nowMs });
    const normalizedPricing = normalizeUsdPricing({
        inputPerTokenUsd: typeof pricing['inputUsdPerMillion'] === 'number' ? pricing['inputUsdPerMillion'] / 1_000_000 : null,
        outputPerTokenUsd: typeof pricing['outputUsdPerMillion'] === 'number' ? pricing['outputUsdPerMillion'] / 1_000_000 : null,
        cacheReadPerTokenUsd:
            typeof pricing['cacheReadUsdPerMillion'] === 'number' ? pricing['cacheReadUsdPerMillion'] / 1_000_000 : null,
        cacheWritePerTokenUsd:
            typeof pricing['cacheWriteUsdPerMillion'] === 'number' ? pricing['cacheWriteUsdPerMillion'] / 1_000_000 : null,
    });
    const aliases = normalizeModelAliases({ providerModel, canonicalSlug: `opencode/${providerModel}` });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        displayName: row['displayName'],
        canonicalSlug: `opencode/${providerModel}`,
    });
    const capabilities = capabilitiesForModel(providerModel);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['displayName']) ?? providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        { fieldPath: 'aliases.opencodeConfigModel', value: `opencode/${providerModel}` },
        ...Object.entries(lifecycle).map(([key, value]) => ({ fieldPath: `lifecycle.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'opencode' },
        { fieldPath: 'providerMetadata.opencode.docsUrl', value: stringValue(row['docsUrl']) },
        { fieldPath: 'providerMetadata.opencode.endpoint', value: endpoint },
        { fieldPath: 'providerMetadata.opencode.wireApi', value: policy.wireApi },
        { fieldPath: 'providerMetadata.opencode.aiSdkPackage', value: stringValue(row['aiSdkPackage']) },
        { fieldPath: 'providerMetadata.opencode.family', value: policy.family },
        { fieldPath: 'providerMetadata.opencode.pricingTiers', value: row['pricingTiers'] },
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
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.url]
 * @param {() => Date} [options.now]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenCodeZenDocsImporter(options = {}) {
    const url = options.url ?? OPENCODE_ZEN_DOCS_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'opencode-zen-docs',
        providerId: 'opencode',
        sourceKind: 'public_docs',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenCode Zen docs import');
            const response = await fetchImpl(url, { headers: { accept: 'text/html' } });
            if (!response.ok) throw new Error(`OpenCode Zen docs fetch failed with HTTP ${response.status}`);
            return { url, html: await readCatalogResponseText(response, { label: 'OpenCode Zen docs' }) };
        },
        parseRows: parseOpenCodeDocsRaw,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'opencode-zen-docs';
            const nowMs = (options.now?.() ?? new Date()).getTime();
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const providerModel = stringValue(record['id']);
                if (!providerModel) return [];
                return modelEvidenceValues(record, nowMs).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${providerModel}:${item.fieldPath}`,
                        providerId: 'opencode',
                        providerModel,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'public_docs',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'opencode-zen-docs';
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const providerModel = stringValue(record['id']);
                const endpoint = stringValue(record['endpoint']);
                if (!providerModel || !endpoint) return [];
                const policy = endpointPolicy(endpoint);
                return [
                    createModelRouteOption({
                        providerId: 'opencode',
                        providerModel,
                        selectorKind: 'exact_model',
                        selectorSyntax: providerModel,
                        sourceId,
                        sourceKind: 'public_docs',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        normalizedPolicy: {
                            routeLayer: policy.routeLayer,
                            baseUrl: OPENCODE_ZEN_BASE_URL,
                            endpoint,
                            wireApi: policy.wireApi,
                            family: policy.family,
                            aiSdkPackage: stringValue(record['aiSdkPackage']),
                            docsDerived: true,
                        },
                    }),
                ];
            });
        },
    };
}
