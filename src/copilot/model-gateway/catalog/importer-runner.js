// @ts-check
/**
 * Catalog importer interface and runner.
 *
 * The runner is intentionally storage-neutral and network-agnostic. Provider-specific importers supply fetch/parse/fact
 * steps; this layer owns source/run/raw-ref assembly, secret-safe error capture and optional snapshot persistence.
 *
 * @module copilot/model-gateway/catalog/importer-runner
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
    createProviderAccountOverlay,
    createProviderCatalogSource,
} from './contracts.js';
import { createCatalogImportRun, createSanitizedRawPayloadRef } from './import-runs.js';
import { classifyModelGatewayCatalogImporterFailure } from './importer-failures.js';
import { createModelGatewayCatalogSnapshotId } from './json-catalog-store.js';

/** @typedef {ReturnType<typeof createProviderCatalogSource>} CatalogImporterSource */
/** @typedef {{ source: CatalogImporterSource; rawPayloadRef: string }} CatalogImporterContext */
/** @typedef {ReturnType<typeof import('./contracts.js').createModelMetadataEvidence>} CatalogModelEvidence */
/** @typedef {ReturnType<typeof import('./contracts.js').createProviderMetadataEvidence>} CatalogProviderEvidence */
/** @typedef {ReturnType<typeof import('./contracts.js').createModelRouteOption>} CatalogRouteOption */
/** @typedef {ReturnType<typeof createProviderAccountOverlay>} CatalogAccountOverlay */
/** @typedef {ReturnType<typeof createCatalogImportRun>} CatalogImportRun */
/** @typedef {ReturnType<typeof createSanitizedRawPayloadRef>} CatalogRawPayloadRef */

/**
 * Canonical snapshot produced by one importer batch. Unlike a stored snapshot, every populated collection below comes
 * directly from a validated catalog factory in this process; no persisted JSON is promoted into these types.
 *
 * @template {CatalogRouteOption} [TRouteOption=CatalogRouteOption] Default is `CatalogRouteOption`
 * @typedef {object} FreshCatalogImporterSnapshot
 * @property {number} schemaVersion
 * @property {string} snapshotId
 * @property {string | null} generatedAt
 * @property {'catalog-importer-runner'} source
 * @property {CatalogImporterSource[]} sources
 * @property {CatalogProviderEvidence[]} providerEvidences
 * @property {CatalogModelEvidence[]} evidences
 * @property {TRouteOption[]} routeOptions
 * @property {CatalogAccountOverlay[]} accountOverlays
 * @property {Record<string, unknown>[]} providerProjections
 * @property {Record<string, unknown>[]} projections
 * @property {CatalogImportRun[]} importRuns
 * @property {CatalogRawPayloadRef[]} rawPayloadRefs
 * @property {Record<string, unknown>[]} conflicts
 * @property {Record<string, unknown>[]} modelTombstones
 * @property {Record<string, unknown>[]} modelEligibilityRuns
 * @property {Record<string, unknown>[]} modelEligibilityDecisions
 */

/**
 * @template [TRaw=unknown] Default is `unknown`
 * @template [TRow=unknown] Default is `unknown`
 * @template {CatalogRouteOption} [TRouteOption=CatalogRouteOption] Default is `CatalogRouteOption`
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
 * @property {() => Promise<TRaw> | TRaw} fetchRaw
 * @property {(raw: TRaw) => Promise<TRow[]> | TRow[]} parseRows
 * @property {(
 *     rows: TRow[],
 *     context: CatalogImporterContext,
 * ) => Promise<CatalogModelEvidence[]> | CatalogModelEvidence[]} toEvidenceFacts
 * @property {(
 *     rows: TRow[],
 *     context: CatalogImporterContext,
 * ) => Promise<CatalogProviderEvidence[]> | CatalogProviderEvidence[]} [toProviderEvidenceFacts]
 * @property {(rows: TRow[], context: CatalogImporterContext) => Promise<TRouteOption[]> | TRouteOption[]} [toRouteOptions]
 * @property {(
 *     rows: TRow[],
 *     context: CatalogImporterContext,
 * ) => Promise<CatalogAccountOverlay[]> | CatalogAccountOverlay[]} [toAccountOverlays]
 * @property {(
 *     error: unknown,
 *     context: CatalogImporterContext,
 * ) => Promise<CatalogAccountOverlay[]> | CatalogAccountOverlay[]} [toFailureAccountOverlays]
 */

