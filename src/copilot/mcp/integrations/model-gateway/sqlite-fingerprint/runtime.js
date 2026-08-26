// @ts-check
/**
 * Process-scoped SQLite fingerprint for Model Gateway readiness reuse.
 *
 * The integration owner receives its database from MCP process composition. Wire tools never discover application
 * infrastructure. An unavailable database deliberately disables cache reuse rather than risking stale readiness data.
 *
 * @module copilot/mcp/integrations/model-gateway/sqlite-fingerprint/runtime
 */

/**
 * Operational readiness needs only a conservative invalidation token, not a semantic digest of every Model Gateway
 * table. `data_version` changes when another connection commits; `total_changes()` changes for writes performed by this
 * connection. Together with schema `user_version` they provide an O(1) process-scoped invalidation identity without
 * scanning historical ledgers. False-positive invalidation is safe; false reuse is not.
 */
const MODEL_GATEWAY_SQLITE_FINGERPRINT_VERSION = 2;

/**
 * @param {() => import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} readDatabase
 */
export function createModelGatewaySqliteFingerprintCapability(readDatabase) {
    if (typeof readDatabase !== 'function') {
        throw new TypeError('Model Gateway SQLite fingerprint capability requires a database reader.');
    }
    return Object.freeze({ read: () => readModelGatewaySqliteFingerprint(readDatabase()) });
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} db
 */
export function readModelGatewaySqliteFingerprint(db) {
    if (!db) return `unavailable:not-configured:${Date.now()}`;
    try {
        const dataVersion = /** @type {{ data_version?: number | null } | undefined} */ (
            db.prepare('PRAGMA data_version').get()
        );
        const userVersion = /** @type {{ user_version?: number | null } | undefined} */ (
            db.prepare('PRAGMA user_version').get()
        );
        const changes = /** @type {{ total_changes?: number | null } | undefined} */ (
            db.prepare('SELECT total_changes() AS total_changes').get()
        );
        return JSON.stringify({
            version: MODEL_GATEWAY_SQLITE_FINGERPRINT_VERSION,
            dataVersion: Number(dataVersion?.data_version ?? -1),
            connectionTotalChanges: Number(changes?.total_changes ?? -1),
            userVersion: Number(userVersion?.user_version ?? -1),
        });
    } catch {
        return `unavailable:query-failed:${Date.now()}`;
    }
}
