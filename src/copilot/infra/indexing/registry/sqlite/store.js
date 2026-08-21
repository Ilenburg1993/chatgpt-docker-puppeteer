// @ts-check
/**
 * Índice persistente L2 de I/O local.
 *
 * Diferente de `io-cache-l2-sqlite`, que guarda payloads de leitura para acelerar cache misses, este módulo guarda
 * metadados pesquisáveis: arquivos, FTS textual, símbolos Babel e edges de imports. O scanner e o parser continuam
 * sendo as fontes canônicas; o índice apenas materializa uma visão consultável e fresca.
 *
 * @module copilot/infra/indexing/registry/sqlite/store
 */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { readEnvPositiveInt, richFingerprintMatches } from '#copilot/infra/internal/platform';
import { createIoIndexDirectoryBuilder } from './directory-builder.js';
import { createIoIndexMetadataPolicy } from './metadata.js';
import { normalizeIndexPath } from './paths.js';
import { createIoIndexQueryApi } from './query-api.js';
import { createIoIndexSnapshotVerifier } from './snapshot-verifier.js';
import { createIoIndexStatements } from './statements.js';
import { createIoIndexStatsReader } from './stats.js';
import { createIoIndexWriter } from './writer.js';

const DEFAULT_INDEX_HASH_VERIFY_MAX_BYTES = readEnvPositiveInt('IO_INDEX_HASH_VERIFY_MAX_BYTES', 1024 * 1024);
// Content hashing is a cryptographic safety net, not a 30-second freshness clock. Canonical invalidation, Git evidence
// and rich fs fingerprints catch normal changes; a 6h default keeps periodic verification without turning each
// 30-minute safety reconcile into a full workspace read/hash sweep.
const DEFAULT_INDEX_HASH_VERIFY_INTERVAL_MS = readEnvPositiveInt(
    'IO_INDEX_HASH_VERIFY_INTERVAL_MS',
    6 * 60 * 60 * 1000,
);
const DEFAULT_INDEX_RECHECK_UNCHANGED_SNAPSHOT = !['0', 'false', 'off'].includes(
    String(process.env['IO_INDEX_RECHECK_UNCHANGED_SNAPSHOT'] ?? '0')
        .trim()
        .toLowerCase(),
);
const DEFAULT_INDEX_SNAPSHOT_RETRIES = 2;

/**
 * Read the version of an index schema already prepared by the database owner. Indexing never migrates the shared
 * database itself; fresh isolated databases must be prepared explicitly before this store is constructed.
 *
 * @param {{ prepare: Function }} db
 * @returns {number}
 */
function readPreparedIoIndexSchemaVersion(db) {
    try {
        const row = /** @type {{ version?: unknown } | undefined} */ (
            db.prepare('SELECT MAX(version) AS version FROM copilot_io_index_schema_migrations').get()
        );
        const version = Number(row?.version ?? 0);
        if (Number.isSafeInteger(version) && version > 0) return version;
    } catch (cause) {
        const error = new Error('createIoIndexSqlite requires a database with the IO index schema already migrated.', {
            cause,
        });
        Object.assign(error, { code: 'ERR_IO_INDEX_SCHEMA_NOT_PREPARED' });
        throw error;
    }
    const error = new Error('createIoIndexSqlite requires a database with the IO index schema already migrated.');
    Object.assign(error, { code: 'ERR_IO_INDEX_SCHEMA_NOT_PREPARED' });
    throw error;
}

/**
 * @param {{
 *     db: { exec: Function; prepare: Function; transaction?: Function };
 *     now?: () => number;
 *     hashVerifyMaxBytes?: number;
 *     hashVerifyIntervalMs?: number;
 *     recheckUnchangedSnapshot?: boolean;
 *     snapshotRetries?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} options
 */
