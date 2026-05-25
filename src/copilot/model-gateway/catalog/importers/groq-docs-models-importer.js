// @ts-check
/**
 * Groq public docs/pricing catalog importer.
 *
 * Groq's authenticated OpenAI-compatible `/models` endpoint is account-scoped and authoritative for visible ids. The
 * public docs add global metadata that the API does not return: per-million pricing, cached-input prices, rate-limit
 * hints, advertised output limits and speed. This importer keeps that evidence separate from runtime probes.
 *
 * @module copilot/model-gateway/catalog/importers/groq-docs-models-importer
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createModelMetadataEvidence, createProviderMetadataEvidence } from '../contracts.js';
import {
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelModalities,
    normalizeModelTokenLimits,
    normalizeUsdPricing,
} from '../normalizers.js';
import { decodeHtmlEntities, htmlTableCells, htmlTableRows, htmlText } from './html-docs-parser.js';

export const GROQ_DOCS_MODELS_URL = 'https://console.groq.com/docs/models';
export const GROQ_PRICING_URL = 'https://groq.com/pricing';

const GROQ_PROMPT_CACHING_MODEL_IDS = Object.freeze([
    'moonshotai/kimi-k2-instruct-0905',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
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
 * @param {string} value
 * @returns {number | null}
 */
function numberFromText(value) {
    const match = value.replace(/,/gu, '').match(/-?\d+(?:\.\d+)?/u);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function priceFromText(value) {
    return numberFromText(value.replace(/\$+/gu, ''));
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function compactLimitFromText(value) {
    const match = value.replace(/,/gu, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?/iu);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(amount * multiplier);
}

/**
 * @param {string} rowHtml
 * @param {string} firstCellText
 * @returns {string | null}
 */
function modelIdFromRow(rowHtml, firstCellText) {
    const idAttribute = rowHtml.match(/\bid=["']([^"']+(?:\/[^"']+)?)["']/iu)?.[1];
    if (idAttribute && /^[a-z0-9_.:-]+(?:\/[a-z0-9_.:-]+)+$/iu.test(idAttribute)) return decodeHtmlEntities(idAttribute);
    const monoText = rowHtml.match(/font-mono[^>]*>([\s\S]*?)<\/span>/iu)?.[1];
    const monoCandidate = htmlText(monoText);
    if (/^[a-z0-9_.:-]+(?:\/[a-z0-9_.:-]+)*$/iu.test(monoCandidate) && /[a-z]/iu.test(monoCandidate)) return monoCandidate;
    const textCandidate = firstCellText.match(/[a-z0-9][a-z0-9_.:-]*(?:\/[a-z0-9][a-z0-9_.:-]*)+/iu)?.[0];
    return textCandidate ?? null;
}

/**
 * @param {string} text
 * @returns {{ inputUsdPerMillion?: number; outputUsdPerMillion?: number; cacheReadUsdPerMillion?: number }}
 */
function pricingFromText(text) {
    const input = text.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*input/iu)?.[1];
    const output = text.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*output/iu)?.[1];
    const cached = text.match(/\$+\s*([0-9]+(?:\.[0-9]+)?)\s*(?:cached|cache)/iu)?.[1];
    /** @type {{ inputUsdPerMillion?: number; outputUsdPerMillion?: number; cacheReadUsdPerMillion?: number }} */
    const result = {};
    const inputPrice = input ? priceFromText(input) : null;
    const outputPrice = output ? priceFromText(output) : null;
    const cachedPrice = cached ? priceFromText(cached) : null;
    if (inputPrice !== null) result.inputUsdPerMillion = inputPrice;
    if (outputPrice !== null) result.outputUsdPerMillion = outputPrice;
    if (cachedPrice !== null) result.cacheReadUsdPerMillion = cachedPrice;
    return result;
}

/**
 * @param {string} text
 * @returns {{ tokensPerMinute?: number; requestsPerMinute?: number }}
 */
