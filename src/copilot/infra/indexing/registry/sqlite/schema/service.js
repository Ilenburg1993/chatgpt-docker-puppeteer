// @ts-check
/**
 * Schema SQLite versionado do índice persistente de I/O.
 *
 * @module copilot/infra/indexing/registry/sqlite/schema/service
 */

import { runSqliteTransaction } from '#copilot/infra/internal/database/transaction/atomic';
import { createHash } from 'node:crypto';

const LEGACY_INDEX_CHUNK_LINES = 200;

/**
 * Migration-local line chunker. The durable DB schema owns legacy-data migration and deliberately does not depend on
 * indexing runtime helpers, keeping the database layer below the derived indexing capability.
 *
 * @param {string} content
 * @returns {Generator<{ index: number; startLine: number; endLine: number; content: string; hash: string }>}
 */
function* iterateLegacyLineChunks(content) {
    if (content.length === 0) return;
    /** @type {string[]} */
    let lines = [];
    let chunkIndex = 0;
    let startLine = 1;
    let line = 1;
    let start = 0;

    /** @param {number} end */
    const flushLine = (end) => {
        lines.push(content.slice(start, end));
    };

    for (let index = 0; index < content.length; index += 1) {
        const code = content.charCodeAt(index);
        if (code !== 10 && code !== 13) continue;
        flushLine(index);
        if (code === 13 && content.charCodeAt(index + 1) === 10) index += 1;
        start = index + 1;

        if (lines.length >= LEGACY_INDEX_CHUNK_LINES) {
            const chunkContent = lines.join('\n');
            yield {
                index: chunkIndex,
                startLine,
                endLine: line,
                content: chunkContent,
                hash: createHash('sha256').update(chunkContent, 'utf8').digest('hex'),
            };
            chunkIndex += 1;
            startLine = line + 1;
            lines = [];
        }
        line += 1;
    }

    lines.push(content.slice(start));
    if (lines.length > 0) {
        const chunkContent = lines.join('\n');
        yield {
            index: chunkIndex,
            startLine,
            endLine: startLine + lines.length - 1,
            content: chunkContent,
            hash: createHash('sha256').update(chunkContent, 'utf8').digest('hex'),
        };
    }
}

export const IO_INDEX_SCHEMA_VERSION = 2;

const CREATE_SCHEMA_MIGRATIONS_SQL = `
    CREATE TABLE IF NOT EXISTS copilot_io_index_schema_migrations (
        version       INTEGER PRIMARY KEY,
        name          TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL
    ) STRICT;
`;

const CREATE_LEGACY_SCHEMA_SQL = `
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
`;

const CREATE_CHUNK_FTS_SQL = `
    CREATE VIRTUAL TABLE copilot_io_index_fts USING fts5(
        relative_path,
        content,
        tokenize='porter unicode61 remove_diacritics 1'
    );
`;

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 * @param {string} tableName
 * @returns {boolean}
 */
function tableExists(db, tableName) {
    return Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1").get(tableName),
    );
}

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 * @param {string} tableName
 * @returns {Set<string>}
 */
function tableColumns(db, tableName) {
    if (!tableExists(db, tableName)) return new Set();
    return new Set(
        /** @type {{ name?: unknown }[]} */ (db.prepare(`PRAGMA table_info(${tableName})`).all()).map((column) =>
            String(column.name ?? ''),
        ),
    );
}

/**
 * Registra o baseline de bancos criados antes do versionamento local do index-store.
 *
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 */
function recordLegacyBaseline(db) {
    if (!tableExists(db, 'copilot_io_index_fts')) return;
    const columns = tableColumns(db, 'copilot_io_index_fts');
    const insert = db.prepare(`
        INSERT OR IGNORE INTO copilot_io_index_schema_migrations(version, name, applied_at_ms)
        VALUES (?, ?, ?)
    `);
    const appliedAtMs = Date.now();
    insert.run(1, 'create_legacy_io_index', appliedAtMs);
    if (!columns.has('file_path') && columns.has('relative_path') && columns.has('content')) {
        insert.run(2, 'migrate_fts_to_chunks', appliedAtMs);
    }
}

/**
 * Preenche chunks ausentes usando o conteúdo integral armazenado pelo FTS legado.
 *
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 */
function backfillLegacyChunks(db) {
    const ftsColumns = tableColumns(db, 'copilot_io_index_fts');
    if (!ftsColumns.has('file_path')) return;
    const rows = /** @type {{ filePath: string; content: string }[]} */ (
        db
            .prepare(
                `
                SELECT fts.file_path AS filePath, fts.content AS content
                FROM copilot_io_index_fts AS fts
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM copilot_io_index_chunks AS chunks
                    WHERE chunks.file_path = fts.file_path
                )
            `,
            )
            .all()
    );
    const insertChunk = db.prepare(`
        INSERT OR IGNORE INTO copilot_io_index_chunks(
            file_path, chunk_index, start_line, end_line, content, content_hash, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const createdAtMs = Date.now();
    for (const row of rows) {
        for (const chunk of iterateLegacyLineChunks(String(row.content ?? ''))) {
            insertChunk.run(
                row.filePath,
                chunk.index,
                chunk.startLine,
                chunk.endLine,
                chunk.content,
                chunk.hash,
                createdAtMs,
            );
        }
    }
}

/**
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 */
function migrateFtsToChunks(db) {
    const columns = tableColumns(db, 'copilot_io_index_files');
    if (!columns.has('dev')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN dev INTEGER');
    if (!columns.has('ino')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN ino INTEGER');

    backfillLegacyChunks(db);
    db.exec('DROP TABLE IF EXISTS copilot_io_index_fts');
    db.exec(CREATE_CHUNK_FTS_SQL);
    db.exec(`
        INSERT INTO copilot_io_index_fts(rowid, relative_path, content)
        SELECT chunks.id, files.relative_path, chunks.content
        FROM copilot_io_index_chunks AS chunks
        JOIN copilot_io_index_files AS files ON files.file_path = chunks.file_path
        ORDER BY chunks.id
    `);
}

const IO_INDEX_MIGRATIONS = [
    {
        version: 1,
        name: 'create_legacy_io_index',
        /** @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db */
        up(db) {
            db.exec(CREATE_LEGACY_SCHEMA_SQL);
        },
    },
    {
        version: 2,
        name: 'migrate_fts_to_chunks',
        up: migrateFtsToChunks,
    },
];

/**
 * Garante e migra o subschema do índice em uma transação.
 *
 * @param {import('#copilot/infra/internal/database/port').SqliteDatabasePort} db
 * @returns {number}
 */
export function ensureIoIndexSchema(db) {
    runSqliteTransaction(db, () => {
        db.exec(CREATE_SCHEMA_MIGRATIONS_SQL);
        recordLegacyBaseline(db);
        const applied = new Set(
            /** @type {{ version?: unknown }[]} */ (
                db.prepare('SELECT version FROM copilot_io_index_schema_migrations ORDER BY version').all()
            ).map((row) => Number(row.version)),
        );
        const insertMigration = db.prepare(`
            INSERT INTO copilot_io_index_schema_migrations(version, name, applied_at_ms)
            VALUES (?, ?, ?)
        `);
        for (const migration of IO_INDEX_MIGRATIONS) {
            if (applied.has(migration.version)) continue;
            migration.up(db);
            insertMigration.run(migration.version, migration.name, Date.now());
        }
    });

    const row = /** @type {{ version?: unknown } | undefined} */ (
        db.prepare('SELECT MAX(version) AS version FROM copilot_io_index_schema_migrations').get()
    );
    return Number(row?.version ?? 0);
}
