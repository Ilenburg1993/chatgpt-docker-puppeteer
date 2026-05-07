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
});
