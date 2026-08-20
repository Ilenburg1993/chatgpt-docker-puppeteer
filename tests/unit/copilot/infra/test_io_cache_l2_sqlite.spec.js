import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { createIoL2SqliteCache } from '#copilot/infra/io-cache-l2-sqlite';

function createDb() {
    return new Database(':memory:');
}

describe('createIoL2SqliteCache', () => {
    it('stores and retrieves a bytes payload', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000 });

        const ok = cache.set({
            key: 'k1',
            path: '/tmp/a.txt',
            kind: 'bytes',
            payload: Buffer.from('hello', 'utf8'),
        });

        expect(ok).toBe(true);
        const row = cache.get('k1');
        expect(row).toBeTruthy();
        expect(row?.kind).toBe('bytes');
        expect(row?.payload.toString('utf8')).toBe('hello');
    });

    it('preserva metaJson para fingerprints ricos', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000 });

        cache.set({
            key: 'k-meta',
            path: '/tmp/meta.txt',
            kind: 'text',
            payload: 'hello',
            metaJson: JSON.stringify({ contentHash: 'abc123', lineCount: 1 }),
        });

        const row = cache.get('k-meta');

        expect(row?.metaJson).toBe(JSON.stringify({ contentHash: 'abc123', lineCount: 1 }));
    });

    it('expires entries by ttl', () => {
        const db = createDb();
        let nowMs = 1000;
        const cache = createIoL2SqliteCache({ db, ttlMs: 100, now: () => nowMs });

        cache.set({ key: 'k1', path: '/tmp/a.txt', payload: 'x' });
        expect(cache.get('k1')).toBeTruthy();

        nowMs = 1200;
        expect(cache.get('k1')).toBeNull();
    });

    it('invalidates by path prefix', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000 });

        cache.set({ key: 'a', path: '/repo/src/a.ts', payload: 'A' });
        cache.set({ key: 'b', path: '/repo/src/b.ts', payload: 'B' });
        cache.set({ key: 'c', path: '/repo/docs/c.md', payload: 'C' });

        cache.invalidatePath('/repo/src');

        expect(cache.get('a')).toBeNull();
        expect(cache.get('b')).toBeNull();
        expect(cache.get('c')).toBeTruthy();
    });

    it('evicts oldest when maxEntries is exceeded', () => {
        const db = createDb();
        let nowMs = 1000;
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000, maxEntries: 2, now: () => nowMs });

        cache.set({ key: 'a', path: '/tmp/a', payload: 'a' });
        nowMs += 1;
        cache.set({ key: 'b', path: '/tmp/b', payload: 'b' });
        nowMs += 1;
        cache.set({ key: 'c', path: '/tmp/c', payload: 'c' });

        const stats = cache.getStats();
        expect(stats.size).toBe(2);
        expect(stats.evictions).toBeGreaterThan(0);
    });

    it('exposes bounded latency metrics per synchronous operation', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000 });

        cache.set({ key: 'a', path: '/tmp/a', payload: 'a' });
        cache.get('a');
        cache.invalidatePath('/tmp/a');
        cache.pruneExpired();
        cache.clearAll();

        expect(cache.getStats().latency).toMatchObject({
            get: { count: 1, totalMs: expect.any(Number), averageMs: expect.any(Number), maxMs: expect.any(Number) },
            set: { count: 1, totalMs: expect.any(Number), averageMs: expect.any(Number), maxMs: expect.any(Number) },
            invalidate: { count: 1 },
            prune: { count: 1 },
            clear: { count: 1 },
        });
    });

    it('throttles recency touches instead of writing SQLite on every hit', () => {
        const db = createDb();
        let nowMs = 1_000;
        const cache = createIoL2SqliteCache({
            db,
            ttlMs: 60_000,
            touchIntervalMs: 10_000,
            now: () => nowMs,
        });

        cache.set({ key: 'touch', path: '/tmp/touch', payload: 'value' });
        cache.flushPending();
        cache.get('touch');
        expect(
            db.prepare('SELECT last_accessed_ms as lastAccessedMs FROM copilot_io_cache_l2 WHERE cache_key = ?').get(
                'touch',
            ),
        ).toMatchObject({ lastAccessedMs: 1_000 });

        nowMs = 11_001;
        cache.get('touch');

        expect(
            db.prepare('SELECT last_accessed_ms as lastAccessedMs FROM copilot_io_cache_l2 WHERE cache_key = ?').get(
                'touch',
            ),
        ).toMatchObject({ lastAccessedMs: 11_001 });
        expect(cache.getStats()).toMatchObject({
            hits: 2,
            touchWrites: 1,
            touchSkips: 1,
            touchIntervalMs: 10_000,
        });
    });

    it('skips payloads below the configured admission threshold', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({ db, ttlMs: 60_000, minBytes: 4 });

        expect(cache.set({ key: 'small', path: '/tmp/small', payload: 'abc' })).toBe(false);
        expect(cache.set({ key: 'large', path: '/tmp/large', payload: 'abcd' })).toBe(true);

        expect(cache.get('small')).toBeNull();
        expect(cache.get('large')?.payload.toString('utf8')).toBe('abcd');
        expect(cache.getStats()).toMatchObject({
            size: 1,
            sets: 1,
            admissionSkips: 1,
            minBytes: 4,
        });
    });

    it('batches pending sets while preserving immediate reads and explicit flush', () => {
        const db = createDb();
        const cache = createIoL2SqliteCache({
            db,
            ttlMs: 60_000,
            setBatchWindowMs: 10_000,
            setBatchMaxEntries: 100,
        });

        cache.set({ key: 'a', path: '/tmp/a', payload: 'a' });
        cache.set({ key: 'b', path: '/tmp/b', payload: 'b' });
        cache.set({ key: 'c', path: '/tmp/c', payload: 'c' });

        expect(db.prepare('SELECT COUNT(*) as total FROM copilot_io_cache_l2').get()).toMatchObject({ total: 0 });
        expect(cache.get('b')?.payload.toString('utf8')).toBe('b');
        expect(cache.flushPending()).toBe(3);
        expect(db.prepare('SELECT COUNT(*) as total FROM copilot_io_cache_l2').get()).toMatchObject({ total: 3 });
        expect(cache.getStats()).toMatchObject({
            sets: 3,
            batchFlushes: 1,
            batchedRows: 3,
            batchFailures: 0,
            pendingSets: 0,
            averageBatchSize: 3,
            setBatchWindowMs: 10_000,
            setBatchMaxEntries: 100,
        });
        cache.clearAll();
    });

    it('keeps pending rows readable when a batch transaction fails', () => {
        const db = createDb();
        const transaction = db.transaction.bind(db);
        let shouldFail = true;
        db.transaction = (handler) => {
            const persist = transaction(handler);
            return new Proxy(persist, {
                apply(target, thisArg, args) {
                    if (shouldFail) throw new Error('controlled batch failure');
                    return Reflect.apply(target, thisArg, args);
                },
            });
        };
        const cache = createIoL2SqliteCache({
            db,
            ttlMs: 60_000,
            setBatchWindowMs: 10_000,
        });

        cache.set({ key: 'retry', path: '/tmp/retry', payload: 'value' });
        expect(cache.flushPending()).toBe(0);
        expect(cache.get('retry')?.payload.toString('utf8')).toBe('value');
        expect(cache.getStats()).toMatchObject({
            errors: 2,
            batchFailures: 2,
            pendingSets: 1,
        });

        shouldFail = false;
        expect(cache.flushPending()).toBe(1);
        expect(cache.getStats()).toMatchObject({
            batchFlushes: 1,
            batchedRows: 1,
            pendingSets: 0,
        });
        cache.clearAll();
    });
});
