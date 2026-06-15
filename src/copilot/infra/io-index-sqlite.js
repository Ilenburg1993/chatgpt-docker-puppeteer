// @ts-check
/**
 * Índice persistente L2 de I/O local.
 *
 * Diferente de `io-cache-l2-sqlite`, que guarda payloads de leitura para acelerar cache misses, este módulo guarda
 * metadados pesquisáveis: arquivos, FTS textual, símbolos Babel e edges de imports. O scanner e o parser continuam
 * sendo as fontes canônicas; o índice apenas materializa uma visão consultável e fresca.
 *
 * @module copilot/infra/io-index-sqlite
 */

import { createIoTraceId, toError } from '#copilot/core';
import { basename, extname } from 'node:path';
import pLimit from 'p-limit';
import {
    buildIndexPathTreeRange,
    classifyContentKind,
    countLines,
    DEFAULT_INDEX_EXTENSIONS,
    ensureIoIndexSchema,
    flattenScanEntries,
    iterateLineChunks,
    IO_INDEX_SCHEMA_VERSION,
    normalizeIndexExtensions,
    normalizeIndexMaxResults,
    normalizeIndexPath,
    normalizeRelativePath,
    sanitizeFtsQuery,
    sha256,
    shouldIndexFile,
    SYMBOL_EXTENSIONS,
} from './index-store/index.js';
import { acquireIoResourceLock } from './io-locks.js';
import { publishIoLifecycleEvent } from './io-observability.js';
import { parseFileSymbols } from './io-parser.js';
import { scanDirectory } from './io-scanner.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { statPathSnapshot } from './io/fs/stat.js';
import { utf8ByteLength } from './shared/buffer.js';
import { readEnvPositiveInt } from './shared/env.js';
import { fingerprintMatches, richFingerprintMatches } from './shared/fingerprint-match.js';

const DEFAULT_INDEX_BUILD_MAX_FILES = readEnvPositiveInt('IO_INDEX_BUILD_MAX_FILES', 10_000);
const DEFAULT_INDEX_HASH_VERIFY_MAX_BYTES = readEnvPositiveInt('IO_INDEX_HASH_VERIFY_MAX_BYTES', 1024 * 1024);
const DEFAULT_INDEX_HASH_VERIFY_INTERVAL_MS = readEnvPositiveInt('IO_INDEX_HASH_VERIFY_INTERVAL_MS', 30_000);
const DEFAULT_INDEX_SNAPSHOT_RETRIES = 2;

/**
 * @param {string} filePath
 * @param {number} attempts
 * @returns {Error & { code?: string; attempts?: number }}
 */
function createStaleIndexSnapshotError(filePath, attempts) {
    const error = /** @type {Error & { code?: string; attempts?: number }} */ (
        new Error(`Arquivo mudou antes do commit no índice: ${filePath}`)
    );
    error.code = 'ESTALEINDEXSNAPSHOT';
    error.attempts = attempts;
    return error;
}

/**
 * @typedef {'fresh' | 'stale' | 'failed' | 'skipped'} IoIndexFileStatus
 *
 * @typedef {{
 *     filePath: string;
 *     workspaceRoot: string;
 *     relativePath: string;
 *     fileName: string;
 *     extension: string;
 *     contentKind: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number | null;
 *     dev: number | null;
 *     ino: number | null;
 *     contentHash: string | null;
 *     lineCount: number;
 *     symbolCount: number;
 *     importCount: number;
 *     status: IoIndexFileStatus;
 *     parseError: string | null;
 *     indexedAtMs: number;
 *     refreshedAtMs: number;
 *     metadataJson: string | null;
 * }} IoIndexFileRow
 *
 *
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     chunkIndex: number;
 *     startLine: number;
 *     endLine: number;
 *     snippet: string;
 *     rank: number;
 * }} IoIndexSearchResult
 *
 *
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     symbolName: string;
 *     symbolKind: string;
 *     exported: number;
 *     line: number;
 *     docComment: string | null;
 * }} IoIndexSymbolResult
 *
 *
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     source: string;
 *     specifiersJson: string;
 *     isDynamic: number;
 *     line: number;
 * }} IoIndexImportResult
 */

