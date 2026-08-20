// @ts-check
/**
 * Kilo Gateway public `/providers` importer.
 *
 * Provider metadata is intentionally separate from model metadata: upstream provider data policy, regions and icons are
 * shared facts that should not be duplicated across every model row.
 *
 * @module copilot/model-gateway/catalog/importers/kilo-gateway-providers-importer
 */

import { MODEL_GATEWAY_CATALOG_CONFIDENCE, createProviderMetadataEvidence } from '../contracts.js';
import { readCatalogResponseJson } from './response-body.js';

export const KILO_GATEWAY_PROVIDERS_CATALOG_URL = 'https://api.kilo.ai/api/gateway/providers';

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
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function parseKiloProviderRows(raw) {
    const data = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw['data']) ? raw['data'] : [];
    return data.filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readDataPolicy(row) {
    return isRecord(row['dataPolicy']) ? row['dataPolicy'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readIcon(row) {
    return isRecord(row['icon']) ? row['icon'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ fieldPath: string; value: unknown }[]}
 */
function providerEvidenceValues(row) {
    const dataPolicy = readDataPolicy(row);
    const icon = readIcon(row);
    const values = [
        { fieldPath: 'displayName', value: stringValue(row['displayName']) ?? stringValue(row['name']) },
        { fieldPath: 'providerMetadata.kilo.name', value: stringValue(row['name']) },
        { fieldPath: 'providerMetadata.kilo.slug', value: stringValue(row['slug']) },
        { fieldPath: 'providerMetadata.kilo.headquarters', value: stringValue(row['headquarters']) },
        { fieldPath: 'providerMetadata.kilo.datacenters', value: stringList(row['datacenters']) },
        { fieldPath: 'providerMetadata.kilo.iconUrl', value: stringValue(icon['url']) },
        { fieldPath: 'dataPolicy.training', value: dataPolicy['training'] },
        { fieldPath: 'dataPolicy.retainsPrompts', value: dataPolicy['retainsPrompts'] },
        { fieldPath: 'dataPolicy.canPublish', value: dataPolicy['canPublish'] },
    ];
    return values.filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        return true;
    });
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createKiloGatewayProvidersImporter(options = {}) {
    const url = options.url ?? KILO_GATEWAY_PROVIDERS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'kilo-gateway-providers',
        providerId: 'kilo',
        sourceKind: 'public_gateway_api',
        requiresAuth: false,
        url,
        refreshPolicy: 'scheduled',
        ttlSeconds: 3600,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function')
                throw new Error('fetch is unavailable for Kilo Gateway providers import');
            const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`Kilo Gateway providers fetch failed with HTTP ${response.status}`);
            return readCatalogResponseJson(response, { label: 'Kilo Gateway providers' });
        },
        parseRows: parseKiloProviderRows,
        toEvidenceFacts() {
            return [];
        },
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'kilo-gateway-providers';
            return rows.flatMap((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const subjectProviderId = stringValue(record['slug']) ?? stringValue(record['name']);
                if (!subjectProviderId) return [];
                return providerEvidenceValues(record).map((item) =>
                    createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:${subjectProviderId}:${item.fieldPath}`,
                        providerId: 'kilo',
                        subjectProviderId,
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'public_gateway_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                );
            });
        },
    };
}
