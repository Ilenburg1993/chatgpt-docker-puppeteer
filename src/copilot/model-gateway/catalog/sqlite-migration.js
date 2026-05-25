// @ts-check
/**
 * Migration helpers between the debug JSON catalog snapshot and the normalized SQLite catalog store.
 *
 * The operation is intentionally mirror-like: it does not delete the JSON file and it does not run provider importers.
 * It only takes the latest already-redacted snapshot and materializes it in the relational store.
 *
 * @module copilot/model-gateway/catalog/sqlite-migration
 */

import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';

/**
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} snapshot
 * @returns {{
 *   sources: number;
 *   providerEvidences: number;
 *   evidences: number;
 *   routeOptions: number;
 *   accountOverlays: number;
 *   providerProjections: number;
 *   projections: number;
 *   importRuns: number;
 *   rawPayloadRefs: number;
 *   conflicts: number;
 *   modelEligibilityRuns: number;
 *   modelEligibilityDecisions: number;
 * }}
 */
export function summarizeModelGatewayCatalogSnapshot(snapshot) {
    return {
        sources: snapshot.sources.length,
        providerEvidences: snapshot.providerEvidences.length,
        evidences: snapshot.evidences.length,
        routeOptions: snapshot.routeOptions.length,
        accountOverlays: snapshot.accountOverlays.length,
        providerProjections: snapshot.providerProjections.length,
        projections: snapshot.projections.length,
        importRuns: snapshot.importRuns.length,
        rawPayloadRefs: snapshot.rawPayloadRefs.length,
        conflicts: snapshot.conflicts.length,
        modelEligibilityRuns: snapshot.modelEligibilityRuns.length,
        modelEligibilityDecisions: snapshot.modelEligibilityDecisions.length,
    };
}

/**
 * @param {object} input
 * @param {{ readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>> }} input.sourceStore
 * @param {{ writeSnapshot(snapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>): Promise<void>; readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>> }} input.sqliteStore
 * @returns {Promise<{
 *   sourceSnapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *   sqliteSnapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *   sourceCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *   sqliteCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 * }>}
 */
export async function mirrorModelGatewayCatalogSnapshotToSqlite(input) {
    const sourceSnapshot = normalizeStoredCatalogSnapshot(await input.sourceStore.readSnapshot());
    await input.sqliteStore.writeSnapshot(sourceSnapshot);
    const sqliteSnapshot = normalizeStoredCatalogSnapshot(await input.sqliteStore.readSnapshot());
    return {
        sourceSnapshot,
        sqliteSnapshot,
        sourceCounts: summarizeModelGatewayCatalogSnapshot(sourceSnapshot),
        sqliteCounts: summarizeModelGatewayCatalogSnapshot(sqliteSnapshot),
    };
}
