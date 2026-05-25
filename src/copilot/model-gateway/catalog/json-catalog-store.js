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

import { readJson, writeJson } from '../../infra/storage/json-store.js';
import { redactSecretText } from '../secrets/index.js';
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
    'evidences',
    'routeOptions',
    'accountOverlays',
    'projections',
    'importRuns',
    'rawPayloadRefs',
    'conflicts',
]);

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
 * @returns {unknown}
 */
function sanitizeCatalogValue(value) {
    if (typeof value === 'string') return redactSecretText(value);
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
 * @returns {Record<string, any>[]}
 */
function readRecordArray(value) {
    return Array.isArray(value)
        ? value.filter(isRecord).map((item) => /** @type {Record<string, any>} */ (sanitizeCatalogValue(item)))
        : [];
}

/**
 * @param {unknown} snapshot
 * @returns {{
 *     schemaVersion: number;
 *     generatedAt: string | null;
 *     source: string;
 *     sources: Record<string, any>[];
 *     evidences: Record<string, any>[];
 *     routeOptions: Record<string, any>[];
 *     accountOverlays: Record<string, any>[];
 *     projections: Record<string, any>[];
 *     importRuns: Record<string, any>[];
 *     rawPayloadRefs: Record<string, any>[];
 *     conflicts: Record<string, any>[];
 * }}
 */
export function normalizeStoredCatalogSnapshot(snapshot) {
    const empty = {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        generatedAt: null,
        source: 'empty',
        sources: [],
        evidences: [],
        routeOptions: [],
        accountOverlays: [],
        projections: [],
        importRuns: [],
        rawPayloadRefs: [],
        conflicts: [],
    };
    if (!isRecord(snapshot) || snapshot['schemaVersion'] !== MODEL_GATEWAY_CATALOG_SCHEMA_VERSION) return empty;
    return {
        ...empty,
        generatedAt: typeof snapshot['generatedAt'] === 'string' ? snapshot['generatedAt'] : null,
        source: typeof snapshot['source'] === 'string' ? snapshot['source'] : 'unknown',
        sources: readRecordArray(snapshot['sources']),
        evidences: readRecordArray(snapshot['evidences']),
        routeOptions: readRecordArray(snapshot['routeOptions']),
        accountOverlays: readRecordArray(snapshot['accountOverlays']),
        projections: readRecordArray(snapshot['projections']),
        importRuns: readRecordArray(snapshot['importRuns']),
        rawPayloadRefs: readRecordArray(snapshot['rawPayloadRefs']),
        conflicts: readRecordArray(snapshot['conflicts']),
    };
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
        await writeJson(this.#filePath, next);
    }
}
