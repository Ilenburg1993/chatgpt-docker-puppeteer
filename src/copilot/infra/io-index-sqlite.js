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

import { createHash } from 'node:crypto';
import { basename, extname, relative, resolve } from 'node:path';
import pLimit from 'p-limit';
import { createIoTraceId } from '../core/io-contracts.js';
import { readText } from './io-engine.js';
import { publishIoLifecycleEvent } from './io-observability.js';
import { parseAndCacheSymbols } from './io-parser.js';
import { scanDirectory } from './io-scanner.js';

const DEFAULT_INDEX_EXTENSIONS = Object.freeze([
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.json',
    '.jsonc',
    '.md',
    '.mdx',
    '.txt',
    '.yaml',
    '.yml',
    '.css',
    '.html',
]);

const SYMBOL_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const DEFAULT_CHUNK_LINES = 200;

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
 * @param {string} filePath
 * @returns {string}
 */
function normalizeIndexPath(filePath) {
    return resolve(filePath).replace(/\\/g, '/');
}

/**
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @returns {string}
 */
function normalizeRelativePath(workspaceRoot, filePath) {
    return relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

/**
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} content
 * @returns {number}
 */
function countLines(content) {
    if (content.length === 0) return 0;
    return content.split(/\r\n|\r|\n/u).length;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function classifyContentKind(filePath) {
    const ext = extname(filePath).toLowerCase();
    if (SYMBOL_EXTENSIONS.has(ext)) return ext.endsWith('ts') || ext === '.tsx' ? 'typescript' : 'javascript';
    if (ext === '.json' || ext === '.jsonc') return 'json';
    if (ext === '.md' || ext === '.mdx') return 'markdown';
    if (ext === '.yaml' || ext === '.yml') return 'yaml';
    if (ext === '.html') return 'html';
    if (ext === '.css') return 'css';
    return 'text';
}

/**
 * @param {string} query
 * @returns {string}
 */
function sanitizeFtsQuery(query) {
    const tokens = query
        .split(/\s+/u)
        .map((part) => part.replace(/[^\p{L}\p{N}_./:-]+/gu, '').trim())
        .filter(Boolean);
    return tokens.length > 0 ? tokens.map((token) => `"${token.replace(/"/gu, '""')}"`).join(' ') : '""';
}

/**
 * @param {import('./io-scanner.js').IoScanEntry[]} entries
 * @returns {import('./io-scanner.js').IoScanEntry[]}
 */
function flattenScanEntries(entries) {
    /** @type {import('./io-scanner.js').IoScanEntry[]} */
    const out = [];
    for (const entry of entries) {
        if (entry.type === 'file') out.push(entry);
        if (Array.isArray(entry.children)) out.push(...flattenScanEntries(entry.children));
    }
    return out;
}

/**
 * @param {string} filePath
 * @param {readonly string[]} extensions
 * @returns {boolean}
 */
function shouldIndexFile(filePath, extensions) {
    if (extensions.length === 0) return true;
    return extensions.includes(extname(filePath).toLowerCase());
}

/**
 * @param {{ exec: Function; prepare: Function }} db
 */
function ensureIoIndexSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS copilot_io_index_files (
            file_path       TEXT PRIMARY KEY,
            workspace_root  TEXT NOT NULL,
            relative_path   TEXT NOT NULL,
            file_name       TEXT NOT NULL,
            extension       TEXT NOT NULL,
            content_kind    TEXT NOT NULL,
            size_bytes      INTEGER NOT NULL,
            mtime_ms        REAL NOT NULL,
            ctime_ms        REAL,
            content_hash    TEXT,
            line_count      INTEGER NOT NULL DEFAULT 0,
            symbol_count    INTEGER NOT NULL DEFAULT 0,
            import_count    INTEGER NOT NULL DEFAULT 0,
            status          TEXT NOT NULL,
            parse_error     TEXT,
            indexed_at_ms   INTEGER NOT NULL,
            refreshed_at_ms INTEGER NOT NULL,
            metadata_json   TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_io_index_files_workspace
            ON copilot_io_index_files(workspace_root, relative_path);
        CREATE INDEX IF NOT EXISTS idx_io_index_files_status
            ON copilot_io_index_files(status, indexed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_io_index_files_ext
            ON copilot_io_index_files(extension);

        CREATE VIRTUAL TABLE IF NOT EXISTS copilot_io_index_fts USING fts5(
            file_path UNINDEXED,
            relative_path,
            content,
            tokenize='porter unicode61 remove_diacritics 1'
        );

        CREATE TABLE IF NOT EXISTS copilot_io_index_symbols (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path    TEXT NOT NULL,
            symbol_name  TEXT NOT NULL,
            symbol_kind  TEXT NOT NULL,
            exported     INTEGER NOT NULL DEFAULT 0,
            line         INTEGER NOT NULL DEFAULT 0,
            doc_comment  TEXT,
            FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_io_index_symbols_name
            ON copilot_io_index_symbols(symbol_name);
        CREATE INDEX IF NOT EXISTS idx_io_index_symbols_file
            ON copilot_io_index_symbols(file_path);

        CREATE TABLE IF NOT EXISTS copilot_io_index_imports (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path       TEXT NOT NULL,
            source          TEXT NOT NULL,
            specifiers_json TEXT NOT NULL,
            is_dynamic      INTEGER NOT NULL DEFAULT 0,
            line            INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_io_index_imports_source
            ON copilot_io_index_imports(source);
        CREATE INDEX IF NOT EXISTS idx_io_index_imports_file
            ON copilot_io_index_imports(file_path);

        CREATE TABLE IF NOT EXISTS copilot_io_index_chunks (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path      TEXT NOT NULL,
            chunk_index    INTEGER NOT NULL,
            start_line     INTEGER NOT NULL,
            end_line       INTEGER NOT NULL,
            content        TEXT NOT NULL,
            content_hash   TEXT NOT NULL,
            created_at_ms  INTEGER NOT NULL,
            FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE,
            UNIQUE(file_path, chunk_index)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_io_index_chunks_file
            ON copilot_io_index_chunks(file_path, chunk_index);
    `);
}

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
     * @param {string} content
     * @returns {{ index: number; startLine: number; endLine: number; content: string; hash: string }[]}
     */
    function makeLineChunks(content) {
        if (content.length === 0) return [];
        const lines = content.split(/\r\n|\r|\n/u);
        const chunks = [];
        for (let i = 0; i < lines.length; i += DEFAULT_CHUNK_LINES) {
            const slice = lines.slice(i, i + DEFAULT_CHUNK_LINES);
            const chunkContent = slice.join('\n');
            chunks.push({
                index: chunks.length,
                startLine: i + 1,
                endLine: i + slice.length,
                content: chunkContent,
                hash: sha256(chunkContent),
            });
        }
        return chunks;
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
                // parseAndCacheSymbols usa io-engine como fonte canônica de leitura e reaproveita parser cache.
                symbols = await parseAndCacheSymbols(filePath);
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
            const extensions = (options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((ext) =>
                ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
            );
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
                            const text = await readText(entry.absolutePath, {
                                advisoryLimits: {
                                    source: 'io-index',
                                    limitMode: 'informative',
                                },
                            });
                            indexed.push(
                                await indexTextFile({
                                    filePath: entry.absolutePath,
                                    workspaceRoot,
                                    content: text.content,
                                    sizeBytes: entry.size ?? text.bytesRead,
                                    mtimeMs: entry.fingerprint?.mtimeMs ?? 0,
                                    ctimeMs: null,
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
         * @param {{ pathPrefix?: string }} [options]
         */
        search(query, options = {}) {
            stats.searches += 1;
            const safe = sanitizeFtsQuery(query);
            const rows = /** @type {IoIndexSearchResult[]} */ (stmtSearch.all(safe));
            if (!options.pathPrefix) return rows;
            const prefix = normalizeIndexPath(options.pathPrefix);
            return rows.filter((row) => row.filePath === prefix || row.filePath.startsWith(`${prefix}/`));
        },

        /** @param {string} name */
        findSymbol(name) {
            return stmtSymbolSearch.all(name, `%${name}%`);
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