function rateLimitsFromText(text) {
    const tpm = text.match(/([0-9.,]+\s*[kmb]?)\s*TPM/iu)?.[1];
    const rpm = text.match(/([0-9.,]+\s*[kmb]?)\s*RPM/iu)?.[1];
    /** @type {{ tokensPerMinute?: number; requestsPerMinute?: number }} */
    const result = {};
    const tpmValue = tpm ? compactLimitFromText(tpm) : null;
    const rpmValue = rpm ? compactLimitFromText(rpm) : null;
    if (tpmValue !== null) result.tokensPerMinute = tpmValue;
    if (rpmValue !== null) result.requestsPerMinute = rpmValue;
    return result;
}

/**
 * @param {string} providerModel
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromModelId(providerModel) {
    const lower = providerModel.toLowerCase();
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (lower.includes('whisper')) {
        capabilities['asr'] = true;
        return capabilities;
    }
    if (lower.includes('playai') || lower.includes('orpheus')) {
        capabilities['tts'] = true;
        return capabilities;
    }
    capabilities['chat'] = true;
    capabilities['streaming'] = true;
    if (lower.includes('gpt-oss') || lower.includes('qwen') || lower.includes('llama') || lower.includes('kimi')) {
        capabilities['tools'] = true;
        capabilities['jsonMode'] = true;
    }
    if (lower.includes('gpt-oss') || lower.includes('qwen3') || lower.includes('deepseek-r1')) capabilities['reasoning'] = true;
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
    const lower = providerModel.toLowerCase();
    if (lower.includes('whisper')) return normalizeModelModalities({ input: ['audio'], output: ['text'] });
    if (lower.includes('playai') || lower.includes('orpheus')) return normalizeModelModalities({ input: ['text'], output: ['audio'] });
    return normalizeModelModalities({ input: ['text'], output: ['text'] });
}

/**
 * @param {string} html
 * @returns {Record<string, unknown>[]}
 */
function parseModelRowsFromDocsHtml(html) {
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (const rowHtml of htmlTableRows(html)) {
        const cells = htmlTableCells(rowHtml);
        if (cells.length < 4) continue;
        const providerModel = modelIdFromRow(rowHtml, cells[0] ?? '');
        if (!providerModel || providerModel.toLowerCase() === 'model id') continue;
        const speedTokensPerSecond = numberFromText(cells[1] ?? '');
        const pricing = pricingFromText(cells[2] ?? '');
        const rateLimits = rateLimitsFromText(cells[3] ?? '');
        const contextWindowTokens = numberFromText(cells[4] ?? '');
        const maxOutputTokens = numberFromText(cells[5] ?? '');
        const fileSizeLimit = stringValue(cells[6]);
        rows.push({
            id: providerModel,
            displayName: cells[0]?.replace(providerModel, '').trim() || providerModel,
            docsUrl: `${GROQ_DOCS_MODELS_URL}#${providerModel}`,
            pricing,
            rateLimits,
            limits: { contextWindowTokens, maxOutputTokens },
            speedTokensPerSecond,
            fileSizeLimit,
            sourceText: cells.join(' | '),
        });
    }
    return rows;
}

/**
 * @param {string} text
 * @returns {Record<string, { cacheReadUsdPerMillion?: number; inputUsdPerMillion?: number; outputUsdPerMillion?: number }>}
 */
