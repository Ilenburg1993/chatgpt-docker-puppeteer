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

const DEFAULT_ROUTE_PROFILE = 'default';
const DEFAULT_ACCOUNT_SCOPE = 'default';
const DEFAULT_POLICY_PROFILE = 'default';
const DEFAULT_TASK_PROFILE = 'default';
const KEY_MISMATCH_SAMPLE_LIMIT = 10;

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
    return optionalString(row['routeProfile']) ?? DEFAULT_ROUTE_PROFILE;
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
function modelRouteKey(row) {
    return [providerId(row), providerModel(row), routeProfile(row)].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function routeOptionKey(row) {
    return [modelRouteKey(row), selectorKind(row), selectorSyntax(row)].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function eligibilityDecisionKey(row) {
    return [
        optionalString(row['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
        optionalString(row['taskProfile']) ?? DEFAULT_TASK_PROFILE,
        optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
        modelRouteKey(row),
        selectorKind(row),
        selectorSyntax(row),
    ].join(':');
}

/**
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} snapshot
 * @returns {Record<string, string[]>}
 */
function snapshotParityKeys(snapshot) {
    return {
        sources: snapshot.sources.map((row) => optionalString(row['id']) ?? 'unknown-source'),
        providerEvidences: snapshot.providerEvidences.map(
            (row) =>
                optionalString(row['evidenceId']) ??
                [providerId(row), optionalString(row['fieldPath']) ?? 'field'].join(':'),
        ),
        evidences: snapshot.evidences.map(
            (row) =>
                optionalString(row['evidenceId']) ??
                [modelRouteKey(row), optionalString(row['fieldPath']) ?? 'field'].join(':'),
        ),
        routeOptions: snapshot.routeOptions.map(routeOptionKey),
        accountOverlays: snapshot.accountOverlays.map(
            (row) => optionalString(row['accountOverlayId']) ?? providerId(row),
        ),
        providerProjections: snapshot.providerProjections.map((row) =>
            [providerId(row), optionalString(row['subjectProviderId']) ?? 'unknown-subject'].join(':'),
        ),
        projections: snapshot.projections.map(modelRouteKey),
        importRuns: snapshot.importRuns.map((row) => optionalString(row['runId']) ?? 'unknown-run'),
        rawPayloadRefs: snapshot.rawPayloadRefs.map((row) => optionalString(row['rawPayloadRef']) ?? 'unknown-payload'),
        conflicts: snapshot.conflicts.map(
            (row) =>
                optionalString(row['conflictKey']) ??
                [modelRouteKey(row), optionalString(row['fieldPath']) ?? 'field'].join(':'),
        ),
        modelEligibilityRuns: snapshot.modelEligibilityRuns.map((row) => optionalString(row['runId']) ?? 'unknown-run'),
        modelEligibilityDecisions: snapshot.modelEligibilityDecisions.map(eligibilityDecisionKey),
    };
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {string[]}
 */
function sortedDifference(left, right) {
    const rightSet = new Set(right);
    return [...new Set(left.filter((item) => !rightSet.has(item)))].sort();
}

/**
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} sourceSnapshot
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} sqliteSnapshot
 * @returns {{ field: string; missingFromSqlite: string[]; missingFromSource: string[] }[]}
 */
function compareSnapshotKeyParity(sourceSnapshot, sqliteSnapshot) {
    const sourceKeys = snapshotParityKeys(sourceSnapshot);
    const sqliteKeys = snapshotParityKeys(sqliteSnapshot);
    return Object.keys(sourceKeys)
        .map((field) => {
            const source = sourceKeys[/** @type {keyof typeof sourceKeys} */ (field)] ?? [];
            const sqlite = sqliteKeys[/** @type {keyof typeof sqliteKeys} */ (field)] ?? [];
            return {
                field,
                missingFromSqlite: sortedDifference(source, sqlite).slice(0, KEY_MISMATCH_SAMPLE_LIMIT),
                missingFromSource: sortedDifference(sqlite, source).slice(0, KEY_MISMATCH_SAMPLE_LIMIT),
            };
        })
        .filter((row) => row.missingFromSqlite.length > 0 || row.missingFromSource.length > 0);
}

/**
 * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} snapshot
 * @returns {{
 *     sources: number;
 *     providerEvidences: number;
 *     evidences: number;
 *     routeOptions: number;
 *     accountOverlays: number;
 *     providerProjections: number;
 *     projections: number;
 *     importRuns: number;
 *     rawPayloadRefs: number;
 *     conflicts: number;
 *     modelEligibilityRuns: number;
 *     modelEligibilityDecisions: number;
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
 *     ok: boolean;
 *     snapshotIdMatches: boolean;
 *     sourceCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *     sqliteCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *     countMismatches: { field: string; source: number; sqlite: number }[];
 *     keyMismatches: { field: string; missingFromSqlite: string[]; missingFromSource: string[] }[];
 * }}
 */
export function compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot) {
    const sourceCounts = summarizeModelGatewayCatalogSnapshot(sourceSnapshot);
    const sqliteCounts = summarizeModelGatewayCatalogSnapshot(sqliteSnapshot);
    const countMismatches = Object.keys(sourceCounts)
        .filter(
            (field) =>
                sourceCounts[/** @type {keyof typeof sourceCounts} */ (field)] !==
                sqliteCounts[/** @type {keyof typeof sqliteCounts} */ (field)],
        )
        .map((field) => ({
            field,
            source: sourceCounts[/** @type {keyof typeof sourceCounts} */ (field)],
            sqlite: sqliteCounts[/** @type {keyof typeof sqliteCounts} */ (field)],
        }));
    const keyMismatches = compareSnapshotKeyParity(sourceSnapshot, sqliteSnapshot);
    const snapshotIdMatches = sourceSnapshot.snapshotId === sqliteSnapshot.snapshotId;
    return {
        ok: snapshotIdMatches && countMismatches.length === 0 && keyMismatches.length === 0,
        snapshotIdMatches,
        sourceCounts,
        sqliteCounts,
        countMismatches,
        keyMismatches,
    };
}

/**
 * @param {object} input
 * @param {{ readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>> }} input.sourceStore
 * @param {{
 *     writeSnapshot(snapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>): Promise<void>;
 *     readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>;
 * }} input.sqliteStore
 * @returns {Promise<{
 *     sourceSnapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *     sqliteSnapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *     sourceCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *     sqliteCounts: ReturnType<typeof summarizeModelGatewayCatalogSnapshot>;
 *     parity: ReturnType<typeof compareModelGatewayCatalogSnapshotParity>;
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
