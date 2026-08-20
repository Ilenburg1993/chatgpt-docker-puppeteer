// @ts-check

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isBufferValue, toOwnedBuffer } from './shared/buffer.js';
import { readEnvNonNegativeInt, readEnvPositiveInt } from './shared/env.js';

/**
 * @typedef {'bytes' | 'text' | 'json'} IoL2Kind
 */

/**
 * @typedef {{
 *     key: string;
 *     path: string;
 *     kind: IoL2Kind;
 *     payload: Buffer;
 *     encoding?: BufferEncoding | null;
 *     sizeBytes: number;
 *     createdAtMs: number;
 *     expiresAtMs: number;
 *     mtimeMs?: number | null;
 *     ctimeMs?: number | null;
 *     metaJson?: string | null;
 *     lastAccessedMs: number;
 * }} IoL2CacheRow
 */

const DEFAULT_TTL_MS = readEnvPositiveInt('IO_L2_CACHE_TTL_MS', 5 * 60 * 1000);
const DEFAULT_MAX_ENTRIES = readEnvPositiveInt('IO_L2_CACHE_MAX_ENTRIES', 100_000);
const DEFAULT_MIN_BYTES = readEnvNonNegativeInt('IO_L2_CACHE_MIN_BYTES', 0);
const MIN_TOUCH_INTERVAL_MS = 1_000;
const MAX_TOUCH_INTERVAL_MS = 30_000;
const DEFAULT_SET_BATCH_WINDOW_MS = 25;
const DEFAULT_SET_BATCH_MAX_ENTRIES = 256;

/**
 * @param {string} filePath
 */
