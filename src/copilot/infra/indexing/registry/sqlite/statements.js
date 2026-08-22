// @ts-check
/**
 * Prepared SQLite statements owned by the persistent index registry.
 *
 * Statement preparation is isolated from orchestration so the store facade owns lifecycle and transactions while this
 * module owns only connection-bound SQL primitives.
 *
 * @module copilot/infra/indexing/registry/sqlite/statements
 */

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 */
export function createIoIndexStatements(db) {
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
               metadata_json as metadataJson,
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
    const stmtListIndexedFiles = db.prepare(`
        SELECT file_path as filePath, extension, metadata_json as metadataJson
        FROM copilot_io_index_files
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
    const stmtLiteralSearch = db.prepare(`
        SELECT
            chunks.file_path as filePath,
            files.relative_path as relativePath,
            chunks.chunk_index as chunkIndex,
            chunks.start_line as startLine,
            chunks.end_line as endLine,
            chunks.content as content,
            substr(chunks.content, max(instr(chunks.content, ?) - 120, 1), 320) as snippet,
            0 as rank
        FROM copilot_io_index_chunks AS chunks
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        WHERE instr(chunks.content, ?) > 0
        ORDER BY files.relative_path, chunks.chunk_index
        LIMIT ?
    `);
    const stmtLiteralSearchScoped = db.prepare(`
        SELECT
            chunks.file_path as filePath,
            files.relative_path as relativePath,
            chunks.chunk_index as chunkIndex,
            chunks.start_line as startLine,
            chunks.end_line as endLine,
            chunks.content as content,
            substr(chunks.content, max(instr(chunks.content, ?) - 120, 1), 320) as snippet,
            0 as rank
        FROM copilot_io_index_chunks AS chunks
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        WHERE (chunks.file_path = ? OR (chunks.file_path >= ? AND chunks.file_path < ?))
            AND instr(chunks.content, ?) > 0
        ORDER BY files.relative_path, chunks.chunk_index
        LIMIT ?
    `);
    const stmtLiteralSearchInsensitive = db.prepare(`
        SELECT
            chunks.file_path as filePath,
            files.relative_path as relativePath,
            chunks.chunk_index as chunkIndex,
            chunks.start_line as startLine,
            chunks.end_line as endLine,
            chunks.content as content,
            substr(chunks.content, max(instr(lower(chunks.content), lower(?)) - 120, 1), 320) as snippet,
            0 as rank
        FROM copilot_io_index_chunks AS chunks
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        WHERE instr(lower(chunks.content), lower(?)) > 0
        ORDER BY files.relative_path, chunks.chunk_index
        LIMIT ?
    `);
    const stmtLiteralSearchInsensitiveScoped = db.prepare(`
        SELECT
            chunks.file_path as filePath,
            files.relative_path as relativePath,
            chunks.chunk_index as chunkIndex,
            chunks.start_line as startLine,
            chunks.end_line as endLine,
            chunks.content as content,
            substr(chunks.content, max(instr(lower(chunks.content), lower(?)) - 120, 1), 320) as snippet,
            0 as rank
        FROM copilot_io_index_chunks AS chunks
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        WHERE (chunks.file_path = ? OR (chunks.file_path >= ? AND chunks.file_path < ?))
            AND instr(lower(chunks.content), lower(?)) > 0
        ORDER BY files.relative_path, chunks.chunk_index
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

    return Object.freeze({
        stmtDeleteFile,
        stmtDeleteFts,
        stmtDeleteSymbols,
        stmtDeleteImports,
        stmtDeleteChunks,
        stmtUpsertFile,
        stmtRefreshFingerprint,
        stmtInsertFts,
        stmtInsertSymbol,
        stmtInsertImport,
        stmtInsertChunk,
        stmtGetFingerprint,
        stmtListIndexedUnderPathFiltered,
        stmtListIndexedFiles,
        stmtCountFiles,
        stmtCountSymbols,
        stmtCountImports,
        stmtCountChunks,
        stmtLatest,
        stmtSearch,
        stmtSearchScoped,
        stmtLiteralSearch,
        stmtLiteralSearchScoped,
        stmtLiteralSearchInsensitive,
        stmtLiteralSearchInsensitiveScoped,
        stmtImportSearch,
        stmtImportSearchByPath,
    });
}
