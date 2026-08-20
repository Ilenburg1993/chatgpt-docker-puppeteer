// @ts-check
/**
 * Tests for bounded MCP Streamable HTTP event stores.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';

import {
    buildMcpEventId,
    createMcpInMemoryEventStore,
    createSqliteMcpEventStore,
    ensureMcpEventStoreSchema,
    parseMcpEventId,
} from '#copilot/mcp/control-plane';

describe('MCP HTTP event stores', () => {
    it('builds and parses stream-scoped event IDs', () => {
        const eventId = buildMcpEventId('stream-a', 3);
        const parsed = parseMcpEventId(eventId);
        assert.equal(parsed.streamId, 'stream-a');
        assert.equal(parsed.sequence, 3);
        assert.throws(() => parseMcpEventId('invalid'), /Invalid MCP event id/u);
    });

    it('stores bounded in-memory events and replays only later events from the same stream', async () => {
        let now = 1_000;
        const store = createMcpInMemoryEventStore({ now: () => now, maxEventsPerStream: 2, eventTtlMs: 10_000 });
        const first = await store.storeEvent('stream-a', { jsonrpc: '2.0', method: 'one' });
        await store.storeEvent('stream-a', { jsonrpc: '2.0', method: 'two' });
        await store.storeEvent('stream-a', { jsonrpc: '2.0', method: 'three' });
        await store.storeEvent('stream-b', { jsonrpc: '2.0', method: 'other' });

        /** @type {unknown[]} */
        const replayed = [];
        const streamId = await store.replayEventsAfter(first, { send: (message) => { replayed.push(message); } });
        assert.equal(streamId, 'stream-a');
        assert.deepEqual(
            replayed.map((message) => /** @type {{ method?: string }} */ (message).method),
            ['two', 'three'],
        );
        assert.equal(store.snapshot()['eventCount'], 3);

        now = 20_001;
        /** @type {unknown[]} */
        const expiredReplay = [];
        await store.replayEventsAfter(first, { send: (message) => { expiredReplay.push(message); } });
        assert.deepEqual(expiredReplay, []);
    });

    it('persists events in SQLite and replays them in sequence', async () => {
        const db = new Database(':memory:');
        try {
            ensureMcpEventStoreSchema(db);
            const store = createSqliteMcpEventStore({ db, eventTtlMs: 10_000, maxEventsPerStream: 10, now: () => 1_000 });
            const first = await store.storeEvent('stream-sql', { jsonrpc: '2.0', method: 'first' });
            await store.storeEvent('stream-sql', { jsonrpc: '2.0', method: 'second' });

            /** @type {unknown[]} */
            const replayed = [];
            const streamId = await store.replayEventsAfter(first, { send: (message) => { replayed.push(message); } });
            assert.equal(streamId, 'stream-sql');
            assert.deepEqual(replayed, [{ jsonrpc: '2.0', method: 'second' }]);
            assert.equal(store.snapshot()['durable'], true);
        } finally {
            db.close();
        }
    });
});
