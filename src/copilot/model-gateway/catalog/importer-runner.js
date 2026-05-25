// @ts-check
/**
 * Catalog importer interface and runner.
 *
 * The runner is intentionally storage-neutral and network-agnostic. Provider-specific importers supply fetch/parse/fact
 * steps; this layer owns source/run/raw-ref assembly, secret-safe error capture and optional snapshot persistence.
 *
 * @module copilot/model-gateway/catalog/importer-runner
 */

import { createCatalogImportRun, createSanitizedRawPayloadRef } from './import-runs.js';
import { createProviderCatalogSource } from './contracts.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';

/**
 * @typedef {object} CatalogImporter
 * @property {string} id
 * @property {string} providerId
 * @property {string} sourceKind
 * @property {boolean} requiresAuth
 * @property {string} [url]
 * @property {string} [command]
 * @property {string[]} [envRequirements]
 * @property {string} [refreshPolicy]
 * @property {number} [ttlSeconds]
 * @property {() => Promise<unknown> | unknown} fetchRaw
 * @property {(raw: unknown) => Promise<unknown[]> | unknown[]} parseRows
 * @property {(rows: unknown[], context: { source: Record<string, any>; rawPayloadRef: string }) => Promise<Record<string, any>[]> | Record<string, any>[]} toEvidenceFacts
 * @property {(rows: unknown[], context: { source: Record<string, any>; rawPayloadRef: string }) => Promise<Record<string, any>[]> | Record<string, any>[]} [toProviderEvidenceFacts]
 * @property {(rows: unknown[], context: { source: Record<string, any>; rawPayloadRef: string }) => Promise<Record<string, any>[]> | Record<string, any>[]} [toRouteOptions]
 * @property {(rows: unknown[], context: { source: Record<string, any>; rawPayloadRef: string }) => Promise<Record<string, any>[]> | Record<string, any>[]} [toAccountOverlays]
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'unknown catalog importer error';
}

/**
 * @param {string} value
 * @returns {string}
 */
function idPart(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

/**
 * @param {CatalogImporter} importer
 * @param {Date} now
 * @returns {string}
 */
function createImportRunId(importer, now) {
    return `${idPart(importer.providerId)}:${idPart(importer.id)}:${now.toISOString()}`;
}

/**
 * @param {CatalogImporter} importer
 * @returns {Record<string, any>}
 */
function createSourceForImporter(importer) {
    return createProviderCatalogSource({
        id: importer.id,
        providerId: importer.providerId,
        kind: importer.sourceKind,
        url: importer.url,
        command: importer.command,
        envRequirements: importer.envRequirements,
        authMode: importer.requiresAuth ? 'api_key' : 'none',
        refreshPolicy: importer.refreshPolicy ?? 'manual',
        ttlSeconds: importer.ttlSeconds,
        parserId: importer.id,
        trustTier: importer.requiresAuth ? 'account_scoped' : 'provider_catalog',
    });
}

/**
 * @template {Record<string, any>} T
 * @param {T[]} records
 * @param {T[]} additions
 * @param {(record: T) => string} key
 * @returns {T[]}
 */
function upsertMany(records, additions, key) {
    const map = new Map(records.map((record) => [key(record), record]));
    for (const item of additions) map.set(key(item), item);
    return [...map.values()];
}

/**
 * @param {Record<string, any>} overlay
 * @returns {string}
 */
function accountOverlayKey(overlay) {
    const explicit = overlay['accountOverlayId'];
    if (typeof explicit === 'string' && explicit) return explicit;
    return [
        overlay['providerId'],
        overlay['accountScope'],
        overlay['secretRef'],
        overlay['sourceId'],
    ]
        .filter((item) => typeof item === 'string' && item)
        .join(':') || JSON.stringify(overlay);
}

/**
 * @param {Record<string, any>} option
 * @returns {string}
 */
function routeOptionKey(option) {
    return [
        option['providerId'],
        option['providerModel'],
        option['routeProfile'] ?? 'default',
        option['selectorKind'],
        option['selectorSyntax'],
    ]
        .filter((item) => typeof item === 'string' && item)
        .join(':') || JSON.stringify(option);
}

/**
 * @param {object} [input]
 * @param {CatalogImporter[]} [input.importers]
 * @param {unknown} [input.snapshot]
 * @param {{ writeSnapshot(snapshot: object): Promise<void> }} [input.store]
 * @param {() => Date} [input.now]
 * @returns {Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>}
 */
export async function runCatalogImporters(input = {}) {
    const now = input.now ?? (() => new Date());
    /** @type {ReturnType<typeof normalizeStoredCatalogSnapshot>} */
    let snapshot = {
        ...normalizeStoredCatalogSnapshot(input.snapshot),
        source: 'catalog-importer-runner',
    };

    for (const importer of input.importers ?? []) {
        const startedAt = now();
        const source = createSourceForImporter(importer);
        /** @type {Record<string, any>[]} */
        let rawPayloadRefs = [];
        /** @type {Record<string, any>[]} */
        let providerEvidences = [];
        /** @type {Record<string, any>[]} */
        let evidences = [];
        /** @type {Record<string, any>[]} */
        let routeOptions = [];
        /** @type {Record<string, any>[]} */
        let accountOverlays = [];
        /** @type {Record<string, any>} */
        let run;

        try {
            const raw = await importer.fetchRaw();
            const rawRef = createSanitizedRawPayloadRef({
                providerId: importer.providerId,
                sourceId: String(source['id']),
                payload: raw,
            });
            const rows = await importer.parseRows(raw);
            const context = { source, rawPayloadRef: rawRef.rawPayloadRef };
            providerEvidences = importer.toProviderEvidenceFacts ? await importer.toProviderEvidenceFacts(rows, context) : [];
            evidences = await importer.toEvidenceFacts(rows, context);
            routeOptions = importer.toRouteOptions ? await importer.toRouteOptions(rows, context) : [];
            accountOverlays = importer.toAccountOverlays ? await importer.toAccountOverlays(rows, context) : [];
            rawPayloadRefs = [rawRef];
            run = createCatalogImportRun({
                runId: createImportRunId(importer, startedAt),
                providerId: importer.providerId,
                sourceId: String(source['id']),
                status: 'completed',
                startedAt,
                completedAt: now(),
                rowCount: rows.length,
            });
        } catch (error) {
            run = createCatalogImportRun({
                runId: createImportRunId(importer, startedAt),
                providerId: importer.providerId,
                sourceId: String(source['id']),
                status: 'failed',
                startedAt,
                completedAt: now(),
                rowCount: 0,
                errors: [errorMessage(error)],
            });
        }

        snapshot = {
            ...snapshot,
            sources: upsertMany(snapshot.sources, [source], (item) => String(item['id'])),
            providerEvidences: upsertMany(
                snapshot.providerEvidences,
                providerEvidences,
                (item) => String(item['evidenceId'] ?? JSON.stringify(item)),
            ),
            evidences: upsertMany(snapshot.evidences, evidences, (item) => String(item['evidenceId'] ?? JSON.stringify(item))),
            routeOptions: upsertMany(snapshot.routeOptions, routeOptions, routeOptionKey),
            accountOverlays: upsertMany(snapshot.accountOverlays, accountOverlays, accountOverlayKey),
            rawPayloadRefs: upsertMany(snapshot.rawPayloadRefs, rawPayloadRefs, (item) => String(item['rawPayloadRef'])),
            importRuns: [...snapshot.importRuns, run],
        };
    }

    if (input.store) await input.store.writeSnapshot(snapshot);
    return snapshot;
}
