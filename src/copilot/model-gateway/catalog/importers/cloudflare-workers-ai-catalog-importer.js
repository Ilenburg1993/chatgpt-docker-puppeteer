// @ts-check
/**
 * Cloudflare Workers AI and AI Gateway catalog importer.
 *
 * Workers AI model metadata is published as a docs/catalog surface rather than a simple OpenAI-compatible `/models`
 * list. This importer accepts the public catalog shape when available and keeps direct Workers AI routes separate from
 * AI Gateway universal/provider routes.
 *
 * @module copilot/model-gateway/catalog/importers/cloudflare-workers-ai-catalog-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
} from '../contracts.js';
import {
    normalizeAccountOverlayControls,
    normalizeCatalogModalities,
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelModalities,
    normalizeModelTokenLimits,
} from '../normalizers.js';
import { readCatalogResponseJson, readCatalogResponseText } from './response-body.js';

export const CLOUDFLARE_WORKERS_AI_MODELS_CATALOG_URL = 'https://developers.cloudflare.com/ai/models/';
export const CLOUDFLARE_WORKERS_AI_REST_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai';
export const CLOUDFLARE_WORKERS_AI_OPENAI_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1';
export const CLOUDFLARE_AI_GATEWAY_UNIVERSAL_URL = 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}';

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
 * @returns {boolean | null}
 */
function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    const text = stringValue(value)?.toLowerCase();
    if (text === 'true' || text === 'yes' || text === 'supported') return true;
    if (text === 'false' || text === 'no') return false;
    return null;
}

const CLOUDFLARE_TASK_TYPES = Object.freeze([
    'Automatic Speech Recognition',
    'Voice Activity Detection',
    'Image Classification',
    'Music Generation',
    'Object Detection',
    'Text Classification',
    'Text Embeddings',
    'Text Generation',
    'Text-to-Image',
    'Text-to-Speech',
    'Text-to-Video',
    'Image-to-Text',
    'Image-to-Video',
    'Summarization',
    'Translation',
]);

/**
 * @param {string} value
 * @returns {number | null}
 */
function compactTokenCount(value) {
    const match = value.replace(/,/gu, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?/iu);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(amount * multiplier);
}

/**
 * @param {string} text
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromText(text) {
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (/function calling|tool calling/iu.test(text)) capabilities['function_calling'] = true;
    if (/reasoning/iu.test(text)) capabilities['reasoning'] = true;
    if (/vision|multimodal|image inputs?/iu.test(text)) capabilities['vision'] = true;
    if (/\bbatch\b/iu.test(text)) capabilities['batch'] = true;
    if (/\blora\b/iu.test(text)) capabilities['lora'] = true;
    if (/real[- ]time/iu.test(text)) capabilities['real_time'] = true;
    return capabilities;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function contextWindowFromText(text) {
    const match = text.match(/(\d+(?:[,.]\d+)?\s*[kKmMbB]?|\d{4,})\s*(?:token\s+)?context window/iu);
    return match?.[1] ? compactTokenCount(match[1]) : null;
}

/**
 * @param {string} markdown
 * @returns {Record<string, unknown>[]}
 */
function parseRowsFromMarkdown(markdown) {
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    const linkPattern = /\[([\s\S]*?)\]\(https:\/\/developers\.cloudflare\.com\/ai\/models\/([^)]*?)\/\)/gu;
    for (const match of markdown.matchAll(linkPattern)) {
        const rawText = match[1] ?? '';
        const path = match[2] ?? '';
        const id = decodeURIComponent(path);
        if (!id) continue;
        const text = rawText
            .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
            .replace(/[📌\\]/gu, '')
            .replace(/\s+/gu, ' ')
            .trim();
        const taskPattern = new RegExp(
            `(${CLOUDFLARE_TASK_TYPES.map((task) => task.replace(/[\\^$*+?.()|[\]{}]/gu, '\\$&')).join('|')})\\s*•\\s*([^•]+)\\s*•\\s*(Hosted|Proxied)`,
            'iu',
        );
        const taskMatch = text.match(taskPattern);
        const displayName =
            (taskMatch?.index ? text.slice(0, taskMatch.index).trim() : '') || id.split('/').at(-1) || id;
        const task = taskMatch?.[1]?.trim() ?? null;
        const author = taskMatch?.[2]?.trim() ?? null;
        const hosting = taskMatch?.[3]?.trim() ?? null;
        const description = taskMatch ? text.slice((taskMatch.index ?? 0) + taskMatch[0].length).trim() : text;
        rows.push({
            id,
            model: id,
            display_name: displayName,
            name: displayName,
            task,
            author,
            hosting,
            platform: 'Cloudflare AI',
            description,
            docs_url: `https://developers.cloudflare.com/ai/models/${path}/`,
            context_window: contextWindowFromText(description),
            capabilities: capabilitiesFromText(`${description} ${text}`),
            markdownCardText: text,
        });
    }
    return rows;
}