/**
 * @param {{
 *     db: { exec: Function; prepare: Function; transaction?: Function };
 *     now?: () => number;
 *     hashVerifyMaxBytes?: number;
 *     hashVerifyIntervalMs?: number;
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
    const snapshotRetries =
        Number.isInteger(options?.snapshotRetries) && Number(options.snapshotRetries) >= 0
            ? Math.min(10, Number(options.snapshotRetries))
            : DEFAULT_INDEX_SNAPSHOT_RETRIES;

    const schemaVersion = ensureIoIndexSchema(db);

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
        snapshotConflicts: 0,
        errors: 0,
    };

    /**
     * @param {Record<string, unknown> | undefined} metadata
     * @param {number} [maxBytes=4096] Default is `4096`
     * @returns {string}
     */
    function safeMetaJson(metadata, maxBytes = 4096) {
        try {
            const json = JSON.stringify(metadata ?? {});
            if (typeof json !== 'string') return JSON.stringify({ _error: 'non-serializable' });
            if (utf8ByteLength(json, 'index metadata') <= maxBytes) return json;
            return JSON.stringify({ _truncated: true, _maxBytes: maxBytes });
        } catch {
            return JSON.stringify({ _error: 'non-serializable' });
        }
    }

    const stmtDeleteFile = db.prepare(`
        DELETE FROM copilot_io_index_files
        WHERE file_path = ? OR (file_path >= ? AND file_path < ?)
    `);
    const stmtDeleteFts = db.prepare(`
        DELETE FROM copilot_io_index_fts
        WHERE rowid IN (
            SELECT id
            FROM copilot_io_index_chunks
            WHERE file_path = ? OR (file_path >= ? AND file_path < ?)
        )
    `);
    const stmtDeleteSymbols = db.prepare(
        'DELETE FROM copilot_io_index_symbols WHERE file_path = ? OR (file_path >= ? AND file_path < ?)',
    );
    const stmtDeleteImports = db.prepare(
        'DELETE FROM copilot_io_index_imports WHERE file_path = ? OR (file_path >= ? AND file_path < ?)',
    );
    const stmtDeleteChunks = db.prepare(
        'DELETE FROM copilot_io_index_chunks WHERE file_path = ? OR (file_path >= ? AND file_path < ?)',
    );
    const stmtUpsertFile = db.prepare(`
        INSERT INTO copilot_io_index_files (
            file_path, workspace_root, relative_path, file_name, extension, content_kind, size_bytes, mtime_ms, ctime_ms,
            dev, ino, content_hash, line_count, symbol_count, import_count, status, parse_error, indexed_at_ms,
            refreshed_at_ms, metadata_json
        ) VALUES (
            @filePath, @workspaceRoot, @relativePath, @fileName, @extension, @contentKind, @sizeBytes, @mtimeMs, @ctimeMs,
            @dev, @ino, @contentHash, @lineCount, @symbolCount, @importCount, @status, @parseError, @indexedAtMs,
            @refreshedAtMs, @metadataJson
        )
        ON CONFLICT(file_path) DO UPDATE SET
            workspace_root = excluded.workspace_root,
            relative_path = excluded.relative_path,
            file_name = excluded.file_name,
            extension = excluded.extension,
            content_kind = excluded.content_kind,
            size_bytes = excluded.size_bytes,
            mtime_ms = excluded.mtime_ms,
            ctime_ms = excluded.ctime_ms,
            dev = excluded.dev,
            ino = excluded.ino,
            content_hash = excluded.content_hash,
            line_count = excluded.line_count,
            symbol_count = excluded.symbol_count,
            import_count = excluded.import_count,
            status = excluded.status,
            parse_error = excluded.parse_error,
            refreshed_at_ms = excluded.refreshed_at_ms,
            metadata_json = excluded.metadata_json
    `);
    const stmtRefreshFingerprint = db.prepare(`
        UPDATE copilot_io_index_files
        SET size_bytes = @sizeBytes,
            mtime_ms = @mtimeMs,
            ctime_ms = @ctimeMs,
            dev = @dev,
            ino = @ino,
            refreshed_at_ms = @refreshedAtMs,
            metadata_json = @metadataJson
        WHERE file_path = @filePath
    `);
    const stmtInsertFts = db.prepare(`
        INSERT INTO copilot_io_index_fts(rowid, relative_path, content)
        VALUES (?, ?, ?)
    `);
    const stmtInsertSymbol = db.prepare(`
        INSERT INTO copilot_io_index_symbols(file_path, symbol_name, symbol_kind, exported, line, doc_comment)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const stmtInsertImport = db.prepare(`
        INSERT INTO copilot_io_index_imports(file_path, source, specifiers_json, is_dynamic, line)
        VALUES (?, ?, ?, ?, ?)
    `);
    const stmtInsertChunk = db.prepare(`
        INSERT INTO copilot_io_index_chunks(file_path, chunk_index, start_line, end_line, content, content_hash, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const stmtGetFingerprint = db.prepare(`
        SELECT file_path as filePath,
               size_bytes as sizeBytes,
               mtime_ms as mtimeMs,
               ctime_ms as ctimeMs,
               dev,
               ino,
               content_hash as contentHash,
               refreshed_at_ms as refreshedAtMs,
               status
        FROM copilot_io_index_files
        WHERE file_path = ?
        LIMIT 1
    `);
    const stmtListIndexedUnderPathFiltered = db.prepare(`
        SELECT file_path as filePath, extension
        FROM copilot_io_index_files
        WHERE (file_path = ? OR (file_path >= ? AND file_path < ?))
            AND (? = '[]' OR extension IN (SELECT value FROM json_each(?)))
        ORDER BY file_path ASC
    `);
    const stmtCountFiles = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'fresh' THEN 1 ELSE 0 END) as fresh,
            SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) as stale,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            COALESCE(SUM(size_bytes), 0) as bytes
        FROM copilot_io_index_files
    `);
    const stmtCountSymbols = db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_symbols');
    const stmtCountImports = db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_imports');
    const stmtCountChunks = db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_chunks');
    const stmtLatest = db.prepare('SELECT MAX(refreshed_at_ms) as latest FROM copilot_io_index_files');
    const stmtSearch = db.prepare(`
        SELECT
            chunks.file_path as filePath,
            files.relative_path as relativePath,
            chunks.chunk_index as chunkIndex,
            chunks.start_line as startLine,
            chunks.end_line as endLine,
            snippet(copilot_io_index_fts, 1, '[', ']', ' … ', 12) as snippet,
            bm25(copilot_io_index_fts) as rank
        FROM copilot_io_index_fts
        JOIN copilot_io_index_chunks AS chunks ON chunks.id = copilot_io_index_fts.rowid
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        WHERE copilot_io_index_fts MATCH ?
        ORDER BY rank, files.relative_path, chunks.chunk_index
        LIMIT ?
    `);
    const stmtSearchScoped = db.prepare(`
        WITH scoped_chunks AS MATERIALIZED (
            SELECT
                chunks.id,
                chunks.file_path,
                chunks.chunk_index,
                chunks.start_line,
                chunks.end_line,
                files.relative_path
            FROM copilot_io_index_chunks AS chunks
            JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
            WHERE chunks.file_path = ? OR (chunks.file_path >= ? AND chunks.file_path < ?)
        )
        SELECT
            scoped_chunks.file_path as filePath,
            scoped_chunks.relative_path as relativePath,
            scoped_chunks.chunk_index as chunkIndex,
            scoped_chunks.start_line as startLine,
            scoped_chunks.end_line as endLine,
            snippet(copilot_io_index_fts, 1, '[', ']', ' … ', 12) as snippet,
            bm25(copilot_io_index_fts) as rank
        FROM scoped_chunks
        JOIN copilot_io_index_fts ON copilot_io_index_fts.rowid = scoped_chunks.id
        WHERE copilot_io_index_fts MATCH ?
        ORDER BY rank, scoped_chunks.relative_path, scoped_chunks.chunk_index
        LIMIT ?
    `);
    const stmtImportSearch = db.prepare(`
        SELECT
            i.file_path as filePath,
            f.relative_path as relativePath,
            i.source as source,
            i.specifiers_json as specifiersJson,
            i.is_dynamic as isDynamic,
            i.line as line
        FROM copilot_io_index_imports i
        JOIN copilot_io_index_files f ON f.file_path = i.file_path
        WHERE i.source = ? OR i.source LIKE ?
        ORDER BY i.source ASC, f.relative_path ASC
        LIMIT ?
    `);
    const stmtImportSearchByPath = db.prepare(`
        SELECT
            i.file_path as filePath,
            f.relative_path as relativePath,
            i.source as source,
            i.specifiers_json as specifiersJson,
            i.is_dynamic as isDynamic,
            i.line as line
        FROM copilot_io_index_imports i
        JOIN copilot_io_index_files f ON f.file_path = i.file_path
        WHERE i.file_path = ? OR (i.file_path >= ? AND i.file_path < ?)
        ORDER BY i.file_path ASC, i.line ASC
    `);

    /**
     * @param {string} filePath
     */
    function clearFileRows(filePath) {
        const range = buildIndexPathTreeRange(filePath);
        const params = [range.exact, range.descendantStart, range.descendantEnd];
        stmtDeleteFts.run(...params);
        stmtDeleteChunks.run(...params);
        stmtDeleteSymbols.run(...params);
        stmtDeleteImports.run(...params);
        stmtDeleteFile.run(...params);
    }

    /**
     * Remove do índice arquivos que pertencem à mesma fatia do scan, mas não existem mais no filesystem.
     *
     * A poda fica desabilitada automaticamente quando `include`/`exclude` estão ativos, porque esses filtros podem
     * materializar uma visão parcial intencional. Em builds completos, ela evita que FTS/símbolos respondam por
     * arquivos já removidos.
     *
     * @param {string} rootPath
     * @param {Set<string>} currentFilePaths
     * @param {readonly string[]} extensions
     * @returns {number}
     */
    function pruneMissingRows(rootPath, currentFilePaths, extensions) {
        const normalizedRoot = normalizeIndexPath(rootPath);
        const normalizedExtensions = extensions.map((ext) => String(ext).toLowerCase());
        const extensionJson = JSON.stringify(normalizedExtensions);
        const range = buildIndexPathTreeRange(normalizedRoot);
        const rows = /** @type {{ filePath: string; extension: string }[]} */ (
            stmtListIndexedUnderPathFiltered.all(
                range.exact,
                range.descendantStart,
                range.descendantEnd,
                extensionJson,
                extensionJson,
            )
        );
        let pruned = 0;
        const prune = () => {
            for (const row of rows) {
                if (currentFilePaths.has(row.filePath)) continue;
                clearFileRows(row.filePath);
                pruned += 1;
            }
        };
        if (typeof db.transaction === 'function') db.transaction(prune)();
        else prune();
        return pruned;
    }

    /**
     * @param {string} filePath
     * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }} snapshot
     * @param {{ action: string; attempt: number }} context
     */
    async function assertCurrentFileSnapshot(filePath, snapshot, context) {
        await options.onPhase?.('before-file-commit-validation', {
            filePath,
            action: context.action,
            attempt: context.attempt,
        });
        let current;
        try {
            current = await statPathSnapshot(filePath);
        } catch {
            throw createStaleIndexSnapshotError(filePath, context.attempt);
        }
        if (
            !richFingerprintMatches(
                snapshot,
                {
                    sizeBytes: current.size,
                    mtimeMs: current.mtimeMs,
                    ctimeMs: current.ctimeMs,
                    dev: Number(current.dev),
                    ino: Number(current.ino),
                },
                { mtimeToleranceMs: 0 },
            )
        ) {
            throw createStaleIndexSnapshotError(filePath, context.attempt);
        }
    }

    /**
     * @param {{
     *     filePath: string;
     *     workspaceRoot: string;
     *     content: string;
     *     sizeBytes: number;
     *     mtimeMs: number;
     *     ctimeMs?: number | null;
     *     dev?: number | null;
     *     ino?: number | null;
     *     metadata?: Record<string, unknown>;
     * }} input
     * @param {{ confirmCurrent?: boolean; attempt?: number; signal?: AbortSignal }} [internal]
     */
    async function indexTextFile(input, internal = {}) {
        internal.signal?.throwIfAborted();
        const filePath = normalizeIndexPath(input.filePath);
        const workspaceRoot = normalizeIndexPath(input.workspaceRoot);
        const relativePath = normalizeRelativePath(workspaceRoot, filePath);
        const extension = extname(filePath).toLowerCase();
        const contentHash = sha256(input.content);
        const indexedAtMs = now();

        let symbols = /** @type {import('./io-parser.js').FileSymbols | null} */ (null);
        let parseError = /** @type {string | null} */ (null);
        if (SYMBOL_EXTENSIONS.has(extension)) {
            try {
                symbols = await parseFileSymbols(
                    filePath,
                    input.content,
                    internal.signal ? { signal: internal.signal } : {},
                );
                parseError = symbols.parseError;
            } catch (e) {
                internal.signal?.throwIfAborted();
                parseError = toError(e).message;
            }
        }

        internal.signal?.throwIfAborted();
        if (internal.confirmCurrent !== false && input.ctimeMs != null && input.dev != null && input.ino != null) {
            await assertCurrentFileSnapshot(
                filePath,
                {
                    sizeBytes: input.sizeBytes,
                    mtimeMs: input.mtimeMs,
                    ctimeMs: input.ctimeMs,
                    dev: input.dev,
                    ino: input.ino,
                },
                { action: 'index', attempt: internal.attempt ?? 1 },
            );
        }

        internal.signal?.throwIfAborted();
        const commit = () => {
            clearFileRows(filePath);
            const fileSymbols = symbols?.symbols ?? [];
            const fileImports = symbols?.imports ?? [];
            stmtUpsertFile.run({
                filePath,
                workspaceRoot,
                relativePath,
                fileName: basename(filePath),
                extension,
                contentKind: classifyContentKind(filePath),
                sizeBytes: input.sizeBytes,
                mtimeMs: input.mtimeMs,
                ctimeMs: input.ctimeMs ?? null,
                dev: input.dev ?? null,
                ino: input.ino ?? null,
                contentHash,
                lineCount: countLines(input.content),
                symbolCount: fileSymbols.length,
                importCount: fileImports.length,
                status: parseError ? 'failed' : 'fresh',
                parseError,
                indexedAtMs,
                refreshedAtMs: indexedAtMs,
                metadataJson: safeMetaJson({
                    ...(input.metadata ?? {}),
                    indexVersion: IO_INDEX_SCHEMA_VERSION,
                    fingerprint: {
                        mtimeMs: input.mtimeMs,
                        ctimeMs: input.ctimeMs ?? null,
                        dev: input.dev ?? null,
                        ino: input.ino ?? null,
                        sizeBytes: input.sizeBytes,
                        contentHash,
                    },
                }),
            });
            for (const chunk of iterateLineChunks(input.content)) {
                const inserted = stmtInsertChunk.run(
                    filePath,
                    chunk.index,
                    chunk.startLine,
                    chunk.endLine,
                    chunk.content,
                    chunk.hash,
                    indexedAtMs,
                );
                stmtInsertFts.run(Number(inserted.lastInsertRowid), relativePath, chunk.content);
            }
            for (const symbol of fileSymbols) {
                stmtInsertSymbol.run(
                    filePath,
                    symbol.name,
                    symbol.kind,
                    symbol.exported ? 1 : 0,
                    symbol.line,
                    symbol.docComment ?? null,
                );
            }
            for (const importEntry of fileImports) {
                stmtInsertImport.run(
                    filePath,
                    importEntry.source,
                    JSON.stringify(importEntry.specifiers ?? []),
                    importEntry.isDynamic ? 1 : 0,
                    importEntry.line,
                );
            }
        };

        if (typeof db.transaction === 'function') db.transaction(commit)();
        else commit();

        stats.indexed += 1;
        publishIoLifecycleEvent('index', 'file.indexed', {
            filePath,
            workspaceRoot,
            relativePath,
            symbolCount: symbols?.symbols.length ?? 0,
            importCount: symbols?.imports.length ?? 0,
            parseError,
        });
        return {
            filePath,
            relativePath,
            contentHash,
            symbolCount: symbols?.symbols.length ?? 0,
            importCount: symbols?.imports.length ?? 0,
            parseError,
        };
    }

    return {
        /** @param {string} filePath */
        invalidatePath(filePath) {
            try {
                clearFileRows(normalizeIndexPath(filePath));
                stats.invalidations += 1;
                return true;
            } catch {
                stats.errors += 1;
                return false;
            }
        },

        indexTextFile,

        /**
         * @param {string} rootPath
         * @param {{
         *     workspaceRoot?: string;
         *     recursive?: boolean;
         *     depth?: number;
         *     respectGitignore?: boolean;
         *     include?: readonly string[];
         *     exclude?: readonly string[];
         *     extensions?: readonly string[];
         *     concurrency?: number;
         *     maxFiles?: number;
         *     pruneMissing?: boolean;
         *     signal?: AbortSignal;
         * }} [options]
         */
        async indexDirectory(rootPath, options = {}) {
            const normalizedRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
            const lockKey = `io-index-build:${normalizedRoot}`;
            const lease = await acquireIoResourceLock(lockKey, {
                operation: 'index-build',
                target: normalizedRoot,
                riskClass: 'low',
                ...(options.signal ? { signal: options.signal } : {}),
            });
            try {
                const value = await lease.run(async () => {
                    options.signal?.throwIfAborted();
                    const startedAt = Date.now();
                    const traceId = createIoTraceId();
                    const workspaceRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
                    const extensions = normalizeIndexExtensions(options.extensions ?? DEFAULT_INDEX_EXTENSIONS);
                    const concurrency =
                        Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
                            ? Math.floor(Number(options.concurrency))
                            : 8;
                    const limit = pLimit(concurrency);
                    const effectiveMaxFiles =
                        Number.isFinite(options.maxFiles) && Number(options.maxFiles) > 0
                            ? Math.floor(Number(options.maxFiles))
                            : DEFAULT_INDEX_BUILD_MAX_FILES;

                    publishIoLifecycleEvent('index', 'build.start', {
                        traceId,
                        rootPath,
                        workspaceRoot,
                        recursive: options.recursive ?? true,
                        concurrency,
                        effectiveMaxFiles,
                    });
                    /** @type {Parameters<typeof scanDirectory>[1]} */
                    const scanOptions = {
                        workspaceRoot,
                        recursive: options.recursive ?? true,
                        depth: options.depth ?? 20,
                        respectGitignore: options.respectGitignore ?? true,
                        concurrency,
                        fingerprint: true,
                        ...(options.signal ? { signal: options.signal } : {}),
                    };
                    if (options.include !== undefined) scanOptions.include = options.include;
                    if (options.exclude !== undefined) scanOptions.exclude = options.exclude;
                    const scan = await scanDirectory(rootPath, scanOptions);
                    options.signal?.throwIfAborted();
                    const allCandidates = flattenScanEntries(scan.entries).filter((entry) =>
                        shouldIndexFile(entry.absolutePath, extensions),
                    );
                    const files = allCandidates.slice(0, effectiveMaxFiles);
                    const hardLimitReached = allCandidates.length > files.length;

                    const currentFilePaths = new Set(files.map((entry) => normalizeIndexPath(entry.absolutePath)));
                    const hasFilterSlice = (options.include?.length ?? 0) > 0 || (options.exclude?.length ?? 0) > 0;
                    const maySafelyPrune =
                        options.pruneMissing === true || (!hasFilterSlice && options.pruneMissing !== false);
                    const pruned = maySafelyPrune ? pruneMissingRows(rootPath, currentFilePaths, extensions) : 0;

                    let failed = 0;
                    let unchanged = 0;
                    let hashVerifiedUnchanged = 0;
                    let buildHashVerifications = 0;
                    let buildHashVerificationHits = 0;
                    let buildHashVerificationMisses = 0;
                    let buildSnapshotConflicts = 0;
                    const indexed = [];

                    await Promise.all(
                        files.map((entry) =>
                            limit(async () => {
                                try {
                                    options.signal?.throwIfAborted();
                                    const normalizedFilePath = normalizeIndexPath(entry.absolutePath);
                                    const existing = /**
                                     * @type {{
                                     *     sizeBytes?: number;
                                     *     mtimeMs?: number;
                                     *     ctimeMs?: number | null;
                                     *     dev?: number | null;
                                     *     ino?: number | null;
                                     *     contentHash?: string | null;
                                     *     refreshedAtMs?: number;
                                     *     status?: string;
                                     * } | undefined}
                                     */ (stmtGetFingerprint.get(normalizedFilePath));
                                    const scannerFingerprint = entry.fingerprint;
                                    const basicFingerprintMatches =
                                        existing?.status === 'fresh' &&
                                        scannerFingerprint !== undefined &&
                                        fingerprintMatches(
                                            {
                                                mtimeMs: Number(existing.mtimeMs),
                                                sizeBytes: Number(existing.sizeBytes),
                                            },
                                            {
                                                mtimeMs: Number(scannerFingerprint.mtimeMs),
                                                sizeBytes: Number(scannerFingerprint.size),
                                            },
                                        );
                                    const richFingerprintMatched =
                                        basicFingerprintMatches &&
                                        Number(existing.ctimeMs) === Number(scannerFingerprint?.ctimeMs) &&
                                        Number(existing.dev) === Number(scannerFingerprint?.dev) &&
                                        Number(existing.ino) === Number(scannerFingerprint?.ino);
                                    const verificationAgeMs = Math.max(
                                        0,
                                        now() - Number(existing?.refreshedAtMs ?? 0),
                                    );
                                    const periodicHashDue =
                                        richFingerprintMatched &&
                                        verificationAgeMs >= hashVerifyIntervalMs &&
                                        Number(existing?.sizeBytes) <= hashVerifyMaxBytes &&
                                        typeof existing?.contentHash === 'string';
                                    if (richFingerprintMatched && !periodicHashDue && scannerFingerprint) {
                                        try {
                                            await assertCurrentFileSnapshot(
                                                normalizedFilePath,
                                                {
                                                    sizeBytes: Number(scannerFingerprint.size),
                                                    mtimeMs: Number(scannerFingerprint.mtimeMs),
                                                    ctimeMs: Number(scannerFingerprint.ctimeMs),
                                                    dev: Number(scannerFingerprint.dev),
                                                    ino: Number(scannerFingerprint.ino),
                                                },
                                                { action: 'unchanged', attempt: 1 },
                                            );
                                            unchanged += 1;
                                            return;
                                        } catch (error) {
                                            if (
                                                /** @type {{ code?: string }} */ (error).code !==
                                                'ESTALEINDEXSNAPSHOT'
                                            ) {
                                                throw error;
                                            }
                                            stats.snapshotConflicts += 1;
                                            buildSnapshotConflicts += 1;
                                        }
                                    }

                                    for (let snapshotAttempt = 1; snapshotAttempt <= snapshotRetries + 1; snapshotAttempt += 1) {
                                        try {
                                            const text = await readTextFileSnapshot(
                                                entry.absolutePath,
                                                options.signal ? { signal: options.signal } : {},
                                            );
                                            options.signal?.throwIfAborted();
                                            const hashVerificationEligible =
                                                existing?.status === 'fresh' &&
                                                text.sizeBytes === Number(existing.sizeBytes) &&
                                                text.sizeBytes <= hashVerifyMaxBytes &&
                                                typeof existing.contentHash === 'string';
                                            if (hashVerificationEligible) {
                                                stats.hashVerifications += 1;
                                                buildHashVerifications += 1;
                                                const currentHash = sha256(text.content);
                                                if (currentHash === existing.contentHash) {
                                                    await assertCurrentFileSnapshot(
                                                        normalizedFilePath,
                                                        text,
                                                        { action: 'hash-refresh', attempt: snapshotAttempt },
                                                    );
                                                    const refreshedAtMs = now();
                                                    stmtRefreshFingerprint.run({
                                                        filePath: normalizedFilePath,
                                                        sizeBytes: text.sizeBytes,
                                                        mtimeMs: text.mtimeMs,
                                                        ctimeMs: text.ctimeMs,
                                                        dev: text.dev,
                                                        ino: text.ino,
                                                        refreshedAtMs,
                                                        metadataJson: safeMetaJson({
                                                            source: 'indexDirectory.hashVerification',
                                                            indexTraceId: traceId,
                                                            scanTraceId: scan.io.traceId,
                                                            fingerprint: {
                                                                mtimeMs: text.mtimeMs,
                                                                ctimeMs: text.ctimeMs,
                                                                sizeBytes: text.sizeBytes,
                                                                dev: text.dev,
                                                                ino: text.ino,
                                                                contentHash: currentHash,
                                                            },
                                                        }),
                                                    });
                                                    stats.hashVerificationHits += 1;
                                                    buildHashVerificationHits += 1;
                                                    hashVerifiedUnchanged += 1;
                                                    unchanged += 1;
                                                    return;
                                                }
                                                stats.hashVerificationMisses += 1;
                                                buildHashVerificationMisses += 1;
                                            }

                                            indexed.push(
                                                await indexTextFile(
                                                    {
                                                        filePath: entry.absolutePath,
                                                        workspaceRoot,
                                                        content: text.content,
                                                        sizeBytes: text.sizeBytes,
                                                        mtimeMs: text.mtimeMs,
                                                        ctimeMs: text.ctimeMs,
                                                        dev: text.dev,
                                                        ino: text.ino,
                                                        metadata: {
                                                            scanTraceId: scan.io.traceId,
                                                            indexTraceId: traceId,
                                                            scannerEngine: scan.io.engine,
                                                            source: 'indexDirectory',
                                                            realpath: entry.fingerprint?.realpath ?? null,
                                                        },
                                                    },
                                                    {
                                                        confirmCurrent: true,
                                                        attempt: snapshotAttempt,
                                                        ...(options.signal ? { signal: options.signal } : {}),
                                                    },
                                                ),
                                            );
                                            if (indexed.length % 50 === 0) {
                                                publishIoLifecycleEvent('index', 'build.progress', {
                                                    traceId,
                                                    rootPath,
                                                    workspaceRoot,
                                                    indexed: indexed.length,
                                                    total: files.length,
                                                    pct:
                                                        files.length > 0
                                                            ? Math.round((indexed.length / files.length) * 100)
                                                            : 100,
                                                    currentFile: entry.absolutePath,
                                                });
                                            }
                                            return;
                                        } catch (error) {
                                            if (
                                                /** @type {{ code?: string }} */ (error).code !==
                                                'ESTALEINDEXSNAPSHOT'
                                            ) {
                                                throw error;
                                            }
                                            stats.snapshotConflicts += 1;
                                            buildSnapshotConflicts += 1;
                                            if (snapshotAttempt > snapshotRetries) throw error;
                                        }
                                    }
                                } catch {
                                    options.signal?.throwIfAborted();
                                    failed += 1;
                                }
                            }),
                        ),
                    );

                    const skipped = Math.max(0, flattenScanEntries(scan.entries).length - files.length);
                    stats.builds += 1;
                    stats.skipped += skipped + unchanged;
                    stats.failed += failed;
                    stats.pruned += pruned;
                    publishIoLifecycleEvent('index', 'build.complete', {
                        traceId,
                        rootPath,
                        workspaceRoot,
                        scannedEntries: scan.scannedEntries,
                        candidateFiles: files.length,
                        totalCandidates: allCandidates.length,
                        indexed: indexed.length,
                        unchanged,
                        hashVerifiedUnchanged,
                        hashVerifications: buildHashVerifications,
                        hashVerificationHits: buildHashVerificationHits,
                        hashVerificationMisses: buildHashVerificationMisses,
                        snapshotConflicts: buildSnapshotConflicts,
                        skipped,
                        failed,
                        pruned,
                        hardLimitReached,
                        effectiveMaxFiles,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    });

                    return {
                        available: true,
                        traceId,
                        workspaceRoot,
                        scannedEntries: scan.scannedEntries,
                        candidateFiles: files.length,
                        totalCandidates: allCandidates.length,
                        effectiveMaxFiles,
                        hardLimitReached,
                        indexed: indexed.length,
                        skipped: skipped + unchanged,
                        unchanged,
                        hashVerifiedUnchanged,
                        hashVerifications: buildHashVerifications,
                        hashVerificationHits: buildHashVerificationHits,
                        hashVerificationMisses: buildHashVerificationMisses,
                        snapshotConflicts: buildSnapshotConflicts,
                        failed,
                        pruned,
                        pruneMissing: maySafelyPrune,
                        durationMs: Math.max(0, Date.now() - startedAt),
                        limitMode: 'enforced-max-files',
                        freshnessPolicy: {
                            strategy: 'mtime-size-ctime-dev-ino-periodic-hash',
                            hashVerifyMaxBytes,
                            hashVerifyIntervalMs,
                            snapshotRetries,
                        },
                    };
                });

                return value;
            } finally {
                await lease.releaseAsync();
            }
        },

        /**
         * @param {string} query
         * @param {{ pathPrefix?: string; maxResults?: number }} [options]
         */
        search(query, options = {}) {
            stats.searches += 1;
            const safe = sanitizeFtsQuery(query);
            const maxResults = normalizeIndexMaxResults(options.maxResults);
            if (!options.pathPrefix) {
                return /** @type {IoIndexSearchResult[]} */ (stmtSearch.all(safe, maxResults));
            }
            const prefix = normalizeIndexPath(options.pathPrefix);
            const range = buildIndexPathTreeRange(prefix);
            return /** @type {IoIndexSearchResult[]} */ (
                stmtSearchScoped.all(range.exact, range.descendantStart, range.descendantEnd, safe, maxResults)
            );
        },

        /**
         * @param {string} name
         * @param {{
         *     maxResults?: number;
         *     pathPrefix?: string;
         *     kind?: string;
         *     exactMatch?: boolean;
         *     caseSensitive?: boolean;
         * }} [options]
         */
        findSymbol(name, options = {}) {
            stats.searches += 1;
            const safe = String(name ?? '').trim();
            if (!safe) return /** @type {IoIndexSymbolResult[]} */ ([]);

            /** @type {string[]} */
            const where = [];
            /** @type {unknown[]} */
            const params = [];
            if (options.exactMatch === true) {
                where.push(options.caseSensitive === true ? 's.symbol_name = ?' : 'lower(s.symbol_name) = lower(?)');
                params.push(safe);
            } else if (options.caseSensitive === true) {
                where.push('instr(s.symbol_name, ?) > 0');
                params.push(safe);
            } else {
                where.push('lower(s.symbol_name) LIKE lower(?)');
                params.push(`%${safe}%`);
            }

            if (options.kind && options.kind !== 'all') {
                where.push('s.symbol_kind = ?');
                params.push(options.kind);
            }

            if (options.pathPrefix) {
                const range = buildIndexPathTreeRange(options.pathPrefix);
                where.push('(s.file_path = ? OR (s.file_path >= ? AND s.file_path < ?))');
                params.push(range.exact, range.descendantStart, range.descendantEnd);
            }

            params.push(normalizeIndexMaxResults(options.maxResults));
            const sql = `
                SELECT
                    s.file_path as filePath,
                    f.relative_path as relativePath,
                    s.symbol_name as symbolName,
                    s.symbol_kind as symbolKind,
                    s.exported as exported,
                    s.line as line,
                    s.doc_comment as docComment
                FROM copilot_io_index_symbols s
                JOIN copilot_io_index_files f ON f.file_path = s.file_path
                WHERE ${where.join(' AND ')}
                ORDER BY s.symbol_name ASC, f.relative_path ASC
                LIMIT ?
            `;
            return /** @type {IoIndexSymbolResult[]} */ (db.prepare(sql).all(...params));
        },

        /**
         * @param {string} source
         * @param {{ maxResults?: number; exactSource?: boolean }} [options]
         */
        findImports(source, options = {}) {
            stats.searches += 1;
            const safe = String(source ?? '').trim();
            if (!safe) return /** @type {IoIndexImportResult[]} */ ([]);
            const rows = /** @type {IoIndexImportResult[]} */ (
                stmtImportSearch.all(safe, `%${safe}%`, normalizeIndexMaxResults(options.maxResults))
            );
            return options.exactSource ? rows.filter((r) => r.source === source) : rows;
        },

        /**
         * @param {string} pathPrefix
         * @returns {IoIndexImportResult[]}
         */
        findImportsByPath(pathPrefix) {
            stats.searches += 1;
            const range = buildIndexPathTreeRange(pathPrefix);
            return /** @type {IoIndexImportResult[]} */ (
                stmtImportSearchByPath.all(range.exact, range.descendantStart, range.descendantEnd)
            );
        },

        getStats() {
            const files = stmtCountFiles.get() ?? {};
            const symbols = stmtCountSymbols.get() ?? {};
            const imports = stmtCountImports.get() ?? {};
            const chunks = stmtCountChunks.get() ?? {};
            const latest = stmtLatest.get() ?? {};
            const totalFiles = Number(files.total ?? 0);
            const latestIndexedAtMs = Number(latest.latest ?? 0) || null;
            return {
                enabled: true,
                available: totalFiles > 0,
                schemaVersion,
                ...stats,
                files: totalFiles,
                freshFiles: Number(files.fresh ?? 0),
                staleFiles: Number(files.stale ?? 0),
                failedFiles: Number(files.failed ?? 0),
                bytesIndexed: Number(files.bytes ?? 0),
                symbols: Number(symbols.total ?? 0),
                imports: Number(imports.total ?? 0),
                chunks: Number(chunks.total ?? 0),
                latestIndexedAtMs,
                freshness: latestIndexedAtMs ? 'fresh-or-aging' : 'empty',
                freshnessPolicy: {
                    strategy: 'mtime-size-ctime-dev-ino-periodic-hash',
                    hashVerifyMaxBytes,
                    hashVerifyIntervalMs,
                    snapshotRetries,
                },
            };
        },

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
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof (/** @type {any} */ (value).indexDirectory) === 'function' &&
        typeof (/** @type {any} */ (value).search) === 'function',
    );
}
