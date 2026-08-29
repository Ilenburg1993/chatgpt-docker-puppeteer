// @ts-check

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import { readModelGatewaySqliteFingerprint } from '#copilot/mcp/public/integrations/model-gateway/sqlite-fingerprint';
import { SqliteModelGatewayCatalogStore } from '#copilot/model-gateway';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createFixture() {
    const directory = mkdtempSync(join(tmpdir(), 'model-gateway-sqlite-fingerprint-'));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, 'fingerprint.sqlite');
    const owner = new Database(dbPath);
    const external = new Database(dbPath);
    owner.pragma('journal_mode = WAL');
    external.pragma('journal_mode = WAL');
    owner.exec('CREATE TABLE fingerprint_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    return { owner, external };
}

describe('Model Gateway SQLite operational fingerprint', () => {
    it('is stable without writes and changes after a write on the owner connection', () => {
        const fixture = createFixture();
        try {
            const db = adaptBetterSqliteDatabase(fixture.owner);
            const initial = readModelGatewaySqliteFingerprint(db);
            assert.equal(readModelGatewaySqliteFingerprint(db), initial);

            fixture.owner.prepare('INSERT INTO fingerprint_fixture(value) VALUES (?)').run('owner-write');
            const changed = readModelGatewaySqliteFingerprint(db);
            assert.notEqual(changed, initial);
            assert.match(changed, /"connectionTotalChanges":1/u);
        } finally {
            fixture.external.close();
            fixture.owner.close();
        }
    });

    it('changes after a commit from another SQLite connection through data_version', () => {
        const fixture = createFixture();
        try {
            const db = adaptBetterSqliteDatabase(fixture.owner);
            const initial = readModelGatewaySqliteFingerprint(db);
            fixture.external.prepare('INSERT INTO fingerprint_fixture(value) VALUES (?)').run('external-write');
            const changed = readModelGatewaySqliteFingerprint(db);
            assert.notEqual(changed, initial);

            const parsedInitial = JSON.parse(initial);
            const parsedChanged = JSON.parse(changed);
            assert.equal(parsedChanged.connectionTotalChanges, parsedInitial.connectionTotalChanges);
            assert.ok(parsedChanged.dataVersion > parsedInitial.dataVersion);
        } finally {
            fixture.external.close();
            fixture.owner.close();
        }
    });

    it('reopening an already-current Model Gateway store is a semantic no-op for cross-connection fingerprinting', () => {
        const directory = mkdtempSync(join(tmpdir(), 'model-gateway-current-schema-reopen-'));
        temporaryDirectories.push(directory);
        const dbPath = join(directory, 'current.sqlite');
        const bootstrap = new Database(dbPath);
        new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(bootstrap) });
        bootstrap
            .prepare(
                `INSERT INTO copilot_model_gateway_sdk_session_handoffs
                    (handoff_id, status, requested_at_ms, payload_json)
                 VALUES ('current-reopen-fixture', 'deferred', 1, '{}')`,
            )
            .run();
        bootstrap.close();

        const observer = new Database(dbPath);
        const observerPort = adaptBetterSqliteDatabase(observer);
        const initial = readModelGatewaySqliteFingerprint(observerPort);
        const reopened = new Database(dbPath);
        const totalChangesBefore = Number(reopened.prepare('SELECT total_changes() AS value').get().value ?? 0);
        try {
            new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(reopened) });
            const totalChangesAfter = Number(reopened.prepare('SELECT total_changes() AS value').get().value ?? 0);
            assert.equal(totalChangesAfter, totalChangesBefore);
            assert.equal(readModelGatewaySqliteFingerprint(observerPort), initial);
        } finally {
            reopened.close();
            observer.close();
        }
    });

    it('fails closed with an unstable token when the database capability is unavailable', () => {
        const first = readModelGatewaySqliteFingerprint(null);
        const second = readModelGatewaySqliteFingerprint(null);
        assert.match(first, /^unavailable:not-configured:/u);
        assert.match(second, /^unavailable:not-configured:/u);
    });
});
