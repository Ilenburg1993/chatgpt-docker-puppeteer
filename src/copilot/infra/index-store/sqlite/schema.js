// @ts-check
/**
 * Schema SQLite do índice persistente de I/O.
 *
 * @module copilot/infra/index-store/sqlite/schema
 */

/**
 * @param {{ exec: Function; prepare: Function }} db
 */
export function ensureIoIndexSchema(db) {
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
            dev             INTEGER,
            ino             INTEGER,
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

    const columns = new Set(
        /** @type {{ name?: unknown }[]} */ (db.prepare('PRAGMA table_info(copilot_io_index_files)').all()).map(
            (column) => String(column.name ?? ''),
        ),
    );
    if (!columns.has('dev')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN dev INTEGER');
    if (!columns.has('ino')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN ino INTEGER');
}
