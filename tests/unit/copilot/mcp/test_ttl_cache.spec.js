// @ts-check
/** Tests for MCP TTL cache helper. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createTtlCache } from '#copilot/mcp/control-plane';

describe('MCP TTL cache', () => {
    it('returns cached values until their TTL expires', () => {
        const cache = createTtlCache({ name: 'test-cache', ttlMs: 1000, maxEntries: 4 });
        cache.set('a', 'first', { now: 100 });

        assert.equal(cache.get('a', { now: 500 }), 'first');
        assert.equal(cache.get('a', { now: 1200 }), null);
    });

    it('deduplicates in-flight loads for the same key', async () => {
        const cache = createTtlCache({ name: 'test-cache', ttlMs: 1000, maxEntries: 4 });
        let loads = 0;

        const [left, right] = await Promise.all([
            cache.getOrLoad('a', async () => {
                loads += 1;
                return 'loaded';
            }),
            cache.getOrLoad('a', async () => {
                loads += 1;
                return 'loaded-again';
            }),
        ]);

        assert.equal(left, 'loaded');
        assert.equal(right, 'loaded');
        assert.equal(loads, 1);
        assert.equal(cache.stats().inFlightHits, 1);
    });

    it('evicts oldest entries when maxEntries is exceeded', () => {
        const cache = createTtlCache({ name: 'test-cache', ttlMs: 1000, maxEntries: 2 });
        cache.set('a', 'a', { now: 100 });
        cache.set('b', 'b', { now: 100 });
        cache.set('c', 'c', { now: 100 });

        assert.equal(cache.get('a', { now: 200 }), null);
        assert.equal(cache.get('b', { now: 200 }), 'b');
        assert.equal(cache.get('c', { now: 200 }), 'c');
    });
});
