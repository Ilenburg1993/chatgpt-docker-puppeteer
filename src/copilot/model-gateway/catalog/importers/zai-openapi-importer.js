// @ts-check
/**
 * Z.AI OpenAPI structural importer.
 *
 * Pricing docs identify models; OpenAPI identifies the provider wire contract. This importer keeps those separate and
 * emits provider-level evidence about endpoints, parameters and schemas without inventing model facts.
 *
 * @module copilot/model-gateway/catalog/importers/zai-openapi-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createProviderMetadataEvidence,
} from '../contracts.js';
import { ZAI_CHAT_COMPLETIONS_PATH, ZAI_OPENAPI_URL } from './zai-models-importer.js';
import { readCatalogResponseJson } from './response-body.js';

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
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(stringValue).filter((item) => item !== null))];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectObjectKeys(value) {
    /** @type {Set<string>} */
    const keys = new Set();
    /** @param {unknown} item */
    function visit(item) {
        if (Array.isArray(item)) {
            for (const child of item) visit(child);
            return;
        }
        if (!isRecord(item)) return;
        for (const [key, child] of Object.entries(item)) {
            keys.add(key);
            visit(child);
        }
    }
    visit(value);
    return [...keys].sort();
}

/**
 * @param {Record<string, unknown>} openapi
 * @returns {Record<string, unknown>}
 */
function chatCompletionOperation(openapi) {
    const paths = isRecord(openapi['paths']) ? openapi['paths'] : {};
    const exact = isRecord(paths[ZAI_CHAT_COMPLETIONS_PATH]) ? paths[ZAI_CHAT_COMPLETIONS_PATH] : {};
    const candidates = Object.entries(paths).filter(([path]) => path.endsWith(ZAI_CHAT_COMPLETIONS_PATH));
    const pathRecord = Object.keys(exact).length > 0 ? exact : isRecord(candidates[0]?.[1]) ? candidates[0][1] : {};
    return isRecord(pathRecord['post']) ? pathRecord['post'] : {};
}

/**
 * @param {Record<string, unknown>} operation
 * @returns {Record<string, unknown>}
 */
function requestSchema(operation) {
    const requestBody = isRecord(operation['requestBody']) ? operation['requestBody'] : {};
    const content = isRecord(requestBody['content']) ? requestBody['content'] : {};
    const json = isRecord(content['application/json']) ? content['application/json'] : {};
    return isRecord(json['schema']) ? json['schema'] : {};
}

/**
 * @param {Record<string, unknown>} schema
 * @returns {string[]}
 */
function requestParameterNames(schema) {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    return Object.keys(properties).sort();
}

/**
 * @param {Record<string, unknown>} schema
 * @returns {Record<string, boolean>}
 */
function capabilityHints(schema) {
    const keys = new Set([...collectObjectKeys(schema), ...requestParameterNames(schema)].map((key) => key.toLowerCase()));
    return {
        chat: true,
        streaming: keys.has('stream'),
        tools: keys.has('tools'),
        forcedToolChoice: keys.has('tool_choice') || keys.has('toolchoice'),
        structuredOutputs: keys.has('response_format') || keys.has('responseformat'),
        jsonMode: keys.has('response_format') || keys.has('json_schema') || keys.has('jsonschema'),
        reasoning:
            keys.has('thinking') ||
            keys.has('reasoning') ||
            keys.has('reasoning_effort') ||
            keys.has('reasoningeffort') ||
            keys.has('include_reasoning'),
        webSearch: keys.has('web_search') || keys.has('websearch') || keys.has('search_parameters'),
        multimodal: keys.has('image_url') || keys.has('input_image') || keys.has('content_part'),
    };
}

/**
 * @param {Record<string, unknown>} openapi
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function providerEvidenceValues(openapi) {
    const paths = isRecord(openapi['paths']) ? openapi['paths'] : {};
    const operation = chatCompletionOperation(openapi);
    const schema = requestSchema(operation);
    const parameters = requestParameterNames(schema);
    const capabilities = capabilityHints(schema);
    const values = [
        { fieldPath: 'providerMetadata.zai.openapi.url', value: ZAI_OPENAPI_URL },
        { fieldPath: 'providerMetadata.zai.openapi.openapiVersion', value: stringValue(openapi['openapi']) },
        { fieldPath: 'providerMetadata.zai.openapi.title', value: isRecord(openapi['info']) ? stringValue(openapi['info']['title']) : null },
        { fieldPath: 'providerMetadata.zai.openapi.version', value: isRecord(openapi['info']) ? stringValue(openapi['info']['version']) : null },
        { fieldPath: 'providerMetadata.zai.openapi.paths', value: Object.keys(paths).sort() },
        { fieldPath: 'providerMetadata.zai.openapi.chatCompletionsPath', value: ZAI_CHAT_COMPLETIONS_PATH },
        { fieldPath: 'providerMetadata.zai.openapi.chatCompletionsOperationId', value: stringValue(operation['operationId']) },
        { fieldPath: 'providerMetadata.zai.openapi.chatCompletionsTags', value: stringList(operation['tags']) },
        { fieldPath: 'providerMetadata.zai.openapi.chatCompletionsParameters', value: parameters },
        ...Object.entries(capabilities).map(([key, value]) => ({ fieldPath: `providerMetadata.zai.openapi.capabilities.${key}`, value })),
        { fieldPath: 'providerMetadata.zai.openapi.requiredRequestFields', value: stringList(schema['required']) },
    ];
    return values.filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        return true;
    });
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
export function parseZaiOpenApiRows(raw) {
    return isRecord(raw) ? [raw] : [];
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createZaiOpenApiImporter(options = {}) {
    const url = options.url ?? ZAI_OPENAPI_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'zai-openapi',
        providerId: 'zai',
        sourceKind: 'openapi',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Z.AI OpenAPI import');
            const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`Z.AI OpenAPI fetch failed with HTTP ${response.status}`);
            return readCatalogResponseJson(response, { label: 'Z.AI OpenAPI' });
        },
        parseRows: parseZaiOpenApiRows,
        toEvidenceFacts() {
            return [];
        },
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'zai-openapi';
            return rows.flatMap((row) =>
                providerEvidenceValues(/** @type {Record<string, unknown>} */ (row)).map((item) =>
                    createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:zai:${item.fieldPath}`,
                        providerId: 'zai',
                        subjectProviderId: 'zai',
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'openapi',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.DOCS,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                ),
            );
        },
    };
}
