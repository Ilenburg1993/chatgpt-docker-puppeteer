// @ts-check
/** SQLite L2 cache state machine: read/admit/batch/invalidate/prune over prepared storage. */

import { runSqliteTransactionOrDirect } from '#copilot/infra/internal/database/transaction/optional';
import { isBufferValue, toOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
import { performance } from 'node:perf_hooks';
import { createIoL2CacheMetrics } from './metrics.js';
import { normalizeL2Path, normalizeL2TimestampMs, resolveIoL2CachePolicy } from './policy.js';
import { createIoL2Statements } from './statements.js';

/** @typedef {import('./types.js').IoL2Kind} IoL2Kind */
/** @typedef {import('./types.js').IoL2CacheRow} IoL2CacheRow */

/**
 * @param {{
 *     db: import('#copilot/infra/internal/database/port').SqliteDatabasePort;
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

    const { ttlMs, maxEntries, minBytes, touchIntervalMs, setBatchWindowMs, setBatchMaxEntries, now } =
        resolveIoL2CachePolicy(options);

    const { stats, recordLatency, latencySnapshot } = createIoL2CacheMetrics();
    const {
        stmtGet,
        stmtTouch,
        stmtSet,
        stmtDeleteKey,
        stmtDeletePathPrefix,
        stmtDeleteExpired,
        stmtCount,
        stmtEvictOldest,
    } = createIoL2Statements(db);

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
        const countRow = /** @type {{ total?: unknown } | undefined} */ (stmtCount.get());
        const count = Number(countRow?.total ?? 0);
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
                normalizeL2TimestampMs(row.mtimeMs),
                normalizeL2TimestampMs(row.ctimeMs),
                row.metaJson || null,
                row.lastAccessedMs,
            );
        }
    }

    /** @param {IoL2CacheRow[]} rows */
    const persistRowsBatch = (rows) => runSqliteTransactionOrDirect(db, () => persistRows(rows));

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
                    mtimeMs: normalizeL2TimestampMs(input.mtimeMs),
                    ctimeMs: normalizeL2TimestampMs(input.ctimeMs),
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
            const snapshot = /** @type {{ total?: unknown; bytes?: unknown } | undefined} */ (stmtCount.get()) ?? {};
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
                latency: latencySnapshot(),
            };
        },
    };
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<typeof createIoL2SqliteCache>}
 */
export function isIoL2Cache(value) {
    if (!value || typeof value !== 'object') return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return (
        typeof candidate['get'] === 'function' &&
        typeof candidate['set'] === 'function' &&
        typeof candidate['invalidatePath'] === 'function'
    );
}