/**
 * Identity factory that gives object-literal importers one contextual generic contract from fetch through parsing and
 * canonical fact projection. It performs no runtime coercion.
 *
 * @template TRaw
 * @template TRow
 * @template {CatalogRouteOption} TRouteOption
 * @param {CatalogImporter<TRaw, TRow, TRouteOption>} importer
 * @returns {CatalogImporter<TRaw, TRow, TRouteOption>}
 */
export function defineCatalogImporter(importer) {
    return importer;
}

/**
 * @typedef {object} CatalogImporterProgressEvent
 * @property {string} phase
 * @property {string} importerId
 * @property {string} providerId
 * @property {string} sourceId
 * @property {string} sourceKind
 * @property {number} index
 * @property {number} total
 * @property {number} progressPct
 * @property {number} elapsedMs
 * @property {number} [rowCount]
 * @property {number} [evidenceCount]
 * @property {number} [providerEvidenceCount]
 * @property {number} [routeOptionCount]
 * @property {number} [accountOverlayCount]
 * @property {string[]} [errors]
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
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_.:-]+/gu, '-')
            .replace(/^-+|-+$/gu, '') || 'unknown'
    );
}

/**
 * @template TRaw
 * @template TRow
 * @param {CatalogImporter<TRaw, TRow>} importer
 * @param {Date} now
 * @returns {string}
 */
function createImportRunId(importer, now) {
    return `${idPart(importer.providerId)}:${idPart(importer.id)}:${now.toISOString()}`;
}

/**
 * @template TRaw
 * @template TRow
 * @param {CatalogImporter<TRaw, TRow>} importer
 * @returns {CatalogImporterSource}
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
 * @template TRaw
 * @template TRow
 * @param {CatalogImporter<TRaw, TRow>} importer
 * @returns {string | null}
 */
function defaultSecretRef(importer) {
    return importer.envRequirements?.find((item) => typeof item === 'string' && item.trim()) ?? null;
}

/**
 * @param {string} sourceKind
 * @returns {boolean}
 */
function failureSourceCanProduceOverlay(sourceKind) {
    return (
        sourceKind === 'local_daemon' ||
        sourceKind === 'authenticated_api' ||
        sourceKind === 'authenticated_account_api'
    );
}

/**
 * @template TRaw
 * @template TRow
 * @param {CatalogImporter<TRaw, TRow>} importer
 * @param {unknown} error
 * @param {CatalogImporterSource} source
 * @returns {CatalogAccountOverlay[]}
 */
