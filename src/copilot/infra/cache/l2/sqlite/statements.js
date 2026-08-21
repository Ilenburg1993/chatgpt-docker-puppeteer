// @ts-check
/** Schema ownership and prepared statements for the SQLite L2 cache. */
/** @param {{ exec: Function; prepare: Function }} db */
export function ensureIoL2Schema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS copilot_io_cache_l2 (
            cache_key TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            cache_kind TEXT NOT NULL,
            payload BLOB NOT NULL,
            encoding TEXT,
            size_bytes INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            mtime_ms INTEGER,
            ctime_ms INTEGER,
            meta_json TEXT,
            last_accessed_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_copilot_io_cache_l2_path ON copilot_io_cache_l2(file_path);
        CREATE INDEX IF NOT EXISTS idx_copilot_io_cache_l2_expires ON copilot_io_cache_l2(expires_at_ms);
    `);
}
/** @param {{ exec: Function; prepare: Function }} db */
export function createIoL2Statements(db) {
    ensureIoL2Schema(db);
    return {
        stmtGet: db.prepare(`SELECT cache_key as key, file_path as path, cache_kind as kind, payload, encoding,
            size_bytes as sizeBytes, created_at_ms as createdAtMs, expires_at_ms as expiresAtMs,
            mtime_ms as mtimeMs, ctime_ms as ctimeMs, meta_json as metaJson, last_accessed_ms as lastAccessedMs
            FROM copilot_io_cache_l2 WHERE cache_key = ? LIMIT 1`),
        stmtTouch: db.prepare('UPDATE copilot_io_cache_l2 SET last_accessed_ms = ? WHERE cache_key = ?'),
        stmtSet: db.prepare(`INSERT INTO copilot_io_cache_l2 (
            cache_key,file_path,cache_kind,payload,encoding,size_bytes,created_at_ms,expires_at_ms,mtime_ms,ctime_ms,meta_json,last_accessed_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            file_path=excluded.file_path, cache_kind=excluded.cache_kind, payload=excluded.payload,
            encoding=excluded.encoding, size_bytes=excluded.size_bytes, created_at_ms=excluded.created_at_ms,
            expires_at_ms=excluded.expires_at_ms, mtime_ms=excluded.mtime_ms, ctime_ms=excluded.ctime_ms,
            meta_json=excluded.meta_json, last_accessed_ms=excluded.last_accessed_ms`),
        stmtDeleteKey: db.prepare('DELETE FROM copilot_io_cache_l2 WHERE cache_key = ?'),
        stmtDeletePathPrefix: db.prepare('DELETE FROM copilot_io_cache_l2 WHERE file_path = ? OR file_path LIKE ?'),
        stmtDeleteExpired: db.prepare('DELETE FROM copilot_io_cache_l2 WHERE expires_at_ms <= ?'),
        stmtCount: db.prepare(
            'SELECT COUNT(*) as total, COALESCE(SUM(size_bytes), 0) as bytes FROM copilot_io_cache_l2',
        ),
        stmtEvictOldest: db.prepare(`DELETE FROM copilot_io_cache_l2 WHERE cache_key IN (
            SELECT cache_key FROM copilot_io_cache_l2 ORDER BY last_accessed_ms ASC LIMIT ?)`),
    };
}
