// @ts-check
/**
 * Catalog importer audit helpers.
 *
 * The audit is intentionally pre-runtime: it inspects importer metadata and endpoint inventory coverage without
 * fetching provider data or executing model probes.
 *
 * @module copilot/model-gateway/catalog/importer-audit
 */

import { MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY, auditProviderEndpointImporterCoverage } from '../providers/index.js';

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
 * @param {Record<string, unknown>} importer
 * @returns {{ id: string; providerId: string; sourceKind: string; requiresAuth: boolean; url: string | null; command: string | null; envRequirements: string[]; refreshPolicy: string | null; ttlSeconds: number | null; hooks: Record<string, boolean> }}
 */
export function describeCatalogImporter(importer) {
    return {
        id: optionalString(importer['id']) ?? 'unknown-importer',
        providerId: optionalString(importer['providerId']) ?? 'unknown-provider',
        sourceKind: optionalString(importer['sourceKind']) ?? 'unknown',
        requiresAuth: importer['requiresAuth'] === true,
        url: optionalString(importer['url']),
        command: optionalString(importer['command']),
        envRequirements: Array.isArray(importer['envRequirements'])
            ? importer['envRequirements'].map(optionalString).filter((item) => item !== null)
            : [],
        refreshPolicy: optionalString(importer['refreshPolicy']),
        ttlSeconds: typeof importer['ttlSeconds'] === 'number' && Number.isFinite(importer['ttlSeconds']) ? importer['ttlSeconds'] : null,
        hooks: {
            fetchRaw: typeof importer['fetchRaw'] === 'function',
            parseRows: typeof importer['parseRows'] === 'function',
            toEvidenceFacts: typeof importer['toEvidenceFacts'] === 'function',
            toProviderEvidenceFacts: typeof importer['toProviderEvidenceFacts'] === 'function',
            toRouteOptions: typeof importer['toRouteOptions'] === 'function',
            toAccountOverlays: typeof importer['toAccountOverlays'] === 'function',
        },
    };
}

/**
 * @param {Record<string, unknown>[]} importers
 * @param {{ inventories?: readonly Record<string, unknown>[] }} [options]
 * @returns {{
 *   importerCount: number;
 *   providerCount: number;
 *   publicImporterCount: number;
 *   authenticatedImporterCount: number;
 *   routeOptionImporterCount: number;
 *   accountOverlayImporterCount: number;
 *   providerEvidenceImporterCount: number;
 *   descriptors: ReturnType<typeof describeCatalogImporter>[];
 *   endpointCoverage: ReturnType<typeof auditProviderEndpointImporterCoverage>;
 *   providersWithoutImporters: string[];
 *   uncoveredCatalogSourceIds: string[];
 *   missingRequiredHooks: string[];
 * }}
 */
export function auditCatalogImporterSet(importers, options = {}) {
    const cleanImporters = Array.isArray(importers) ? importers.filter(isRecord) : [];
    const descriptors = cleanImporters.map(describeCatalogImporter);
    const endpointCoverage = auditProviderEndpointImporterCoverage({
        inventories: options.inventories ?? MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY,
        importers: cleanImporters,
    });
    const providerIds = new Set(descriptors.map((descriptor) => descriptor.providerId));
    const providersWithoutImporters = endpointCoverage
        .filter((row) => row.catalogSourceCount > 0 && !providerIds.has(row.providerId))
        .map((row) => row.providerId)
        .sort();
    const uncoveredCatalogSourceIds = endpointCoverage.flatMap((row) => row.uncoveredCatalogSourceIds).sort();
    const missingRequiredHooks = descriptors
        .filter((descriptor) => !descriptor.hooks['fetchRaw'] || !descriptor.hooks['parseRows'] || !descriptor.hooks['toEvidenceFacts'])
        .map((descriptor) => descriptor.id)
        .sort();
    return {
        importerCount: descriptors.length,
        providerCount: providerIds.size,
        publicImporterCount: descriptors.filter((descriptor) => !descriptor.requiresAuth).length,
        authenticatedImporterCount: descriptors.filter((descriptor) => descriptor.requiresAuth).length,
        routeOptionImporterCount: descriptors.filter((descriptor) => descriptor.hooks['toRouteOptions']).length,
        accountOverlayImporterCount: descriptors.filter((descriptor) => descriptor.hooks['toAccountOverlays']).length,
        providerEvidenceImporterCount: descriptors.filter((descriptor) => descriptor.hooks['toProviderEvidenceFacts']).length,
        descriptors,
        endpointCoverage,
        providersWithoutImporters,
        uncoveredCatalogSourceIds,
        missingRequiredHooks,
    };
}
