// @ts-check
/**
 * Persistent, hash-only OAuth replay protection shared by the MCP resource server and built-in issuer.
 *
 * @module copilot/mcp/auth/persistence/replay-store
 */

import { runSqliteTransaction } from '#copilot/infra/public/database/sqlite';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_ENTRIES_PER_NAMESPACE = 10_000;

export const OAUTH_REPLAY_NAMESPACES = /** @type {const} */ ({
    issuerDpop: 'issuer-dpop',
    privateKeyJwt: 'private-key-jwt',
    resourceDpop: 'resource-dpop',
});

/**
 * @typedef {{
 *     replay: boolean;
 *     stored: boolean;
 *     available: boolean;
 *     pruned: number;
 *     evicted: number;
 *     error?: string;
 * }} OAuthReplayRememberResult
 */

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {{ maxEntriesPerNamespace?: number; now?: () => number }} [options]
 */
export function createOAuthReplayStore(db, options = {}) {
    if (!db) throw new Error('createOAuthReplayStore requires a database');
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const maxEntriesPerNamespace = normalizeMaxEntries(options.maxEntriesPerNamespace);

    db.exec(`
        CREATE TABLE IF NOT EXISTS copilot_mcp_oauth_replay (
            namespace TEXT NOT NULL,
            replay_key_hash TEXT NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (namespace, replay_key_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_copilot_mcp_oauth_replay_expiry
            ON copilot_mcp_oauth_replay(namespace, expires_at_ms);
    `);

    const deleteExpired = db.prepare(`
        DELETE FROM copilot_mcp_oauth_replay
        WHERE namespace = ? AND expires_at_ms <= ?
    `);
    const insertReplay = db.prepare(`
        INSERT OR IGNORE INTO copilot_mcp_oauth_replay (
            namespace,
            replay_key_hash,
            expires_at_ms,
            created_at_ms
        ) VALUES (?, ?, ?, ?)
    `);
    const countNamespace = db.prepare(`
        SELECT COUNT(*) AS total
        FROM copilot_mcp_oauth_replay
        WHERE namespace = ?
    `);
    const evictOldest = db.prepare(`
        DELETE FROM copilot_mcp_oauth_replay
        WHERE rowid IN (
            SELECT rowid
            FROM copilot_mcp_oauth_replay
            WHERE namespace = ?
            ORDER BY expires_at_ms ASC, created_at_ms ASC
            LIMIT ?
        )
    `);
    const countAll = db.prepare(`
        SELECT COUNT(*) AS total
        FROM copilot_mcp_oauth_replay
    `);

    /**
     * @param {string} namespace
     * @param {string} replayKeyHash
     * @param {number} expiresAtMs
     * @param {number} nowMs
     */
    const rememberTransaction = (namespace, replayKeyHash, expiresAtMs, nowMs) =>
        runSqliteTransaction(db, () => {
            const pruned = Number(deleteExpired.run(namespace, nowMs).changes ?? 0);
            const stored = Number(insertReplay.run(namespace, replayKeyHash, expiresAtMs, nowMs).changes ?? 0) === 1;
            let evicted = 0;
            if (stored) {
                const row = /** @type {{ total?: number } | undefined} */ (countNamespace.get(namespace));
                const excess = Math.max(0, Number(row?.total ?? 0) - maxEntriesPerNamespace);
                if (excess > 0) evicted = Number(evictOldest.run(namespace, excess).changes ?? 0);
            }
            return { replay: !stored, stored, available: true, pruned, evicted };
        });

    return {
        /**
         * @param {string} namespace
         * @param {string} replayKey
         * @param {number} expiresAtMs
         * @returns {OAuthReplayRememberResult}
         */
        remember(namespace, replayKey, expiresAtMs) {
            const normalizedNamespace = normalizeNamespace(namespace);
            const nowMs = now();
            const requestedExpiry = Number(expiresAtMs);
            const normalizedExpiry = Number.isFinite(requestedExpiry)
                ? Math.max(nowMs + 1, Math.round(requestedExpiry))
                : nowMs + 5 * 60 * 1000;
            const replayKeyHash = hashReplayKey(normalizedNamespace, replayKey);
            return rememberTransaction(normalizedNamespace, replayKeyHash, normalizedExpiry, nowMs);
        },

        /**
         * @returns {{ available: true; entries: number; maxEntriesPerNamespace: number }}
         */
        status() {
            const row = /** @type {{ total?: number } | undefined} */ (countAll.get());
            return {
                available: true,
                entries: Number(row?.total ?? 0),
                maxEntriesPerNamespace,
            };
        },
    };
}