/**
 * @param {string} html
 * @returns {Record<string, unknown>[]}
 */
function parseRowsFromHtml(html) {
    const rows = [];
    const seen = new Set();
    const pattern = /@cf\/[a-z0-9._/-]+/giu;
    for (const match of html.matchAll(pattern)) {
        const id = match[0];
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, model: id });
    }
    return rows;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseCloudflareRows(raw) {
    if (typeof raw === 'string') {
        return raw.includes('https://developers.cloudflare.com/ai/models/')
            ? parseRowsFromMarkdown(raw)
            : parseRowsFromHtml(raw);
    }
    const candidates = [
        isRecord(raw) ? raw['data'] : null,
        isRecord(raw) ? raw['models'] : null,
        isRecord(raw) ? raw['result'] : null,
        raw,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.filter(isRecord);
        if (isRecord(candidate) && Array.isArray(candidate['models'])) return candidate['models'].filter(isRecord);
    }
    return [];
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function providerModel(row) {
    return stringValue(row['id']) ?? stringValue(row['model']) ?? stringValue(row['name']);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, boolean>}
 */
function capabilitiesFromRow(row) {
    const capabilities = isRecord(row['capabilities']) ? row['capabilities'] : {};
    const task = (stringValue(row['task']) ?? stringValue(row['task_type']) ?? '').toLowerCase();
    /** @type {Record<string, boolean>} */
    const normalized = {};
    if (task.includes('text generation') || task.includes('summarization') || task.includes('translation'))
        normalized['chat'] = true;
    if (task.includes('embedding')) normalized['embeddings'] = true;
    if (task.includes('rerank')) normalized['rerank'] = true;
    if (task.includes('image')) normalized['vision'] = true;
    if (task.includes('speech') || task.includes('audio')) normalized['audio'] = true;
    if (booleanValue(capabilities['reasoning'] ?? row['reasoning']) === true) normalized['reasoning'] = true;
    if (booleanValue(capabilities['function_calling'] ?? capabilities['tools'] ?? row['function_calling']) === true)
        normalized['tools'] = true;
    if (booleanValue(capabilities['vision'] ?? row['vision']) === true) normalized['vision'] = true;
    if (booleanValue(capabilities['batch'] ?? row['batch']) === true) normalized['batch'] = true;
    if (booleanValue(capabilities['lora'] ?? row['lora']) === true) normalized['lora'] = true;
    if (booleanValue(capabilities['real_time'] ?? row['real_time']) === true) normalized['realTime'] = true;
    return normalized;
}

/**
 * @param {string | null} task
 * @param {Record<string, boolean>} capabilities
 * @returns {{ input: string[]; output: string[] }}
 */
function modalitiesFromTask(task, capabilities) {
    const normalizedTask = (task ?? '').toLowerCase();
    if (normalizedTask.includes('text-to-image'))
        return normalizeModelModalities({ input: ['text'], output: ['image'] });
    if (normalizedTask.includes('text-to-speech'))
        return normalizeModelModalities({ input: ['text'], output: ['audio'] });
    if (normalizedTask.includes('text-to-video'))
        return normalizeModelModalities({ input: ['text'], output: ['video'] });
    if (normalizedTask.includes('image-to-video'))
        return normalizeModelModalities({ input: ['image'], output: ['video'] });
    if (normalizedTask.includes('image-to-text'))
        return normalizeModelModalities({ input: ['image'], output: ['text'] });
    if (normalizedTask.includes('speech') || normalizedTask.includes('audio'))
        return normalizeModelModalities({ input: ['audio'], output: ['text'] });
    if (capabilities['vision']) return normalizeModelModalities({ input: ['text', 'image'], output: ['text'] });
    return normalizeModelModalities({
        input: normalizeCatalogModalities(['text']),
        output: normalizeCatalogModalities(['text']),
    });
}

/**
 * @param {string} template
 * @param {string | undefined} accountId
 * @param {string | undefined} gatewayId
 * @returns {string}
 */
function fillCloudflareTemplate(template, accountId, gatewayId) {
    return template
        .replace('{account_id}', accountId ?? '{account_id}')
        .replace('{gateway_id}', gatewayId ?? '{gateway_id}');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ fieldPath: string; value: unknown }[]}
 */
