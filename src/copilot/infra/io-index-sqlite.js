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

import { basename, extname } from 'node:path';
import pLimit from 'p-limit';
import { createIoTraceId } from '../core/io-contracts.js';
import {
    classifyContentKind,
    countLines,
    DEFAULT_INDEX_EXTENSIONS,
    ensureIoIndexSchema,
    flattenScanEntries,
    makeLineChunks,
    normalizeIndexExtensions,
    normalizeIndexMaxResults,
    normalizeIndexPath,
    normalizeRelativePath,
    sanitizeFtsQuery,
    sha256,
    shouldIndexFile,
    SYMBOL_EXTENSIONS,
} from './index-store/index.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { publishIoLifecycleEvent } from './io-observability.js';
import { parseFileSymbols } from './io-parser.js';
import { scanDirectory } from './io-scanner.js';

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
 *     snippet: string;
 *     rank: number;
 * }} IoIndexSearchResult
 */

/**
 * @param {{ db: { exec: Function; prepare: Function; transaction?: Function }; now?: () => number }} options
 */
export function createIoIndexSqlite(options) {
    const db = options?.db;
    if (!db) throw new Error('createIoIndexSqlite requires { db }');
    const now = typeof options?.now === 'function' ? options.now : Date.now;

    ensureIoIndexSchema(db);

    const stats = {
        builds: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        pruned: 0,
        searches: 0,
        invalidations: 0,
        errors: 0,
    };

    const stmtDeleteFile = db.prepare('DELETE FROM copilot_io_index_files WHERE file_path = ? OR file_path LIKE ?');
    const stmtDeleteFts = db.prepare('DELETE FROM copilot_io_index_fts WHERE file_path = ? OR file_path LIKE ?');
    const stmtDeleteSymbols = db.prepare(
        'DELETE FROM copilot_io_index_symbols WHERE file_path = ? OR file_path LIKE ?',
    );
    const stmtDeleteImports = db.prepare(
        'DELETE FROM copilot_io_index_imports WHERE file_path = ? OR file_path LIKE ?',
    );
    const stmtDeleteChunks = db.prepare('DELETE FROM copilot_io_index_chunks WHERE file_path = ? OR file_path LIKE ?');
    const stmtUpsertFile = db.prepare(`
        INSERT INTO copilot_io_index_files (
            file_path, workspace_root, relative_path, file_name, extension, content_kind, size_bytes, mtime_ms, ctime_ms,
            content_hash, line_count, symbol_count, import_count, status, parse_error, indexed_at_ms, refreshed_at_ms,
            metadata_json
        ) VALUES (
            @filePath, @workspaceRoot, @relativePath, @fileName, @extension, @contentKind, @sizeBytes, @mtimeMs, @ctimeMs,
            @contentHash, @lineCount, @symbolCount, @importCount, @status, @parseError, @indexedAtMs, @refreshedAtMs,
            @metadataJson
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
            content_hash = excluded.content_hash,
            line_count = excluded.line_count,
            symbol_count = excluded.symbol_count,
            import_count = excluded.import_count,
            status = excluded.status,
            parse_error = excluded.parse_error,
            refreshed_at_ms = excluded.refreshed_at_ms,
            metadata_json = excluded.metadata_json
    `);
    const stmtInsertFts = db.prepare(`
        INSERT INTO copilot_io_index_fts(file_path, relative_path, content)
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
        SELECT file_path as filePath, size_bytes as sizeBytes, mtime_ms as mtimeMs, status
        FROM copilot_io_index_files
        WHERE file_path = ?
        LIMIT 1
    `);
    const stmtListIndexedUnderPath = db.prepare(`
        SELECT file_path as filePath, extension
        FROM copilot_io_index_files
        WHERE file_path = ? OR file_path LIKE ?
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
            file_path as filePath,
            relative_path as relativePath,
            snippet(copilot_io_index_fts, 2, '[', ']', ' … ', 12) as snippet,
            bm25(copilot_io_index_fts) as rank
        FROM copilot_io_index_fts
        WHERE copilot_io_index_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    `);
    const stmtSearchScoped = db.prepare(`
        SELECT
            file_path as filePath,
            relative_path as relativePath,
            snippet(copilot_io_index_fts, 2, '[', ']', ' … ', 12) as snippet,
            bm25(copilot_io_index_fts) as rank
        FROM copilot_io_index_fts
        WHERE copilot_io_index_fts MATCH ?
            AND (file_path = ? OR file_path LIKE ?)
        ORDER BY rank
        LIMIT ?
    `);
    const stmtSymbolSearch = db.prepare(`
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
        WHERE s.symbol_name = ? OR s.symbol_name LIKE ?
        ORDER BY s.symbol_name ASC, f.relative_path ASC
        LIMIT ?
    `);

    /**
     * @param {string} filePath
     */
    function clearFileRows(filePath) {
        const prefix = `${filePath}/%`;
        stmtDeleteChunks.run(filePath, prefix);
        stmtDeleteFts.run(filePath, prefix);
        stmtDeleteSymbols.run(filePath, prefix);
        stmtDeleteImports.run(filePath, prefix);
        stmtDeleteFile.run(filePath, prefix);
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
        const rows = /** @type {{ filePath: string; extension: string }[]} */ (
            stmtListIndexedUnderPath.all(normalizedRoot, `${normalizedRoot}/%`)
        );
        let pruned = 0;
        for (const row of rows) {
            if (extensions.length > 0 && !extensions.includes(String(row.extension).toLowerCase())) continue;
            if (currentFilePaths.has(row.filePath)) continue;
            clearFileRows(row.filePath);
            pruned += 1;
        }
        return pruned;
    }

    /**
     * @param {{
     *     filePath: string;
     *     workspaceRoot: string;
     *     content: string;
     *     sizeBytes: number;
     *     mtimeMs: number;
     *     ctimeMs?: number | null;
     *     metadata?: Record<string, unknown>;
     * }} input
     */
    async function indexTextFile(input) {
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
                symbols = await parseFileSymbols(filePath, input.content);
                parseError = symbols.parseError;
            } catch (e) {
                parseError = e instanceof Error ? e.message : String(e);
            }
        }

        const commit = () => {
            clearFileRows(filePath);
            const fileSymbols = symbols?.symbols ?? [];
            const fileImports = symbols?.imports ?? [];
            const chunks = makeLineChunks(input.content);
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
                contentHash,
                lineCount: countLines(input.content),
                symbolCount: fileSymbols.length,
                importCount: fileImports.length,
                status: parseError ? 'failed' : 'fresh',
                parseError,
                indexedAtMs,
                refreshedAtMs: indexedAtMs,
                metadataJson: JSON.stringify({
                    ...(input.metadata ?? {}),
                    indexVersion: 1,
                    fingerprint: {
                        mtimeMs: input.mtimeMs,
                        ctimeMs: input.ctimeMs ?? null,
                        sizeBytes: input.sizeBytes,
                        contentHash,
                    },
                }),
            });
            stmtInsertFts.run(filePath, relativePath, input.content);
            for (const chunk of chunks) {
                stmtInsertChunk.run(
                    filePath,
                    chunk.index,
                    chunk.startLine,
                    chunk.endLine,
                    chunk.content,
                    chunk.hash,
                    indexedAtMs,
                );
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
         *     pruneMissing?: boolean;
         * }} [options]
         */
        async indexDirectory(rootPath, options = {}) {
            const startedAt = Date.now();
            const traceId = createIoTraceId();
            const workspaceRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
            const extensions = normalizeIndexExtensions(options.extensions ?? DEFAULT_INDEX_EXTENSIONS);
            const concurrency =
                Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
                    ? Math.floor(Number(options.concurrency))
                    : 8;
            const limit = pLimit(concurrency);
            publishIoLifecycleEvent('index', 'build.start', {
                traceId,
                rootPath,
                workspaceRoot,
                recursive: options.recursive ?? true,
                concurrency,
            });
            /** @type {Parameters<typeof scanDirectory>[1]} */
            const scanOptions = {
                workspaceRoot,
                recursive: options.recursive ?? true,
                depth: options.depth ?? 20,
                respectGitignore: options.respectGitignore ?? true,
                concurrency,
                fingerprint: true,
            };
            if (options.include !== undefined) scanOptions.include = options.include;
            if (options.exclude !== undefined) scanOptions.exclude = options.exclude;
            const scan = await scanDirectory(rootPath, scanOptions);
            const files = flattenScanEntries(scan.entries).filter((entry) =>
                shouldIndexFile(entry.absolutePath, extensions),
            );
            const currentFilePaths = new Set(files.map((entry) => normalizeIndexPath(entry.absolutePath)));
            const maySafelyPrune =
                (options.include?.length ?? 0) === 0 &&
                (options.exclude?.length ?? 0) === 0 &&
                options.pruneMissing !== false;
            const pruned = maySafelyPrune ? pruneMissingRows(rootPath, currentFilePaths, extensions) : 0;

            let failed = 0;
            let unchanged = 0;
            const indexed = [];

            await Promise.all(
                files.map((entry) =>
                    limit(async () => {
                        try {
                            const normalizedFilePath = normalizeIndexPath(entry.absolutePath);
                            const existing =
                                /** @type {{ sizeBytes?: number; mtimeMs?: number; status?: string } | undefined} */ (
                                    stmtGetFingerprint.get(normalizedFilePath)
                                );
                            if (
                                existing?.status === 'fresh' &&
                                entry.fingerprint &&
                                Number(existing.sizeBytes) === Number(entry.fingerprint.size) &&
                                Number(existing.mtimeMs) === Number(entry.fingerprint.mtimeMs)
                            ) {
                                unchanged += 1;
                                return;
                            }
                            const text = await readTextFileSnapshot(entry.absolutePath);
                            indexed.push(
                                await indexTextFile({
                                    filePath: entry.absolutePath,
                                    workspaceRoot,
                                    content: text.content,
                                    sizeBytes: entry.size ?? text.sizeBytes,
                                    mtimeMs: entry.fingerprint?.mtimeMs ?? text.mtimeMs,
                                    ctimeMs: text.ctimeMs,
                                    metadata: {
                                        scanTraceId: scan.io.traceId,
                                        indexTraceId: traceId,
                                        scannerEngine: scan.io.engine,
                                        source: 'indexDirectory',
                                        realpath: entry.fingerprint?.realpath ?? null,
                                    },
                                }),
                            );
                        } catch {
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
                indexed: indexed.length,
                unchanged,
                skipped,
                failed,
                pruned,
                durationMs: Math.max(0, Date.now() - startedAt),
            });

            return {
                available: true,
                traceId,
                workspaceRoot,
                scannedEntries: scan.scannedEntries,
                candidateFiles: files.length,
                indexed: indexed.length,
                skipped: skipped + unchanged,
                unchanged,
                failed,
                pruned,
                pruneMissing: maySafelyPrune,
                durationMs: Math.max(0, Date.now() - startedAt),
                limitMode: 'informative',
            };
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
            return /** @type {IoIndexSearchResult[]} */ (
                stmtSearchScoped.all(safe, prefix, `${prefix}/%`, maxResults)
            );
        },

        /**
         * @param {string} name
         * @param {{ maxResults?: number }} [options]
         */
        findSymbol(name, options = {}) {
            return stmtSymbolSearch.all(name, `%${name}%`, normalizeIndexMaxResults(options.maxResults));
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
