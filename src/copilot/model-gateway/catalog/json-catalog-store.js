// @ts-check
/**
 * JSON-backed universal catalog store.
 *
 * This is the storage-neutral proving ground before SQLite: the same redacted snapshot shape can later be inserted into
 * normalized tables without changing importer/merge contracts.
 *
 * @module copilot/model-gateway/catalog/json-catalog-store
 */

import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { readJson, writeJson } from '../../infra/storage/json-store.js';
import { MODEL_GATEWAY_CATALOG_SCHEMA_VERSION } from './contracts.js';

export const DEFAULT_MODEL_GATEWAY_CATALOG_PATH = join(
    process.cwd(),
    'data',
    'copilot',
    'model-gateway',
    'catalog.json',
);

const CATALOG_ARRAY_FIELDS = Object.freeze([
    'sources',
    'providerEvidences',
    'evidences',
    'routeOptions',
    'accountOverlays',
    'providerProjections',
    'projections',
    'importRuns',
    'rawPayloadRefs',
    'conflicts',
    'modelTombstones',
    'modelEligibilityRuns',
    'modelEligibilityDecisions',
]);
const CATALOG_STRING_BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu;
const CATALOG_STRING_JWT_RE = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const CATALOG_STRING_PROVIDER_SECRET_RE =
    /\b(?:hf_[A-Za-z0-9]{20,}|(?:(?:sk-(?:or-v1-)?|gsk[-_]|csk-|nvapi-|cpk[-_]|cfat[-_]|AIza|ya29\.|xoxb-|pat_|ghp_)[A-Za-z0-9._~+/=-]{8,}))\b/gu;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSecretCatalogKey(key) {
    return /^(?:authorization|proxy-authorization|api[_-]?key|secret|token|bearer[_-]?token|access[_-]?token)$/iu.test(key);
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
 * @returns {unknown}
 */
function sanitizeCatalogValue(value) {
    if (typeof value === 'string') {
        return value
            .replace(CATALOG_STRING_BEARER_RE, 'Bearer [redacted]')
            .replace(CATALOG_STRING_JWT_RE, '[redacted]')
            .replace(CATALOG_STRING_PROVIDER_SECRET_RE, '[redacted]');
    }
    if (Array.isArray(value)) return value.map(sanitizeCatalogValue);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                isSecretCatalogKey(key) ? '[redacted]' : sanitizeCatalogValue(item),
            ]),
        );
    }
    if (value === undefined) return null;
    return value;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function readRecordArray(value) {
    return Array.isArray(value)
        ? value.filter(isRecord).map((item) => /** @type {Record<string, unknown>} */ (sanitizeCatalogValue(item)))
        : [];
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function stableCatalogValue(value) {
    if (Array.isArray(value)) {
        return value.map(stableCatalogValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableCatalogValue(value[key])]));
    }
    return value;
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {string}
 */
export function createModelGatewayCatalogSnapshotId(snapshot) {
    const stablePayload = {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        ...Object.fromEntries(CATALOG_ARRAY_FIELDS.map((field) => [field, readRecordArray(snapshot[field])])),
    };
    return `catalog:${createHash('sha256').update(JSON.stringify(stableCatalogValue(stablePayload))).digest('hex').slice(0, 24)}`;
}

/**
 * @param {unknown} snapshot
 * @returns {{
 *     schemaVersion: number;
 *     snapshotId: string;
 *     generatedAt: string | null;
 *     source: string;
 *     sources: Record<string, unknown>[];
 *     providerEvidences: Record<string, unknown>[];
 *     evidences: Record<string, unknown>[];
 *     routeOptions: Record<string, unknown>[];
 *     accountOverlays: Record<string, unknown>[];
 *     providerProjections: Record<string, unknown>[];
 *     projections: Record<string, unknown>[];
 *     importRuns: Record<string, unknown>[];
 *     rawPayloadRefs: Record<string, unknown>[];
 *     conflicts: Record<string, unknown>[];
 *     modelTombstones: Record<string, unknown>[];
 *     modelEligibilityRuns: Record<string, unknown>[];
 *     modelEligibilityDecisions: Record<string, unknown>[];
 * }}
 */
export function normalizeStoredCatalogSnapshot(snapshot) {
    const empty = {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        snapshotId: createModelGatewayCatalogSnapshotId({}),
        generatedAt: null,
        source: 'empty',
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
    if (!isRecord(snapshot) || snapshot['schemaVersion'] !== MODEL_GATEWAY_CATALOG_SCHEMA_VERSION) return empty;
    const normalized = {
        ...empty,
        snapshotId: optionalString(snapshot['snapshotId']) ?? createModelGatewayCatalogSnapshotId(snapshot),
        generatedAt: typeof snapshot['generatedAt'] === 'string' ? snapshot['generatedAt'] : null,
        source: typeof snapshot['source'] === 'string' ? snapshot['source'] : 'unknown',
        sources: readRecordArray(snapshot['sources']),
        providerEvidences: readRecordArray(snapshot['providerEvidences']),
        evidences: readRecordArray(snapshot['evidences']),
        routeOptions: readRecordArray(snapshot['routeOptions']),
        accountOverlays: readRecordArray(snapshot['accountOverlays']),
        providerProjections: readRecordArray(snapshot['providerProjections']),
        projections: readRecordArray(snapshot['projections']),
        importRuns: readRecordArray(snapshot['importRuns']),
        rawPayloadRefs: readRecordArray(snapshot['rawPayloadRefs']),
        conflicts: readRecordArray(snapshot['conflicts']),
        modelTombstones: readRecordArray(snapshot['modelTombstones']),
        modelEligibilityRuns: readRecordArray(snapshot['modelEligibilityRuns']),
        modelEligibilityDecisions: readRecordArray(snapshot['modelEligibilityDecisions']),
    };
    normalized.snapshotId = optionalString(snapshot['snapshotId']) ?? createModelGatewayCatalogSnapshotId(normalized);
    return normalized;
}

export class JsonModelGatewayCatalogStore {
    /** @type {string} */
    #filePath;

    /**
     * @param {{ filePath?: string }} [options]
     */
    constructor(options = {}) {
        this.#filePath = options.filePath ?? DEFAULT_MODEL_GATEWAY_CATALOG_PATH;
    }

    /** @returns {string} */
    get filePath() {
        return this.#filePath;
    }

    /**
     * @returns {Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>}
     */
    async readSnapshot() {
        const raw = await readJson(this.#filePath, null);
        return normalizeStoredCatalogSnapshot(raw);
    }

    /**
     * @param {Partial<ReturnType<typeof normalizeStoredCatalogSnapshot>> & { source?: string }} snapshot
     * @returns {Promise<void>}
     */
    async writeSnapshot(snapshot) {
        /** @type {Record<string, unknown>} */
        const next = {
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            source: snapshot.source ?? 'catalog',
        };
        for (const field of CATALOG_ARRAY_FIELDS) {
            next[field] = readRecordArray(/** @type {Record<string, unknown>} */ (snapshot)[field]);
        }
        next['snapshotId'] = optionalString(/** @type {Record<string, unknown>} */ (snapshot)['snapshotId']) ?? createModelGatewayCatalogSnapshotId(next);
        await writeJson(this.#filePath, next);
    }
}