/**
 * Build a process-generation replay capability over a lazy database reader. The capability can exist before SQLite is
 * bootstrapped; once a concrete database generation becomes available, the store is materialized locally and reused
 * only while that database identity remains current.
 *
 * @param {() => import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} readDatabase
 * @param {import('./config.js').OAuthReplayStoreConfig} [config]
 */
export function createOAuthReplayCapability(
    readDatabase,
    config = { maxEntriesPerNamespace: DEFAULT_MAX_ENTRIES_PER_NAMESPACE },
) {
    if (typeof readDatabase !== 'function') throw new TypeError('OAuth replay capability requires a database reader.');
    const maxEntriesPerNamespace = normalizeMaxEntries(config.maxEntriesPerNamespace);
    /** @type {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} */
    let boundDatabase = null;
    /** @type {ReturnType<typeof createOAuthReplayStore> | null} */
    let store = null;
    /** @type {string | null} */
    let lastError = null;

    const requireStore = () => {
        const database = readDatabase();
        if (!database) throw new Error('Persistent OAuth replay database capability is unavailable.');
        if (database !== boundDatabase || !store) {
            boundDatabase = database;
            store = createOAuthReplayStore(database, { maxEntriesPerNamespace });
        }
        return store;
    };

    return Object.freeze({
        /**
         * @param {string} namespace
         * @param {string} replayKey
         * @param {number} expiresAtMs
         * @returns {OAuthReplayRememberResult}
         */
        remember(namespace, replayKey, expiresAtMs) {
            try {
                const result = requireStore().remember(namespace, replayKey, expiresAtMs);
                lastError = null;
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                return { replay: false, stored: false, available: false, pruned: 0, evicted: 0, error: lastError };
            }
        },
        /** @returns {{ available: boolean; entries: number | null; maxEntriesPerNamespace: number; error: string | null }} */
        status() {
            try {
                const status = requireStore().status();
                lastError = null;
                return { ...status, error: null };
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                return { available: false, entries: null, maxEntriesPerNamespace, error: lastError };
            }
        },
    });
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {import('./config.js').OAuthReplayStoreConfig} [config]
 */
export function createConfiguredOAuthReplayStore(
    db,
    config = { maxEntriesPerNamespace: DEFAULT_MAX_ENTRIES_PER_NAMESPACE },
) {
    return createOAuthReplayStore(db, { maxEntriesPerNamespace: config.maxEntriesPerNamespace });
}

/**
 * @param {unknown} value
 */
function normalizeMaxEntries(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 100) return DEFAULT_MAX_ENTRIES_PER_NAMESPACE;
    return Math.min(100_000, Math.round(numeric));
}

/**
 * @param {string} namespace
 */
function normalizeNamespace(namespace) {
    const normalized = String(namespace ?? '').trim();
    if (!/^[a-z][a-z0-9-]{1,63}$/u.test(normalized)) throw new Error('Invalid OAuth replay namespace');
    return normalized;
}

/**
 * @param {string} namespace
 * @param {string} replayKey
 */
function hashReplayKey(namespace, replayKey) {
    const normalizedKey = String(replayKey ?? '');
    if (!normalizedKey || normalizedKey.length > 4096) throw new Error('Invalid OAuth replay key');
    return createHash('sha256').update(namespace).update('\0').update(normalizedKey).digest('hex');
}
