// @ts-check
/**
 * Incremental catalog refresh planning.
 *
 * This module decides which metadata sources should be fetched before any network call happens. It is deliberately
 * pre-runtime: no provider model is executed here, and the canonical catalog is not mutated by the planner.
 *
 * @module copilot/model-gateway/catalog/refresh-plan
 */

/**
 * @typedef {object} CatalogImporterMetadata
 * @property {string} id
 * @property {string} providerId
 * @property {string} sourceKind
 * @property {boolean} requiresAuth
 * @property {string} [refreshPolicy]
 * @property {number} [ttlSeconds]
 */

/**
 * @typedef {object} CatalogRefreshPlanEntry
 * @property {string} importerId
 * @property {string} providerId
 * @property {string} sourceId
 * @property {string} sourceKind
 * @property {string} refreshPolicy
 * @property {number | null} ttlSeconds
 * @property {number | null} ageSeconds
 * @property {string} reason
 */

/**
 * @template [TRaw=unknown]
 * @template [TRow=unknown]
 * @typedef {object} CatalogRefreshPlan
 * @property {import('./importer-runner.js').CatalogImporter<TRaw, TRow>[]} selectedImporters
 * @property {CatalogRefreshPlanEntry[]} selected
 * @property {CatalogRefreshPlanEntry[]} skipped
 * @property {number} importerCount
 * @property {number} sourceCount
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function recordOrNull(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalPositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * @param {CatalogImporterMetadata} importer
 * @returns {string}
 */
function importerSourceId(importer) {
    return optionalString(importer.id) ?? 'unknown-source';
}

/**
 * @param {CatalogImporterMetadata} importer
 * @param {Record<string, unknown> | null} source
 * @returns {number | null}
 */
function ttlSecondsFor(importer, source) {
    return optionalPositiveNumber(source?.['ttlSeconds']) ?? optionalPositiveNumber(importer.ttlSeconds);
}

/**
 * @param {CatalogImporterMetadata} importer
 * @param {Record<string, unknown> | null} source
 * @returns {string}
 */
function refreshPolicyFor(importer, source) {
    return optionalString(source?.['refreshPolicy']) ?? optionalString(importer.refreshPolicy) ?? 'manual';
}

/**
 * @param {Record<string, unknown> | null} source
 * @param {Date} now
 * @returns {number | null}
 */
function sourceAgeSeconds(source, now) {
    if (!source) return null;
    const observedMs = dateMs(source['updatedAt']) ?? dateMs(source['createdAt']);
    if (observedMs === null) return null;
    return Math.max(0, Math.floor((now.getTime() - observedMs) / 1000));
}

/**
 * @param {Record<string, unknown> | null} source
 * @param {number | null} ttlSeconds
 * @param {Date} now
 * @returns {boolean}
 */
function sourceIsFresh(source, ttlSeconds, now) {
    if (!source || ttlSeconds === null) return false;
    const ageSeconds = sourceAgeSeconds(source, now);
    return ageSeconds !== null && ageSeconds < ttlSeconds;
}

/**
 * @param {CatalogImporterMetadata} importer
 * @param {Record<string, unknown> | null} source
 * @param {Date} now
 * @param {string} reason
 * @returns {CatalogRefreshPlanEntry}
 */
function createPlanEntry(importer, source, now, reason) {
    const ttlSeconds = ttlSecondsFor(importer, source);
    return {
        importerId: optionalString(importer.id) ?? 'unknown-importer',
        providerId: optionalString(importer.providerId) ?? 'unknown-provider',
        sourceId: importerSourceId(importer),
        sourceKind: optionalString(source?.['kind']) ?? optionalString(importer.sourceKind) ?? 'unknown',
        refreshPolicy: refreshPolicyFor(importer, source),
        ttlSeconds,
        ageSeconds: sourceAgeSeconds(source, now),
        reason,
    };
}

/**
 * @template TRaw
 * @template TRow
 * @param {object} [input]
 * @param {import('./importer-runner.js').CatalogImporter<TRaw, TRow>[]} [input.importers]
 * @param {Record<string, unknown>[]} [input.sources]
 * @param {() => Date} [input.now]
 * @param {boolean} [input.force]
 * @param {string[]} [input.sourceIds]
 * @returns {CatalogRefreshPlan<TRaw, TRow>}
 */
export function planModelGatewayCatalogRefresh(input = {}) {
    const now = input.now ?? (() => new Date());
    const observedAt = now();
    const requestedSourceIds = new Set((input.sourceIds ?? []).map((sourceId) => sourceId.trim()).filter(Boolean));
    /** @type {Map<string, Record<string, unknown>>} */
    const sourceById = new Map();
    for (const candidate of input.sources ?? []) {
        const source = recordOrNull(candidate);
        const id = optionalString(source?.['id']);
        if (source && id) sourceById.set(id, source);
    }

    /** @type {import('./importer-runner.js').CatalogImporter<TRaw, TRow>[]} */
    const selectedImporters = [];
    /** @type {CatalogRefreshPlanEntry[]} */
    const selected = [];
    /** @type {CatalogRefreshPlanEntry[]} */
    const skipped = [];

    for (const importer of input.importers ?? []) {
        const sourceId = importerSourceId(importer);
        const source = sourceById.get(sourceId) ?? null;
        if (requestedSourceIds.size > 0 && !requestedSourceIds.has(sourceId)) {
            skipped.push(createPlanEntry(importer, source, observedAt, 'source_not_requested'));
            continue;
        }
        if (input.force === true) {
            selectedImporters.push(importer);
            selected.push(createPlanEntry(importer, source, observedAt, source ? 'forced_refresh' : 'source_missing'));
            continue;
        }
        const ttlSeconds = ttlSecondsFor(importer, source);
        if (sourceIsFresh(source, ttlSeconds, observedAt)) {
            skipped.push(createPlanEntry(importer, source, observedAt, 'source_ttl_fresh'));
            continue;
        }
        selectedImporters.push(importer);
        selected.push(createPlanEntry(importer, source, observedAt, source ? 'source_ttl_expired' : 'source_missing'));
    }

    return {
        selectedImporters,
        selected,
        skipped,
        importerCount: (input.importers ?? []).length,
        sourceCount: sourceById.size,
    };
}