function normalizeL2Path(filePath) {
    return path.resolve(filePath).replace(/\\/g, '/');
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeTimestampMs(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

/**
 * @param {{ exec: Function; prepare: Function }} db
 */
function ensureIoL2Schema(db) {
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
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_copilot_io_cache_l2_path ON copilot_io_cache_l2(file_path);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_copilot_io_cache_l2_expires ON copilot_io_cache_l2(expires_at_ms);
    `);
}

/**
 * @param {{
 *     db: { exec: Function; prepare: Function; transaction?: Function };
 *     ttlMs?: number;
 *     maxEntries?: number;
 *     minBytes?: number;
 *     touchIntervalMs?: number;
 *     setBatchWindowMs?: number;
 *     setBatchMaxEntries?: number;
 *     now?: () => number;
 * }} options
 */
export function createIoL2SqliteCache(options) {
    const db = options?.db;
    if (!db) {
        throw new Error('createIoL2SqliteCache requires { db }');
    }

    const ttlMs =
        Number.isFinite(options?.ttlMs) && Number(options?.ttlMs) > 0 ? Number(options?.ttlMs) : DEFAULT_TTL_MS;
    const maxEntries =
        Number.isFinite(options?.maxEntries) && Number(options?.maxEntries) > 0
            ? Number(options?.maxEntries)
            : DEFAULT_MAX_ENTRIES;
    const minBytes =
        Number.isFinite(options?.minBytes) && Number(options?.minBytes) >= 0
            ? Number(options?.minBytes)
            : DEFAULT_MIN_BYTES;
    const touchIntervalMs =
        Number.isFinite(options?.touchIntervalMs) && Number(options?.touchIntervalMs) >= 0
            ? Number(options?.touchIntervalMs)
            : Math.min(MAX_TOUCH_INTERVAL_MS, Math.max(MIN_TOUCH_INTERVAL_MS, Math.floor(ttlMs / 4)));
    const setBatchWindowMs =
        Number.isFinite(options?.setBatchWindowMs) && Number(options?.setBatchWindowMs) >= 0
            ? Number(options?.setBatchWindowMs)
            : DEFAULT_SET_BATCH_WINDOW_MS;
    const setBatchMaxEntries =
        Number.isInteger(options?.setBatchMaxEntries) && Number(options?.setBatchMaxEntries) > 0
            ? Number(options?.setBatchMaxEntries)
            : DEFAULT_SET_BATCH_MAX_ENTRIES;
    const now = typeof options?.now === 'function' ? options.now : Date.now;

    ensureIoL2Schema(db);

    const stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        invalidations: 0,
        errors: 0,
        touchWrites: 0,
        touchSkips: 0,
        admissionSkips: 0,
        batchFlushes: 0,
        batchedRows: 0,
        batchFailures: 0,
    };
    const latency = {
        get: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        set: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        flush: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        invalidate: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        prune: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
        clear: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
    };

    /**
     * @param {keyof typeof latency} operation
     * @param {number} startedAt
     */
    function recordLatency(operation, startedAt) {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const metric = latency[operation];
        metric.count += 1;
        metric.totalMs += durationMs;
        metric.lastMs = durationMs;
        metric.maxMs = Math.max(metric.maxMs, durationMs);
    }

    const stmtGet = db.prepare(`
        SELECT
            cache_key as key,
            file_path as path,
            cache_kind as kind,
            payload,
            encoding,
            size_bytes as sizeBytes,
            created_at_ms as createdAtMs,
            expires_at_ms as expiresAtMs,
            mtime_ms as mtimeMs,
            ctime_ms as ctimeMs,
            meta_json as metaJson,
            last_accessed_ms as lastAccessedMs
        FROM copilot_io_cache_l2
        WHERE cache_key = ?
        LIMIT 1
    `);

    const stmtTouch = db.prepare(`
        UPDATE copilot_io_cache_l2
        SET last_accessed_ms = ?
        WHERE cache_key = ?
    `);

    const stmtSet = db.prepare(`
        INSERT INTO copilot_io_cache_l2 (
            cache_key,
            file_path,
            cache_kind,
            payload,
            encoding,
            size_bytes,
            created_at_ms,
            expires_at_ms,
            mtime_ms,
            ctime_ms,
            meta_json,
            last_accessed_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            file_path = excluded.file_path,
            cache_kind = excluded.cache_kind,
            payload = excluded.payload,
            encoding = excluded.encoding,
            size_bytes = excluded.size_bytes,
            created_at_ms = excluded.created_at_ms,
            expires_at_ms = excluded.expires_at_ms,
            mtime_ms = excluded.mtime_ms,
            ctime_ms = excluded.ctime_ms,
            meta_json = excluded.meta_json,
            last_accessed_ms = excluded.last_accessed_ms
    `);

    const stmtDeleteKey = db.prepare('DELETE FROM copilot_io_cache_l2 WHERE cache_key = ?');
    const stmtDeletePathPrefix = db.prepare('DELETE FROM copilot_io_cache_l2 WHERE file_path = ? OR file_path LIKE ?');
    const stmtDeleteExpired = db.prepare('DELETE FROM copilot_io_cache_l2 WHERE expires_at_ms <= ?');
    const stmtCount = db.prepare(
        'SELECT COUNT(*) as total, COALESCE(SUM(size_bytes), 0) as bytes FROM copilot_io_cache_l2',
    );

    const stmtEvictOldest = db.prepare(`
        DELETE FROM copilot_io_cache_l2
        WHERE cache_key IN (
            SELECT cache_key
            FROM copilot_io_cache_l2
            ORDER BY last_accessed_ms ASC
            LIMIT ?
        )
    `);
    /** @type {Map<string, IoL2CacheRow>} */
    const pendingSets = new Map();
    /** @type {NodeJS.Timeout | null} */
    let setBatchTimer = null;

    /** @type {(value: unknown) => Buffer} */
    const toBuffer = (value) => {
        if (isBufferValue(value)) {
            return value;
        }
        if (typeof value === 'string') {
            return toOwnedBuffer(value);
        }
        return toOwnedBuffer(JSON.stringify(value ?? null));
    };

    function capSizeIfNeeded() {
        const count = Number(stmtCount.get()?.total || 0);
        if (count <= maxEntries) {
            return;
        }
        const overflow = count - maxEntries;
        stmtEvictOldest.run(overflow);
        stats.evictions += overflow;
    }

    /**
     * @param {IoL2CacheRow[]} rows
     */
    function persistRows(rows) {
        for (const row of rows) {
            stmtSet.run(
                row.key,
                row.path,
                row.kind,
                row.payload,
                row.encoding || null,
                row.sizeBytes,
                row.createdAtMs,
                row.expiresAtMs,
                normalizeTimestampMs(row.mtimeMs),
                normalizeTimestampMs(row.ctimeMs),
                row.metaJson || null,
                row.lastAccessedMs,
            );
        }
    }

    const persistRowsBatch = typeof db.transaction === 'function' ? db.transaction(persistRows) : persistRows;

    function cancelSetBatchTimer() {
        if (setBatchTimer) clearTimeout(setBatchTimer);
        setBatchTimer = null;
    }

    function flushPendingSets() {
        cancelSetBatchTimer();
        if (pendingSets.size === 0) return 0;
        const startedAt = performance.now();
        const rows = [...pendingSets.values()];
        pendingSets.clear();
        try {
            persistRowsBatch(rows);
            stats.batchFlushes += 1;
            stats.batchedRows += rows.length;
            capSizeIfNeeded();
            return rows.length;
        } catch {
            for (const row of rows) {
                if (!pendingSets.has(row.key)) pendingSets.set(row.key, row);
            }
            stats.errors += 1;
            stats.batchFailures += 1;
            return 0;
        } finally {
            recordLatency('flush', startedAt);
        }
    }

    function scheduleSetBatchFlush() {
        if (setBatchTimer) return;
        setBatchTimer = setTimeout(flushPendingSets, setBatchWindowMs);
        setBatchTimer.unref?.();
    }

    return {
        ttlMs,
        maxEntries,

        /** @param {string} key */
        get(key) {
            const startedAt = performance.now();
            try {
                const row = pendingSets.get(key) ?? /** @type {IoL2CacheRow | undefined} */ (stmtGet.get(key));
                if (!row) {
                    stats.misses += 1;
                    return null;
                }
                const nowMs = now();
                if (Number(row.expiresAtMs) <= nowMs) {
                    if (!pendingSets.delete(key)) stmtDeleteKey.run(key);
                    stats.misses += 1;
                    return null;
                }
                if (pendingSets.has(key)) {
                    stats.touchSkips += 1;
                } else if (nowMs - Number(row.lastAccessedMs) >= touchIntervalMs) {
                    stmtTouch.run(nowMs, key);
                    stats.touchWrites += 1;
                } else {
                    stats.touchSkips += 1;
                }
                stats.hits += 1;
                const payload = /** @type {unknown} */ (row.payload);
                return {
                    ...row,
                    payload:
                        isBufferValue(payload) || payload instanceof Uint8Array
                            ? toOwnedBuffer(payload)
                            : toOwnedBuffer(new Uint8Array()),
                };
            } catch {
                stats.errors += 1;
                return null;
            } finally {
                recordLatency('get', startedAt);
            }
        },

        /**
         * @param {{
         *     key: string;
         *     path: string;
         *     kind?: IoL2Kind;
         *     payload: Buffer | string | unknown;
         *     encoding?: BufferEncoding | null;
         *     sizeBytes?: number;
         *     ttlMs?: number;
         *     mtimeMs?: number | null;
         *     ctimeMs?: number | null;
         *     metaJson?: string | null;
         * }} input
         */
        set(input) {
            const startedAt = performance.now();
            try {
                const payload = toBuffer(input.payload);
                if (payload.byteLength < minBytes) {
                    stats.admissionSkips += 1;
                    return false;
                }
                const nowMs = now();
                const expiresAtMs =
                    nowMs + (Number.isFinite(input?.ttlMs) && Number(input?.ttlMs) > 0 ? Number(input?.ttlMs) : ttlMs);
                const normalizedPath = normalizeL2Path(input.path);
                pendingSets.set(input.key, {
                    key: input.key,
                    path: normalizedPath,
                    kind: input.kind || 'bytes',
                    payload,
                    encoding: input.encoding || null,
                    sizeBytes: Number.isFinite(input.sizeBytes) ? Number(input.sizeBytes) : payload.byteLength,
                    createdAtMs: nowMs,
                    expiresAtMs,
                    mtimeMs: normalizeTimestampMs(input.mtimeMs),
                    ctimeMs: normalizeTimestampMs(input.ctimeMs),
                    metaJson: input.metaJson || null,
                    lastAccessedMs: nowMs,
                });
                stats.sets += 1;
                if (pendingSets.size >= setBatchMaxEntries || setBatchWindowMs === 0) flushPendingSets();
                else scheduleSetBatchFlush();
                return true;
            } catch {
                stats.errors += 1;
                return false;
            } finally {
                recordLatency('set', startedAt);
            }
        },

        /** @param {string} filePath */
        invalidatePath(filePath) {
            const startedAt = performance.now();
            try {
                const normalized = normalizeL2Path(filePath);
                const subtreePrefix = `${normalized}/`;
                for (const [key, row] of pendingSets) {
                    if (row.path === normalized || row.path.startsWith(subtreePrefix)) pendingSets.delete(key);
                }
                stmtDeletePathPrefix.run(normalized, `${normalized}/%`);
                stats.invalidations += 1;
                return true;
            } catch {
                stats.errors += 1;
                return false;
            } finally {
                recordLatency('invalidate', startedAt);
            }
        },

        pruneExpired() {
            const startedAt = performance.now();
            try {
                const nowMs = now();
                let removed = 0;
                for (const [key, row] of pendingSets) {
                    if (row.expiresAtMs <= nowMs) {
                        pendingSets.delete(key);
                        removed += 1;
                    }
                }
                const result = stmtDeleteExpired.run(nowMs);
                removed += Number(result?.changes || 0);
                if (removed > 0) {
                    stats.evictions += removed;
                }
                capSizeIfNeeded();
                return removed;
            } catch {
                stats.errors += 1;
                return 0;
            } finally {
                recordLatency('prune', startedAt);
            }
        },

        clearAll() {
            const startedAt = performance.now();
            try {
                cancelSetBatchTimer();
                pendingSets.clear();
                db.exec('DELETE FROM copilot_io_cache_l2');
                return true;
            } catch {
                stats.errors += 1;
                return false;
            } finally {
                recordLatency('clear', startedAt);
            }
        },

        flushPending() {
            return flushPendingSets();
        },

        getStats() {
            flushPendingSets();
            const snapshot = stmtCount.get() || { total: 0, bytes: 0 };
            return {
                ...stats,
                size: Number(snapshot.total || 0),
                bytesStored: Number(snapshot.bytes || 0),
                ttlMs,
                maxEntries,
                minBytes,
                touchIntervalMs,
                setBatchWindowMs,
                setBatchMaxEntries,
                pendingSets: pendingSets.size,
                averageBatchSize:
                    stats.batchFlushes > 0 ? Number((stats.batchedRows / stats.batchFlushes).toFixed(3)) : 0,
                latency: Object.fromEntries(
                    Object.entries(latency).map(([operation, metric]) => [
                        operation,
                        {
                            count: metric.count,
                            totalMs: Number(metric.totalMs.toFixed(3)),
                            averageMs: metric.count > 0 ? Number((metric.totalMs / metric.count).toFixed(3)) : 0,
                            lastMs: Number(metric.lastMs.toFixed(3)),
                            maxMs: Number(metric.maxMs.toFixed(3)),
                        },
                    ]),
                ),
            };
        },
    };
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<typeof createIoL2SqliteCache>}
 */
export function isIoL2Cache(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof (/** @type {any} */ (value).get) === 'function' &&
        typeof (/** @type {any} */ (value).set) === 'function' &&
        typeof (/** @type {any} */ (value).invalidatePath) === 'function',
    );
}
