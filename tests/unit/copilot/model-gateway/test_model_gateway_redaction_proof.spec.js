// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import { SqliteModelGatewayCatalogStore } from '#copilot/model-gateway';

/** @returns {Promise<import('better-sqlite3').default>} */
async function memoryDatabase() {
    const { default: Database } = await import('better-sqlite3');
    return new Database(':memory:');
}

/** @param {import('better-sqlite3').default} db @param {number} index @param {string} message */
function insertHealthPayload(db, index, message) {
    db.prepare(
        `
            INSERT INTO copilot_model_gateway_health_observations
                (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                 classified_failure, observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, 'fixture-provider', ?, 'default', 'runtime', 'ok', NULL, ?, NULL, ?)
        `,
    ).run(`obs-${index}`, `model-${index}`, index + 1, JSON.stringify({ message }));
}

describe('Model Gateway redaction proof surface identity', () => {
    it('binds the audit and cheap fingerprint to exactly the same bounded SQLite payload surface', async () => {
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            for (let index = 0; index < 26; index += 1) insertHealthPayload(db, index, `safe-${index}`);

            const initial = await store.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: 25 });
            assert.equal(initial.mode, 'bounded');
            assert.equal(initial.maxRowsPerTable, 25);
            assert.equal(initial.rowCount >= 25, true);

            db.prepare(
                `UPDATE copilot_model_gateway_health_observations SET payload_json = ? WHERE observation_key = 'obs-0'`,
            ).run(JSON.stringify({ message: 'outside-bounded-window' }));
            const outsideMutation = await store.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: 25 });
            assert.equal(outsideMutation.fingerprint, initial.fingerprint);

            const secret = 'unit-test-super-secret-1234567890';
            db.prepare(
                `UPDATE copilot_model_gateway_health_observations SET payload_json = ? WHERE observation_key = 'obs-25'`,
            ).run(JSON.stringify({ message: secret }));
            const insideMutation = await store.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: 25 });
            assert.notEqual(insideMutation.fingerprint, initial.fingerprint);

            const audit = await store.auditStoredPayloadRedaction({
                maxRowsPerTable: 25,
                additionalSecrets: [secret],
            });
            assert.equal(audit.fingerprint, insideMutation.fingerprint);
            assert.equal(audit.maxRowsPerTable, insideMutation.maxRowsPerTable);
            assert.equal(audit.tableCount, insideMutation.tableCount);
            assert.equal(audit.rowCount, insideMutation.rowCount);
            assert.equal(audit.payloadBytes, insideMutation.payloadBytes);
            assert.equal(audit.ok, false);
            assert.equal(audit.leakCount > 0, true);
        } finally {
            db.close();
        }
    });

    it('changes the fingerprint when requested coverage changes even with identical stored content', async () => {
        const db = await memoryDatabase();
        try {
            const store = new SqliteModelGatewayCatalogStore({ db: adaptBetterSqliteDatabase(db) });
            for (let index = 0; index < 30; index += 1) insertHealthPayload(db, index, `safe-${index}`);

            const bounded25 = await store.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: 25 });
            const bounded30 = await store.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: 30 });
            assert.notEqual(bounded25.fingerprint, bounded30.fingerprint);
            assert.notEqual(bounded25.rowCount, bounded30.rowCount);
        } finally {
            db.close();
        }
    });
});
