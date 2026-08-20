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

export const MODEL_GATEWAY_ENDPOINT_RICHNESS_CATEGORIES = Object.freeze({
    identity: Object.freeze(['identity', 'owner', 'provider', 'upstream', 'catalog', 'docs', 'openapi']),
    pricing: Object.freeze(['pricing', 'price', 'prices', 'tiers', 'cost', 'cache', 'caching', 'web', 'search']),
    limits: Object.freeze(['limits', 'rate', 'context', 'tokens', 'parameters', 'quota']),
    capabilities: Object.freeze(['features', 'feature', 'capabilities', 'capability', 'modalities', 'multimodal', 'tool', 'tools', 'vision', 'audio']),
    routing: Object.freeze(['route', 'routing', 'provider', 'upstream', 'fallback', 'gateway', 'selectors']),
    lifecycle: Object.freeze(['lifecycle', 'deprecation', 'deprecated', 'retirement', 'status']),
    dataPolicy: Object.freeze(['privacy', 'policy', 'confidential', 'compute', 'retention', 'byok']),
    runtime: Object.freeze(['runtime', 'schema', 'streaming', 'endpoint', 'operational', 'setup']),
    account: Object.freeze(['account', 'authenticated', 'local', 'daemon']),
});

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
 * @param {unknown} value
 * @returns {{ raw: string | null; tags: string[]; categories: string[]; coverage: Record<string, boolean | number> }}
 */
export function normalizeProviderEndpointRichness(value) {
    const raw = optionalString(value);
    const tags = richnessTags(raw);
    const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
    const categories = Object.entries(MODEL_GATEWAY_ENDPOINT_RICHNESS_CATEGORIES)
        .filter(([, aliases]) => aliases.some((alias) => tagSet.has(alias)))
        .map(([category]) => category)
        .sort();
    return {
        raw,
        tags,
        categories,
        coverage: {
            tagCount: tags.length,
            categoryCount: categories.length,
            hasIdentity: categories.includes('identity'),
            hasPricing: categories.includes('pricing'),
            hasLimits: categories.includes('limits'),
            hasCapabilities: categories.includes('capabilities'),
            hasRouting: categories.includes('routing'),
            hasLifecycle: categories.includes('lifecycle'),
            hasDataPolicy: categories.includes('dataPolicy'),
            hasRuntime: categories.includes('runtime'),
            hasAccount: categories.includes('account'),
        },
    };
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
 * @param {Record<string, unknown>} inventory
 * @param {'catalog' | 'runtime'} target
 * @param {Record<string, unknown>} source
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
    const richnessSummary = normalizeProviderEndpointRichness(richness);
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
        richnessTags: richnessSummary.tags,
        richnessCategories: richnessSummary.categories,
        richnessCoverage: richnessSummary.coverage,
        routeSelectors: stringList(inventory['routeSelectors']),
        baseUrls: stringList(inventory['baseUrls']),
    };
}

/**
 * @param {readonly Record<string, unknown>[]} inventories
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
 * @param {readonly Record<string, unknown>[]} input.inventories
 * @param {readonly Record<string, unknown>[]} input.importers
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
