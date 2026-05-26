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
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} sourceSnapshot
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} sqliteSnapshot
 * @returns {{
 *   ok: boolean;
 *   snapshotIdMatches: boolean;
 *   sourceCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *   sqliteCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *   countMismatches: Array<{ field: string; source: number; sqlite: number }>;
 * }}
 */
export function compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot) {
    const sourceCounts = summarizeModelGatewayCatalogSnapshot(sourceSnapshot);
    const sqliteCounts = summarizeModelGatewayCatalogSnapshot(sqliteSnapshot);
    const countMismatches = Object.keys(sourceCounts)
        .filter((field) => sourceCounts[/** @type {keyof typeof sourceCounts} */ (field)] !== sqliteCounts[/** @type {keyof typeof sqliteCounts} */ (field)])
        .map((field) => ({
            field,
            source: sourceCounts[/** @type {keyof typeof sourceCounts} */ (field)],
            sqlite: sqliteCounts[/** @type {keyof typeof sqliteCounts} */ (field)],
        }));
    const snapshotIdMatches = sourceSnapshot.snapshotId === sqliteSnapshot.snapshotId;
    return {
        ok: snapshotIdMatches && countMismatches.length === 0,
        snapshotIdMatches,
        sourceCounts,
        sqliteCounts,
        countMismatches,
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
 *   parity: ReturnType<typeof compareModelGatewayCatalogSnapshotParity>;
 * }>}
 */
export async function mirrorModelGatewayCatalogSnapshotToSqlite(input) {
    const sourceSnapshot = normalizeStoredCatalogSnapshot(await input.sourceStore.readSnapshot());
    await input.sqliteStore.writeSnapshot(sourceSnapshot);
    const sqliteSnapshot = normalizeStoredCatalogSnapshot(await input.sqliteStore.readSnapshot());
    const parity = compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot);
    return {
        sourceSnapshot,
        sqliteSnapshot,
        sourceCounts: parity.sourceCounts,
        sqliteCounts: parity.sqliteCounts,
        parity,
    };
}
