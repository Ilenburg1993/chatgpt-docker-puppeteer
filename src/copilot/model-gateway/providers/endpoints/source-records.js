// @ts-check
/**
 * Normalized endpoint-source records for provider metadata and runtime inventory.
 *
 * Endpoint inventory files are provider-authored facts. This module projects those facts into stable, auditable records
 * that catalog refresh, coverage reports and pre-runtime planning can consume without importing provider adapters.
 *
 * @module copilot/model-gateway/providers/endpoints/source-records
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
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function idPart(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.:@/-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'unknown';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {string} locator
 * @returns {string[]}
 */
function placeholders(locator) {
    return [...new Set([...locator.matchAll(/\{([a-z0-9_.-]+)\}/giu)].map((match) => match[1]).filter((item) => item !== undefined))].sort();
}

/**
 * @param {string | null} richness
 * @returns {string[]}
 */
function richnessTags(richness) {
    if (!richness) return [];
    return [...new Set(richness.split(/[_\s,|/+-]+/u).map((item) => item.trim()).filter(Boolean))].sort();
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function requiresAuth(kind) {
    return /(?:authenticated|account|local_daemon)/iu.test(kind);
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isPublicSource(kind) {
    return /(?:public|docs|openapi)/iu.test(kind) && !/authenticated/iu.test(kind);
}

/**
 * @param {string} locator
 * @returns {boolean}
 */
function isLocalLocator(locator) {
    return /(?:localhost|127\.0\.0\.1|\{account_id\}|\{gateway_id\})/iu.test(locator);
}

/**
 * @param {Record<string, any>} inventory
 * @param {'catalog' | 'runtime'} target
 * @param {Record<string, any>} source
 * @returns {Record<string, any>}
 */
function endpointSourceRecord(inventory, target, source) {
    const providerId = optionalString(inventory['providerId']) ?? 'unknown-provider';
    const adapterId = optionalString(inventory['adapterId']) ?? providerId;
    const providerKind = optionalString(inventory['providerKind']) ?? 'unknown';
    const kind = optionalString(source['kind']) ?? 'unknown';
    const method = (optionalString(source['method']) ?? 'GET').toUpperCase();
    const locator = optionalString(source['url']) ?? optionalString(source['path']) ?? '';
    const placeholderNames = placeholders(locator);
    const richness = optionalString(source['richness']);
    return {
        id: [providerId, target, kind, method, idPart(locator || kind)].join(':'),
        providerId,
        adapterId,
        providerKind,
        target,
        kind,
        method,
        locator,
        url: optionalString(source['url']),
        path: optionalString(source['path']),
        authRequired: requiresAuth(kind),
        publicSource: isPublicSource(kind),
        localOrParameterized: isLocalLocator(locator),
        placeholders: placeholderNames,
        hasPlaceholders: placeholderNames.length > 0,
        richness,
        richnessTags: richnessTags(richness),
        routeSelectors: stringList(inventory['routeSelectors']),
        baseUrls: stringList(inventory['baseUrls']),
    };
}

/**
 * @param {readonly Record<string, any>[]} inventories
 * @returns {Record<string, any>[]}
 */
export function listProviderEndpointSourceRecords(inventories) {
    return inventories.flatMap((inventory) => [
        ...(Array.isArray(inventory['modelCatalogSources']) ? inventory['modelCatalogSources'].filter(isRecord) : []).map((source) =>
            endpointSourceRecord(inventory, 'catalog', source),
        ),
        ...(Array.isArray(inventory['runtimeEndpoints']) ? inventory['runtimeEndpoints'].filter(isRecord) : []).map((source) =>
            endpointSourceRecord(inventory, 'runtime', source),
        ),
    ]);
}

/**
 * @param {object} input
 * @param {readonly Record<string, any>[]} input.inventories
 * @param {readonly Record<string, any>[]} input.importers
 * @returns {Array<{ providerId: string; catalogSourceCount: number; importerCount: number; coveredCatalogSourceCount: number; uncoveredCatalogSourceIds: string[] }>}
 */
export function auditProviderEndpointImporterCoverage(input) {
    const importers = Array.isArray(input.importers) ? input.importers.filter(isRecord) : [];
    const catalogSources = listProviderEndpointSourceRecords(input.inventories).filter((source) => source['target'] === 'catalog');
    const providers = [...new Set(catalogSources.map((source) => String(source['providerId'])))].sort();
    return providers.map((providerId) => {
        const providerSources = catalogSources.filter((source) => source['providerId'] === providerId);
        const providerImporters = importers.filter((importer) => importer['providerId'] === providerId || importer['providerId'] === `${providerId}-local`);
        const covered = providerSources.filter((source) =>
            providerImporters.some(
                (importer) =>
                    optionalString(importer['url']) === source['url'] ||
                    optionalString(importer['sourceKind']) === source['kind'],
            ),
        );
        return {
            providerId,
            catalogSourceCount: providerSources.length,
            importerCount: providerImporters.length,
            coveredCatalogSourceCount: covered.length,
            uncoveredCatalogSourceIds: providerSources.filter((source) => !covered.includes(source)).map((source) => String(source['id'])),
        };
    });
}