function parsePromptCachingPrices(text) {
    /** @type {Record<string, { cacheReadUsdPerMillion?: number; inputUsdPerMillion?: number; outputUsdPerMillion?: number }>} */
    const result = {};
    for (const modelId of GROQ_PROMPT_CACHING_MODEL_IDS) {
        const index = text.indexOf(modelId);
        if (index < 0) continue;
        const window = text.slice(index, index + 700);
        const prices = [...window.matchAll(/\$+\s*([0-9]+(?:\.[0-9]+)?)/gu)].map((match) => Number(match[1])).filter(Number.isFinite);
        if (prices.length >= 3) {
            const inputUsdPerMillion = prices[0];
            const cacheReadUsdPerMillion = prices[1];
            const outputUsdPerMillion = prices[2];
            if (
                inputUsdPerMillion !== undefined &&
                cacheReadUsdPerMillion !== undefined &&
                outputUsdPerMillion !== undefined
            ) {
                result[modelId] = {
                    inputUsdPerMillion,
                    cacheReadUsdPerMillion,
                    outputUsdPerMillion,
                };
            }
        }
    }
    return result;
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseBuiltInToolPricing(text) {
    /** @type {Record<string, unknown>} */
    const tools = {};
    /** @type {Array<[string, RegExp]>} */
    const toolSpecs = [
        ['basicSearchUsdPerThousandRequests', /Basic Search[\s\S]{0,120}?\$+\s*([0-9]+(?:\.[0-9]+)?)/iu],
        ['advancedSearchUsdPerThousandRequests', /Advanced Search[\s\S]{0,120}?\$+\s*([0-9]+(?:\.[0-9]+)?)/iu],
        ['visitWebsiteUsdPerThousandRequests', /Visit Website[\s\S]{0,120}?\$+\s*([0-9]+(?:\.[0-9]+)?)/iu],
        ['codeExecutionUsdPerHour', /Code Execution[\s\S]{0,120}?\$+\s*([0-9]+(?:\.[0-9]+)?)/iu],
        ['browserAutomationUsdPerHour', /Browser Automation[\s\S]{0,120}?\$+\s*([0-9]+(?:\.[0-9]+)?)/iu],
    ];
    for (const [key, pattern] of toolSpecs) {
        const value = text.match(pattern)?.[1];
        const parsed = value ? Number(value) : NaN;
        if (Number.isFinite(parsed)) tools[key] = parsed;
    }
    return tools;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseGroqDocsRows(raw) {
    const modelsHtml = isRecord(raw) ? stringValue(raw['modelsHtml']) ?? '' : typeof raw === 'string' ? raw : '';
    const pricingHtml = isRecord(raw) ? stringValue(raw['pricingHtml']) ?? '' : '';
    const pricingText = htmlText(pricingHtml, { keepScripts: true, decodeBeforeStrip: true, unescapeJsStrings: true });
    const promptCachingPrices = parsePromptCachingPrices(pricingText);
    const builtInToolPricing = parseBuiltInToolPricing(pricingText);
    return parseModelRowsFromDocsHtml(modelsHtml).map((row, index) => {
        const providerModel = stringValue(row['id']);
        const promptCaching = providerModel ? promptCachingPrices[providerModel] : undefined;
        const providerPricing = index === 0 && Object.keys(builtInToolPricing).length > 0 ? { builtInToolPricing } : {};
        return promptCaching ? { ...row, promptCaching, ...providerPricing } : { ...row, ...providerPricing };
    });
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function modelEvidenceValues(row) {
    const providerModel = stringValue(row['id']);
    if (!providerModel) return [];
    const pricing = isRecord(row['pricing']) ? row['pricing'] : {};
    const promptCaching = isRecord(row['promptCaching']) ? row['promptCaching'] : {};
    const rateLimits = isRecord(row['rateLimits']) ? row['rateLimits'] : {};
    const limits = isRecord(row['limits']) ? row['limits'] : {};
    const aliases = normalizeModelAliases({ providerModel });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel,
        displayName: row['displayName'],
    });
    const modalities = modalitiesFromModelId(providerModel);
    const normalizedLimits = normalizeModelTokenLimits({
        contextWindowTokens: limits['contextWindowTokens'],
        maxOutputTokens: limits['maxOutputTokens'],
        tokensPerMinute: rateLimits['tokensPerMinute'],
        requestsPerMinute: rateLimits['requestsPerMinute'],
    });
    const normalizedPricing = normalizeUsdPricing({
        inputPerTokenUsd: pricing['inputUsdPerMillion'] ? Number(pricing['inputUsdPerMillion']) / 1_000_000 : undefined,
        outputPerTokenUsd: pricing['outputUsdPerMillion'] ? Number(pricing['outputUsdPerMillion']) / 1_000_000 : undefined,
        cacheReadPerTokenUsd: promptCaching['cacheReadUsdPerMillion']
            ? Number(promptCaching['cacheReadUsdPerMillion']) / 1_000_000
            : undefined,
    });
    const capabilities = capabilitiesFromModelId(providerModel);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['displayName']) ?? providerModel },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(normalizedLimits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        ...Object.entries(normalizedPricing).map(([key, value]) => ({ fieldPath: `pricing.${key}`, value })),
        { fieldPath: 'providerMetadata.ownedBy', value: 'groq' },
        { fieldPath: 'providerMetadata.groqDocs.docsUrl', value: stringValue(row['docsUrl']) },
        { fieldPath: 'providerMetadata.groqDocs.speedTokensPerSecond', value: row['speedTokensPerSecond'] },
        { fieldPath: 'providerMetadata.groqDocs.fileSizeLimit', value: stringValue(row['fileSizeLimit']) },
        { fieldPath: 'providerMetadata.groqDocs.rateLimits', value: rateLimits },
        { fieldPath: 'providerMetadata.groqDocs.pricing', value: pricing },
        { fieldPath: 'providerMetadata.groqDocs.promptCachingPricing', value: promptCaching },
        { fieldPath: 'providerMetadata.groqDocs.sourceText', value: stringValue(row['sourceText']) },
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
 * @param {string} [options.modelsUrl]
 * @param {string} [options.pricingUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createGroqDocsModelsImporter(options = {}) {
    const modelsUrl = options.modelsUrl ?? GROQ_DOCS_MODELS_URL;
    const pricingUrl = options.pricingUrl ?? GROQ_PRICING_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'groq-docs-models',
        providerId: 'groq',
        sourceKind: 'public_docs',
        requiresAuth: false,
        url: modelsUrl,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Groq docs catalog import');
            const [modelsResponse, pricingResponse] = await Promise.all([
                fetchImpl(modelsUrl, { headers: { accept: 'text/html' } }),
                fetchImpl(pricingUrl, { headers: { accept: 'text/html' } }),
            ]);
            if (!modelsResponse.ok) throw new Error(`Groq docs models fetch failed with HTTP ${modelsResponse.status}`);
            if (!pricingResponse.ok) throw new Error(`Groq pricing fetch failed with HTTP ${pricingResponse.status}`);
            return {
                modelsUrl,
                pricingUrl,
                modelsHtml: await modelsResponse.text(),
                pricingHtml: await pricingResponse.text(),
            };
        },
        parseRows: parseGroqDocsRows,
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'groq-docs-models';
            const builtInTools = rows
                .map((row) => (isRecord(row) && isRecord(row['builtInToolPricing']) ? row['builtInToolPricing'] : null))
                .find(isRecord);
            /** @type {Record<string, unknown>[]} */
            const evidences = [
                /** @type {Record<string, unknown>} */ (createProviderMetadataEvidence({
                    evidenceId: `${sourceId}:groq:providerMetadata.groqDocs.modelsUrl`,
                    providerId: 'groq',
                    subjectProviderId: 'groq',
                    fieldPath: 'providerMetadata.groqDocs.modelsUrl',
                    value: modelsUrl,
                    sourceId,
                    sourceKind: 'public_docs',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                    rawPayloadRef: context.rawPayloadRef,
                })),
                /** @type {Record<string, unknown>} */ (createProviderMetadataEvidence({
                    evidenceId: `${sourceId}:groq:providerMetadata.groqDocs.pricingUrl`,
                    providerId: 'groq',
                    subjectProviderId: 'groq',
                    fieldPath: 'providerMetadata.groqDocs.pricingUrl',
                    value: pricingUrl,
                    sourceId,
                    sourceKind: 'public_docs',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                    rawPayloadRef: context.rawPayloadRef,
                })),
            ];
            if (builtInTools && Object.keys(builtInTools).length > 0) {
                evidences.push(
                    /** @type {Record<string, unknown>} */ (createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:groq:providerMetadata.groqDocs.builtInToolPricing`,
                        providerId: 'groq',
                        subjectProviderId: 'groq',
                        fieldPath: 'providerMetadata.groqDocs.builtInToolPricing',
                        value: /** @type {Record<string, unknown>} */ (builtInTools),
                        sourceId,
                        sourceKind: 'public_docs',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    })),
                );
            }
            return evidences;
        },
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'groq-docs-models';
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
                        sourceKind: 'public_docs',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
    };
}
