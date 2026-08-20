// @ts-check

import { createOAuthReplayStore, OAUTH_REPLAY_NAMESPACES } from '#copilot/mcp/control-plane';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

/** @type {import('better-sqlite3').Database[]} */
const databases = [];

afterEach(() => {
    for (const db of databases.splice(0)) db.close();
});

describe('persistent OAuth replay store', () => {
    it('rejects a replay across independent store instances and stores only a hash', () => {
        const db = new Database(':memory:');
        databases.push(db);
        const first = createOAuthReplayStore(db, { now: () => 1_000 });
        const second = createOAuthReplayStore(db, { now: () => 1_001 });
        const rawKey = 'client-id:highly-sensitive-jti';

        assert.deepEqual(first.remember(OAUTH_REPLAY_NAMESPACES.privateKeyJwt, rawKey, 5_000), {
            replay: false,
            stored: true,
            available: true,
            pruned: 0,
            evicted: 0,
        });
        assert.equal(second.remember(OAUTH_REPLAY_NAMESPACES.privateKeyJwt, rawKey, 5_000).replay, true);

        const row = /** @type {{ namespace: string; replay_key_hash: string }} */ (
            db.prepare('SELECT namespace, replay_key_hash FROM copilot_mcp_oauth_replay').get()
        );
        assert.equal(row.namespace, OAUTH_REPLAY_NAMESPACES.privateKeyJwt);
        assert.match(row.replay_key_hash, /^[a-f0-9]{64}$/u);
        assert.equal(row.replay_key_hash.includes('sensitive'), false);
    });

    it('prunes expired entries before accepting the same replay key again', () => {
        const db = new Database(':memory:');
        databases.push(db);
        let nowMs = 1_000;
        const store = createOAuthReplayStore(db, { now: () => nowMs });

        assert.equal(store.remember(OAUTH_REPLAY_NAMESPACES.resourceDpop, 'jkt:jti', 1_500).stored, true);
        nowMs = 1_501;
        const renewed = store.remember(OAUTH_REPLAY_NAMESPACES.resourceDpop, 'jkt:jti', 2_000);
        assert.equal(renewed.replay, false);
        assert.equal(renewed.pruned, 1);
    });

    it('bounds each namespace independently', () => {
        const db = new Database(':memory:');
        databases.push(db);
        let nowMs = 1_000;
        const store = createOAuthReplayStore(db, { now: () => nowMs, maxEntriesPerNamespace: 100 });

        for (let index = 0; index < 105; index += 1) {
            nowMs += 1;
            store.remember(OAUTH_REPLAY_NAMESPACES.issuerDpop, `key-${index}`, 10_000 + index);
        }

        assert.equal(store.status().entries, 100);
    });
});