function createDefaultFailureAccountOverlays(importer, error, source) {
    if (!importer.requiresAuth && !failureSourceCanProduceOverlay(importer.sourceKind)) return [];
    const message = errorMessage(error);
    const sourceId = String(source['id'] ?? importer.id);
    const failure = classifyModelGatewayCatalogImporterFailure({
        importerId: importer.id,
        providerId: importer.providerId,
        sourceId,
        sourceKind: importer.sourceKind,
        requiresAuth: importer.requiresAuth,
        errors: [message],
        error,
    });
    const localDaemon = importer.sourceKind === 'local_daemon';
    const keyDisabled = failure.failureKind === 'auth';
    const rateLimited = failure.failureKind === 'rate-limit';
    const creditsExhausted = failure.failureKind === 'credits';
    return [
        createProviderAccountOverlay({
            accountOverlayId: `${importer.providerId}:default:${defaultSecretRef(importer) ?? 'no-secret'}:${sourceId}:failure`,
            providerId: importer.providerId,
            accountScope: 'default',
            secretRef: defaultSecretRef(importer) ?? undefined,
            sourceId,
            sourceKind: importer.sourceKind,
            confidence: localDaemon
                ? MODEL_GATEWAY_CATALOG_CONFIDENCE.CATALOG
                : MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
            quota: creditsExhausted ? { remainingCreditsUsd: 0 } : {},
            rateLimits: rateLimited
                ? {
                      limited: true,
                      ...(failure.retryAfterSeconds !== null ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
                      ...(failure.resetAt !== null ? { resetAt: failure.resetAt } : {}),
                      ...failure.limitHeaders,
                  }
                : {},
            providerMetadata: {
                catalogImportStatus: 'failed',
                failureKind: failure.failureKind,
                failureContext: failure.errorContext,
                failureMessage: message,
                ...(keyDisabled ? { apiKeyDisabled: true } : {}),
                ...(localDaemon ? { disabled: true, localDaemonReachable: false } : {}),
            },
        }),
    ];
}

/**
 * @template TRaw
 * @template TRow
 * @param {CatalogImporter<TRaw, TRow>} importer
 * @param {unknown} error
 * @param {CatalogImporterSource} source
 * @returns {Promise<{ overlays: CatalogAccountOverlay[]; errors: string[] }>}
 */
async function createFailureAccountOverlays(importer, error, source) {
    /** @type {CatalogAccountOverlay[]} */
    let overlays = [];
    /** @type {string[]} */
    const errors = [];
    if (typeof importer.toFailureAccountOverlays === 'function') {
        try {
            overlays = await importer.toFailureAccountOverlays(error, { source, rawPayloadRef: '' });
        } catch (overlayError) {
            errors.push(`failure account overlay failed: ${errorMessage(overlayError)}`);
        }
    }
    if (overlays.length === 0) overlays = createDefaultFailureAccountOverlays(importer, error, source);
    return { overlays, errors };
}

/**
 * @param {number} index
 * @param {number} total
 * @param {number} phaseFraction
 * @returns {number}
 */
function importerProgressPct(index, total, phaseFraction) {
    const boundedTotal = Math.max(1, total);
    const boundedFraction = Math.min(1, Math.max(0, phaseFraction));
    return Math.round(((Math.max(0, index - 1) + boundedFraction) / boundedTotal) * 100);
}

/**
 * @param {Date} startedAt
 * @param {Date} observedAt
 * @returns {number}
 */
function elapsedMs(startedAt, observedAt) {
    return Math.max(0, observedAt.getTime() - startedAt.getTime());
}

/**
 * @param {((event: CatalogImporterProgressEvent) => void) | undefined} onProgress
 * @param {CatalogImporterProgressEvent} event
 * @returns {void}
 */
function emitProgress(onProgress, event) {
    if (typeof onProgress !== 'function') return;
    onProgress(event);
}

/**
 * @template {object} TExisting
 * @template {object} TAddition
 * @param {TExisting[]} records
 * @param {TAddition[]} additions
 * @param {(record: TExisting | TAddition) => string} key
 * @returns {(TExisting | TAddition)[]}
 */
function upsertMany(records, additions, key) {
    /** @type {Map<string, TExisting | TAddition>} */
    const map = new Map(records.map((record) => [key(record), record]));
    for (const item of additions) map.set(key(item), item);
    return [...map.values()];
}

/**
 * @param {object} overlay
 * @returns {string}
 */
function accountOverlayKey(overlay) {
    const explicit = Reflect.get(overlay, 'accountOverlayId');
    if (typeof explicit === 'string' && explicit) return explicit;
    return (
        [
            Reflect.get(overlay, 'providerId'),
            Reflect.get(overlay, 'accountScope'),
            Reflect.get(overlay, 'secretRef'),
            Reflect.get(overlay, 'sourceId'),
        ]
            .filter((item) => typeof item === 'string' && item)
            .join(':') || JSON.stringify(overlay)
    );
}

/**
 * @param {object} option
 * @returns {string}
 */
function routeOptionKey(option) {
    return (
        [
            Reflect.get(option, 'providerId'),
            Reflect.get(option, 'providerModel'),
            Reflect.get(option, 'routeProfile') ?? 'default',
            Reflect.get(option, 'selectorKind'),
            Reflect.get(option, 'selectorSyntax'),
        ]
            .filter((item) => typeof item === 'string' && item)
            .join(':') || JSON.stringify(option)
    );
}

/**
 * Runs one fresh importer batch. Persisted-snapshot reconciliation intentionally belongs to refreshModelGatewayCatalog;
 * keeping it out of this runner prevents stored JSON from contaminating canonical in-process fact types.
 *
 * @template TRaw
 * @template TRow
 * @template {CatalogRouteOption} TRouteOption
 * @param {object} [input]
 * @param {CatalogImporter<TRaw, TRow, TRouteOption>[]} [input.importers]
 * @param {{ writeSnapshot(snapshot: object): Promise<void> }} [input.store]
 * @param {() => Date} [input.now]
 * @param {{ mode?: string; maxInlineBytes?: number }} [input.rawPayloadStoragePolicy]
 * @param {(event: CatalogImporterProgressEvent) => void} [input.onProgress]
 * @returns {Promise<FreshCatalogImporterSnapshot<TRouteOption>>}
 */
export async function runCatalogImporters(input = {}) {
    const now = input.now ?? (() => new Date());
    const importers = input.importers ?? [];
    /** @type {FreshCatalogImporterSnapshot<TRouteOption>} */
    let snapshot = {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        snapshotId: createModelGatewayCatalogSnapshotId({}),
        generatedAt: null,
        source: 'catalog-importer-runner',
        sources: [],
        providerEvidences: [],
        evidences: [],
        routeOptions: [],
        accountOverlays: [],
        providerProjections: [],
        projections: [],
        importRuns: [],
        rawPayloadRefs: [],
        conflicts: [],
        modelTombstones: [],
        modelEligibilityRuns: [],
        modelEligibilityDecisions: [],
    };

    for (const [position, importer] of importers.entries()) {
        const index = position + 1;
        const startedAt = now();
        const source = createSourceForImporter(importer);
        const sourceId = String(source['id']);
        const baseProgress = {
            importerId: importer.id,
            providerId: importer.providerId,
            sourceId,
            sourceKind: importer.sourceKind,
            index,
            total: importers.length,
        };
        /** @type {ReturnType<typeof createSanitizedRawPayloadRef>[]} */
        let rawPayloadRefs = [];
        /** @type {CatalogProviderEvidence[]} */
        let providerEvidences = [];
        /** @type {CatalogModelEvidence[]} */
        let evidences = [];
        /** @type {TRouteOption[]} */
        let routeOptions = [];
        /** @type {CatalogAccountOverlay[]} */
        let accountOverlays;
        /** @type {ReturnType<typeof createCatalogImportRun>} */
        let run;

        try {
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'importer_started',
                progressPct: importerProgressPct(index, importers.length, 0),
                elapsedMs: 0,
            });
            const raw = await importer.fetchRaw();
            const fetchedAt = now();
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'fetch_completed',
                progressPct: importerProgressPct(index, importers.length, 0.25),
                elapsedMs: elapsedMs(startedAt, fetchedAt),
            });
            const rawRef = createSanitizedRawPayloadRef({
                providerId: importer.providerId,
                sourceId,
                payload: raw,
                storagePolicy: input.rawPayloadStoragePolicy,
            });
            const rows = await importer.parseRows(raw);
            const rowsParsedAt = now();
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'rows_parsed',
                progressPct: importerProgressPct(index, importers.length, 0.45),
                elapsedMs: elapsedMs(startedAt, rowsParsedAt),
                rowCount: rows.length,
            });
            const context = { source, rawPayloadRef: rawRef.rawPayloadRef };
            providerEvidences = importer.toProviderEvidenceFacts
                ? await importer.toProviderEvidenceFacts(rows, context)
                : [];
            evidences = await importer.toEvidenceFacts(rows, context);
            routeOptions = importer.toRouteOptions ? await importer.toRouteOptions(rows, context) : [];
            accountOverlays = importer.toAccountOverlays ? await importer.toAccountOverlays(rows, context) : [];
            const factsBuiltAt = now();
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'facts_built',
                progressPct: importerProgressPct(index, importers.length, 0.75),
                elapsedMs: elapsedMs(startedAt, factsBuiltAt),
                rowCount: rows.length,
                evidenceCount: evidences.length,
                providerEvidenceCount: providerEvidences.length,
                routeOptionCount: routeOptions.length,
                accountOverlayCount: accountOverlays.length,
            });
            rawPayloadRefs = [rawRef];
            const completedAt = now();
            run = createCatalogImportRun({
                runId: createImportRunId(importer, startedAt),
                providerId: importer.providerId,
                sourceId,
                status: 'completed',
                startedAt,
                completedAt,
                rowCount: rows.length,
            });
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'importer_completed',
                progressPct: importerProgressPct(index, importers.length, 1),
                elapsedMs: elapsedMs(startedAt, completedAt),
                rowCount: rows.length,
                evidenceCount: evidences.length,
                providerEvidenceCount: providerEvidences.length,
                routeOptionCount: routeOptions.length,
                accountOverlayCount: accountOverlays.length,
            });
        } catch (error) {
            const completedAt = now();
            const failureOverlays = await createFailureAccountOverlays(importer, error, source);
            accountOverlays = failureOverlays.overlays;
            run = createCatalogImportRun({
                runId: createImportRunId(importer, startedAt),
                providerId: importer.providerId,
                sourceId,
                status: 'failed',
                startedAt,
                completedAt,
                rowCount: 0,
                errors: [errorMessage(error), ...failureOverlays.errors],
            });
            const errors = Array.isArray(run['errors'])
                ? run['errors'].map((item) => String(item))
                : ['unknown catalog importer error'];
            emitProgress(input.onProgress, {
                ...baseProgress,
                phase: 'importer_failed',
                progressPct: importerProgressPct(index, importers.length, 1),
                elapsedMs: elapsedMs(startedAt, completedAt),
                rowCount: 0,
                errors,
                accountOverlayCount: accountOverlays.length,
            });
        }

        snapshot = {
            ...snapshot,
            sources: upsertMany(snapshot.sources, [source], (item) => String(item['id'])),
            providerEvidences: upsertMany(snapshot.providerEvidences, providerEvidences, (item) =>
                String(item['evidenceId'] ?? JSON.stringify(item)),
            ),
            evidences: upsertMany(snapshot.evidences, evidences, (item) =>
                String(item['evidenceId'] ?? JSON.stringify(item)),
            ),
            routeOptions: upsertMany(snapshot.routeOptions, routeOptions, routeOptionKey),
            accountOverlays: upsertMany(snapshot.accountOverlays, accountOverlays, accountOverlayKey),
            rawPayloadRefs: upsertMany(snapshot.rawPayloadRefs, rawPayloadRefs, (item) =>
                String(item['rawPayloadRef']),
            ),
            importRuns: [...snapshot.importRuns, run],
        };
    }

    snapshot = {
        ...snapshot,
        snapshotId: createModelGatewayCatalogSnapshotId(snapshot),
    };
    if (input.store) await input.store.writeSnapshot(snapshot);
    return snapshot;
}
