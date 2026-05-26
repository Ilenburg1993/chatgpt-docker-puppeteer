// @ts-check
/**
 * Catalog snapshot integrity audit.
 *
 * This audit runs before SQLite materialization to catch source-store corruption: duplicate canonical keys, redacted
 * provider/model identifiers and malformed primary identifiers. It is intentionally metadata-only and does not call
 * providers or runtime probes.
 *
 * @module copilot/model-gateway/catalog/integrity
 */

import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';

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
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerId(row) {
    return optionalString(row['providerId']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerModel(row) {
    return optionalString(row['providerModel']) ?? 'unknown-model';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function routeProfile(row) {
    return optionalString(row['routeProfile']) ?? 'default';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function selectorKind(row) {
    return optionalString(row['selectorKind']) ?? 'exact_model';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function selectorSyntax(row) {
    return optionalString(row['selectorSyntax']) ?? providerModel(row);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function modelKey(row) {
    return [providerId(row), providerModel(row), routeProfile(row)].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function hasRedactedIdentity(row) {
    return [row['id'], row['evidenceId'], row['providerId'], row['providerModel'], row['selectorSyntax'], row['accountOverlayId']]
        .map(optionalString)
        .some((value) => value !== null && /\[redacted\]/iu.test(value));
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {(row: Record<string, unknown>) => string} keyFn
 * @returns {{ rowCount: number; uniqueKeyCount: number; duplicateKeyCount: number; duplicateExtraRowCount: number; duplicateSamples: Array<{ key: string; count: number }> }}
 */
function duplicateKeySummary(rows, keyFn) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const row of rows) counts.set(keyFn(row), (counts.get(keyFn(row)) ?? 0) + 1);
    const duplicates = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .sort(([left], [right]) => left.localeCompare(right));
    return {
        rowCount: rows.length,
        uniqueKeyCount: counts.size,
        duplicateKeyCount: duplicates.length,
        duplicateExtraRowCount: duplicates.reduce((total, [, count]) => total + count - 1, 0),
        duplicateSamples: duplicates.slice(0, 20).map(([key, count]) => ({ key, count })),
    };
}

/**
 * @param {unknown} snapshot
 * @returns {{
 *   schema: string;
 *   ok: boolean;
 *   duplicateChecks: Record<string, ReturnType<typeof duplicateKeySummary>>;
 *   redactedIdentityCount: number;
 *   redactedIdentitySamples: Array<{ field: string; id: string | null; providerId: string | null; providerModel: string | null }>;
 * }}
 */
export function auditModelGatewayCatalogSnapshotIntegrity(snapshot) {
    const normalized = normalizeStoredCatalogSnapshot(snapshot);
    const duplicateChecks = {
        evidences: duplicateKeySummary(normalized.evidences, (row) => optionalString(row['evidenceId']) ?? `${modelKey(row)}:${optionalString(row['fieldPath']) ?? 'field'}`),
        providerEvidences: duplicateKeySummary(
            normalized.providerEvidences,
            (row) => optionalString(row['evidenceId']) ?? [providerId(row), optionalString(row['subjectProviderId']) ?? 'unknown-subject', optionalString(row['fieldPath']) ?? 'field'].join(':'),
        ),
        routeOptions: duplicateKeySummary(
            normalized.routeOptions,
            (row) => [modelKey(row), selectorKind(row), selectorSyntax(row)].join(':'),
        ),
        projections: duplicateKeySummary(normalized.projections, modelKey),
        providerProjections: duplicateKeySummary(
            normalized.providerProjections,
            (row) => [providerId(row), optionalString(row['subjectProviderId']) ?? 'unknown-subject'].join(':'),
        ),
        accountOverlays: duplicateKeySummary(
            normalized.accountOverlays,
            (row) => optionalString(row['accountOverlayId']) ?? [providerId(row), optionalString(row['accountScope']) ?? 'default', optionalString(row['secretRef']) ?? 'no-secret', optionalString(row['sourceId']) ?? 'unknown-source'].join(':'),
        ),
    };
    const identityRows = [
        ...normalized.evidences.map((row) => ({ field: 'evidences', row })),
        ...normalized.routeOptions.map((row) => ({ field: 'routeOptions', row })),
        ...normalized.projections.map((row) => ({ field: 'projections', row })),
        ...normalized.accountOverlays.map((row) => ({ field: 'accountOverlays', row })),
    ].filter((item) => isRecord(item.row) && hasRedactedIdentity(item.row));
    const duplicateExtraRowCount = Object.values(duplicateChecks).reduce((total, item) => total + item.duplicateExtraRowCount, 0);
    return {
        schema: 'model-gateway-catalog-integrity',
        ok: duplicateExtraRowCount === 0 && identityRows.length === 0,
        duplicateChecks,
        redactedIdentityCount: identityRows.length,
        redactedIdentitySamples: identityRows.slice(0, 20).map((item) => ({
            field: item.field,
            id: optionalString(item.row['id']) ?? optionalString(item.row['evidenceId']) ?? optionalString(item.row['accountOverlayId']),
            providerId: optionalString(item.row['providerId']),
            providerModel: optionalString(item.row['providerModel']),
        })),
    };
}