function modelEvidenceValues(row) {
    const id = providerModel(row);
    const capabilities = capabilitiesFromRow(row);
    const task = stringValue(row['task']) ?? stringValue(row['task_type']);
    const modalities = modalitiesFromTask(task, capabilities);
    const aliases = normalizeModelAliases({ providerModel: id, huggingFaceId: stringValue(row['hugging_face_id']) });
    const identityTraits = normalizeModelIdentityTraits({
        providerModel: id,
        displayName: stringValue(row['display_name']) ?? stringValue(row['name']),
        huggingFaceId: stringValue(row['hugging_face_id']),
    });
    const limits = normalizeModelTokenLimits({
        contextWindowTokens: row['context_window'] ?? row['context_length'],
        maxOutputTokens: row['max_output_tokens'] ?? row['max_tokens'],
    });
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['display_name']) ?? stringValue(row['name']) ?? id },
        { fieldPath: 'description', value: stringValue(row['description']) },
        ...Object.entries(aliases).map(([key, value]) => ({ fieldPath: `aliases.${key}`, value })),
        ...Object.entries(limits).map(([key, value]) => ({ fieldPath: `limits.${key}`, value })),
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `capabilities.${key}`, value })),
        { fieldPath: 'modalities.input', value: modalities.input },
        { fieldPath: 'modalities.output', value: modalities.output },
        { fieldPath: 'providerMetadata.ownedBy', value: 'cloudflare' },
        { fieldPath: 'providerMetadata.cloudflare.task', value: task },
        {
            fieldPath: 'providerMetadata.cloudflare.author',
            value: stringValue(row['author']) ?? stringValue(row['provider']),
        },
        { fieldPath: 'providerMetadata.cloudflare.platform', value: stringValue(row['platform']) },
        {
            fieldPath: 'providerMetadata.cloudflare.hosting',
            value: stringValue(row['hosting']) ?? stringValue(row['availability']),
        },
        { fieldPath: 'providerMetadata.cloudflare.partner', value: booleanValue(row['partner']) },
        {
            fieldPath: 'providerMetadata.cloudflare.docsUrl',
            value: stringValue(row['docs_url']) ?? stringValue(row['url']),
        },
        { fieldPath: 'providerMetadata.cloudflare.rawCapabilities', value: row['capabilities'] },
        ...Object.entries(identityTraits).map(([key, value]) => ({
            fieldPath: `providerMetadata.modelTraits.${key}`,
            value,
        })),
        { fieldPath: 'openai.owned_by', value: 'cloudflare' },
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
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.apiToken]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountId]
 * @param {string} [options.gatewayId]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createCloudflareWorkersAiCatalogImporter(options = {}) {
    const url = options.url ?? CLOUDFLARE_WORKERS_AI_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const sourceKind = options.apiToken ? 'authenticated_api' : 'public_catalog';
    return {
        id: 'cloudflare-workers-ai-catalog',
        providerId: 'cloudflare-workers-ai',
        sourceKind,
        requiresAuth: Boolean(options.apiToken),
        url,
        envRequirements: [
            'CLOUDFLARE_API_TOKEN',
            'CLOUDFLARE_KEY',
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_AI_GATEWAY_ID',
        ],
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function')
                throw new Error('fetch is unavailable for Cloudflare Workers AI catalog import');
            const headers = options.apiToken
                ? { accept: 'application/json,text/markdown,text/html', authorization: `Bearer ${options.apiToken}` }
                : { accept: 'application/json,text/markdown,text/html' };
            const response = await fetchImpl(url, { headers });
            if (!response.ok)
                throw new Error(`Cloudflare Workers AI catalog fetch failed with HTTP ${response.status}`);
            const contentType = response.headers?.get?.('content-type') ?? '';
            return contentType.includes('application/json')
                ? readCatalogResponseJson(response, { label: 'Cloudflare Workers AI catalog' })
                : readCatalogResponseText(response, { label: 'Cloudflare Workers AI catalog' });
        },
        parseRows: parseCloudflareRows,
        toEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cloudflare-workers-ai-catalog';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const id = providerModel(record);
                if (!id) return [];
                return modelEvidenceValues(record).map((item) =>
                    createModelMetadataEvidence({
                        evidenceId: `${sourceId}:${id}:${item.fieldPath}`,
                        providerId: 'cloudflare-workers-ai',
                        providerModel: id,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind,
                        confidence: options.apiToken
                            ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                            : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
        toRouteOptions(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cloudflare-workers-ai-catalog';
            const restBaseUrl = fillCloudflareTemplate(
                CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
                options.accountId,
                options.gatewayId,
            );
            const openAIBaseUrl = fillCloudflareTemplate(
                CLOUDFLARE_WORKERS_AI_OPENAI_BASE_URL,
                options.accountId,
                options.gatewayId,
            );
            const gatewayUrl = fillCloudflareTemplate(
                CLOUDFLARE_AI_GATEWAY_UNIVERSAL_URL,
                options.accountId,
                options.gatewayId,
            );
            return rows.flatMap((row) => {
                const record = isRecord(row) ? row : {};
                const id = providerModel(record);
                if (!id) return [];
                const directRoute = createModelRouteOption({
                    providerId: 'cloudflare-workers-ai',
                    providerModel: id,
                    selectorKind: 'exact_model',
                    selectorSyntax: id,
                    sourceId,
                    sourceKind,
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                    normalizedPolicy: {
                        routeLayer: 'direct_provider',
                        wireApi: 'workers_ai_run',
                        endpoint: `${restBaseUrl}/run/${id}`,
                        openAICompatibleBaseUrl: openAIBaseUrl,
                    },
                });
                const gatewayRoute = createModelRouteOption({
                    providerId: 'cloudflare-workers-ai',
                    providerModel: id,
                    selectorKind: 'gateway_fallback',
                    selectorSyntax: `cloudflare-gateway:${id}`,
                    sourceId,
                    sourceKind,
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                    normalizedPolicy: {
                        routeLayer: 'gateway',
                        wireApi: 'cloudflare_ai_gateway_universal',
                        universalEndpoint: gatewayUrl,
                        provider: 'workers-ai',
                        endpoint: id,
                        supportsFallback: true,
                        supportsRetry: true,
                        supportsCache: true,
                    },
                });
                return [directRoute, gatewayRoute];
            });
        },
        toAccountOverlays(rows, context) {
            if (!options.apiToken && !options.accountId && !options.gatewayId) return [];
            const sourceId = stringValue(context.source['id']) ?? 'cloudflare-workers-ai-catalog';
            const enabledModels = rows
                .map((row) => (isRecord(row) ? providerModel(row) : null))
                .filter((model) => model !== null);
            const controls = normalizeAccountOverlayControls({
                enabledModels,
                providerMetadata: {
                    endpoint: '/client/v4/accounts/{account_id}/ai/run/{model}',
                    openAICompatibleEndpoint: '/client/v4/accounts/{account_id}/ai/v1',
                    aiGatewayUniversalEndpoint: '/v1/{account_id}/{gateway_id}',
                    accountIdConfigured: Boolean(options.accountId),
                    gatewayIdConfigured: Boolean(options.gatewayId),
                    supportsFallback: true,
                    supportsRetry: true,
                    supportsCache: true,
                },
            });
            return [
                createProviderAccountOverlay({
                    accountOverlayId: `cloudflare-workers-ai:${options.accountId ?? 'account'}:${options.gatewayId ?? 'gateway'}:${sourceId}`,
                    providerId: 'cloudflare-workers-ai',
                    accountScope: options.accountId ?? 'default',
                    secretRef: options.secretRef,
                    sourceId,
                    sourceKind,
                    confidence: options.apiToken
                        ? MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG
                        : MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                    enabledModels: controls.enabledModels,
                    providerMetadata: controls.providerMetadata,
                }),
            ];
        },
    };
}