export function createIoIndexSqlite(options) {
    const db = options?.db;
    if (!db) throw new Error('createIoIndexSqlite requires { db }');
    const now = typeof options?.now === 'function' ? options.now : Date.now;
    const hashVerifyMaxBytes =
        Number.isFinite(options?.hashVerifyMaxBytes) && Number(options.hashVerifyMaxBytes) > 0
            ? Math.floor(Number(options.hashVerifyMaxBytes))
            : DEFAULT_INDEX_HASH_VERIFY_MAX_BYTES;
    const hashVerifyIntervalMs =
        Number.isFinite(options?.hashVerifyIntervalMs) && Number(options.hashVerifyIntervalMs) >= 0
            ? Math.floor(Number(options.hashVerifyIntervalMs))
            : DEFAULT_INDEX_HASH_VERIFY_INTERVAL_MS;
    const recheckUnchangedSnapshot =
        typeof options?.recheckUnchangedSnapshot === 'boolean'
            ? options.recheckUnchangedSnapshot
            : DEFAULT_INDEX_RECHECK_UNCHANGED_SNAPSHOT;
    const snapshotRetries =
        Number.isInteger(options?.snapshotRetries) && Number(options.snapshotRetries) >= 0
            ? Math.min(10, Number(options.snapshotRetries))
            : DEFAULT_INDEX_SNAPSHOT_RETRIES;

    const schemaVersion = readPreparedIoIndexSchemaVersion(db);

    const stats = {
        builds: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        pruned: 0,
        searches: 0,
        invalidations: 0,
        hashVerifications: 0,
        hashVerificationHits: 0,
        hashVerificationMisses: 0,
        unchangedFingerprintFastPath: 0,
        unchangedSnapshotRechecks: 0,
        parserPolicyRefreshes: 0,
        parsedSymbolPolicyRejects: 0,
        snapshotConflicts: 0,
        errors: 0,
    };
    const freshnessPolicy = Object.freeze({
        strategy: 'mtime-size-ctime-dev-ino-parser-policy-periodic-hash',
        parserPolicyVersion: BABEL_PARSER_POLICY_VERSION,
        hashVerifyMaxBytes,
        hashVerifyIntervalMs,
        recheckUnchangedSnapshot,
        snapshotRetries,
    });

    const statements = createIoIndexStatements(db);
    const { stmtGetFingerprint, stmtListIndexedFiles, stmtRefreshFingerprint } = statements;

    const { buildIndexMetadataJson, parserProjectionIsCurrent } = createIoIndexMetadataPolicy({ schemaVersion });
    const assertCurrentFileSnapshot = createIoIndexSnapshotVerifier(
        options.onPhase === undefined ? {} : { onPhase: options.onPhase },
    );
    const { indexTextFile, invalidatePath, pruneMissingRows } = createIoIndexWriter({
        db,
        statements,
        stats,
        now,
        buildIndexMetadataJson,
        assertCurrentFileSnapshot,
    });
    const indexDirectory = createIoIndexDirectoryBuilder({
        stats,
        now,
        freshnessPolicy,
        hashVerifyMaxBytes,
        hashVerifyIntervalMs,
        recheckUnchangedSnapshot,
        snapshotRetries,
        stmtGetFingerprint,
        stmtRefreshFingerprint,
        parserProjectionIsCurrent,
        assertCurrentFileSnapshot,
        buildIndexMetadataJson,
        pruneMissingRows,
        indexTextFile,
    });
    const queryApi = createIoIndexQueryApi({ db, statements, stats });
    const getStats = createIoIndexStatsReader({ statements, stats, schemaVersion, freshnessPolicy });

    return {
        /**
         * Fast fingerprint probe for explicit-path refreshes. This intentionally does not update refreshed_at_ms: a
         * periodic full reconciliation remains responsible for the long-horizon content-hash safety check.
         *
         * @param {string} filePath
         * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }} snapshot
         */
        matchesFileFingerprint(filePath, snapshot) {
            const normalizedFilePath = normalizeIndexPath(filePath);
            const existing = /** @type {{
          sizeBytes: number;
          mtimeMs: number;
          ctimeMs: number | null;
          dev: number | null;
          ino: number | null;
          metadataJson?: string | null;
          status: string;
      }
    | undefined} */ (stmtGetFingerprint.get(normalizedFilePath));
            return Boolean(
                existing &&
                existing.status === 'fresh' &&
                parserProjectionIsCurrent(normalizedFilePath, existing.metadataJson) &&
                existing.ctimeMs != null &&
                existing.dev != null &&
                existing.ino != null &&
                richFingerprintMatches(
                    {
                        sizeBytes: existing.sizeBytes,
                        mtimeMs: existing.mtimeMs,
                        ctimeMs: existing.ctimeMs,
                        dev: existing.dev,
                        ino: existing.ino,
                    },
                    snapshot,
                    { mtimeToleranceMs: 0 },
                ),
            );
        },

        listIndexedFiles() {
            return /** @type {{ filePath: string; extension: string; metadataJson: string | null }[]} */ (
                stmtListIndexedFiles.all()
            );
        },

        invalidatePath,
        indexTextFile,

        indexDirectory,

        ...queryApi,

        getStats,

        clearAll() {
            db.exec(`
                DELETE FROM copilot_io_index_chunks;
                DELETE FROM copilot_io_index_fts;
                DELETE FROM copilot_io_index_symbols;
                DELETE FROM copilot_io_index_imports;
                DELETE FROM copilot_io_index_files;
            `);
        },
    };
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<typeof createIoIndexSqlite>}
 */
export function isIoIndex(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return typeof candidate['indexDirectory'] === 'function' && typeof candidate['search'] === 'function';
}
