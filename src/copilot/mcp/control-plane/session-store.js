// @ts-check
/**
 * SQLite-backed metadata store for MCP Streamable HTTP sessions.
 *
 * This store persists only redacted/session-safe metadata. It never persists raw bearer tokens or raw Mcp-Session-Id
 * values. Live transport/server objects remain owned by the process-local session runtime.
 *
 * @module copilot/mcp/control-plane/session-store
 */

import { getCopilotDb } from '#copilot/db';

/**
 * @typedef {'active' | 'terminated' | 'expired'} McpHttpStoredSessionStatus
 * @typedef {'client_delete' | 'ttl_expired' | 'server_shutdown' | 'auth_mismatch' | 'runtime_error' | 'replaced'} McpHttpSessionTerminateReason
 *
 * @typedef {object} McpHttpStoredSessionRecord
 * @property {string} sessionIdHash
 * @property {string} sessionIdPreview
 * @property {string} protocolVersion
 * @property {number} createdAtMs
 * @property {number} lastSeenAtMs
 * @property {number} expiresAtMs
 * @property {McpHttpStoredSessionStatus} status
 * @property {number | null} terminatedAtMs
 * @property {McpHttpSessionTerminateReason | null} terminateReason
 * @property {Record<string, unknown>} authBinding
 * @property {Record<string, unknown>} transport
 *
 * @typedef {{
 *   recordSession(record: McpHttpStoredSessionRecord): void;
 *   touchSession(sessionIdHash: string, lastSeenAtMs: number, expiresAtMs: number): void;
 *   terminateSession(sessionIdHash: string, terminatedAtMs: number, reason: McpHttpSessionTerminateReason): void;
 *   readSession(sessionIdHash: string): McpHttpStoredSessionRecord | null;
 *   sweepExpired(nowMs: number): number;
 * }} McpHttpSessionStore
 */

/**
 * @returns {McpHttpSessionStore}
 */
export function createSqliteMcpHttpSessionStore() {
    return createSqliteMcpHttpSessionStoreForDb(getCopilotDb());
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {McpHttpSessionStore}
 */
export function createSqliteMcpHttpSessionStoreForDb(db) {
    ensureMcpHttpSessionStoreSchema(db);
    return {
        recordSession(record) {
            db.prepare(
                `INSERT INTO copilot_mcp_http_sessions (
                    session_id_hash,
                    session_id_preview,
                    protocol_version,
                    created_at_ms,
                    last_seen_at_ms,
                    expires_at_ms,
                    status,
                    terminated_at_ms,
                    terminate_reason,
                    auth_binding_json,
                    transport_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id_hash) DO UPDATE SET
                    session_id_preview = excluded.session_id_preview,
                    protocol_version = excluded.protocol_version,
                    created_at_ms = excluded.created_at_ms,
                    last_seen_at_ms = excluded.last_seen_at_ms,
                    expires_at_ms = excluded.expires_at_ms,
                    status = excluded.status,
                    terminated_at_ms = excluded.terminated_at_ms,
                    terminate_reason = excluded.terminate_reason,
                    auth_binding_json = excluded.auth_binding_json,
                    transport_json = excluded.transport_json`,
            ).run(
                record.sessionIdHash,
                record.sessionIdPreview,
                record.protocolVersion,
                record.createdAtMs,
                record.lastSeenAtMs,
                record.expiresAtMs,
                record.status,
                record.terminatedAtMs,
                record.terminateReason,
                stableJson(record.authBinding),
                stableJson(record.transport),
            );
        },
        touchSession(sessionIdHash, lastSeenAtMs, expiresAtMs) {
            db.prepare(
                `UPDATE copilot_mcp_http_sessions
                 SET last_seen_at_ms = ?, expires_at_ms = ?
                 WHERE session_id_hash = ? AND status = 'active'`,
            ).run(lastSeenAtMs, expiresAtMs, sessionIdHash);
        },
        terminateSession(sessionIdHash, terminatedAtMs, reason) {
            db.prepare(
                `UPDATE copilot_mcp_http_sessions
                 SET status = CASE WHEN ? = 'ttl_expired' THEN 'expired' ELSE 'terminated' END,
                     terminated_at_ms = ?,
                     terminate_reason = ?
                 WHERE session_id_hash = ?`,
            ).run(reason, terminatedAtMs, reason, sessionIdHash);
        },
        readSession(sessionIdHash) {
            const row = db.prepare('SELECT * FROM copilot_mcp_http_sessions WHERE session_id_hash = ?').get(sessionIdHash);
            return row ? rowToStoredSession(/** @type {Record<string, unknown>} */ (row)) : null;
        },
        sweepExpired(nowMs) {
            const result = db.prepare(
                `UPDATE copilot_mcp_http_sessions
                 SET status = 'expired', terminated_at_ms = ?, terminate_reason = 'ttl_expired'
                 WHERE status = 'active' AND expires_at_ms <= ?`,
            ).run(nowMs, nowMs);
            return Number(result.changes ?? 0);
        },
    };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function ensureMcpHttpSessionStoreSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS copilot_mcp_http_sessions (
            session_id_hash    TEXT PRIMARY KEY,
            session_id_preview TEXT NOT NULL,
            protocol_version   TEXT NOT NULL,
            created_at_ms      INTEGER NOT NULL,
            last_seen_at_ms    INTEGER NOT NULL,
            expires_at_ms      INTEGER NOT NULL,
            status             TEXT NOT NULL CHECK(status IN ('active', 'terminated', 'expired')),
            terminated_at_ms   INTEGER,
            terminate_reason   TEXT,
            auth_binding_json  TEXT NOT NULL,
            transport_json     TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_mcp_http_sessions_status
            ON copilot_mcp_http_sessions(status, expires_at_ms);
        CREATE INDEX IF NOT EXISTS idx_mcp_http_sessions_last_seen
            ON copilot_mcp_http_sessions(last_seen_at_ms DESC);
    `);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {McpHttpStoredSessionRecord}
 */
function rowToStoredSession(row) {
    return {
        sessionIdHash: String(row['session_id_hash'] ?? ''),
        sessionIdPreview: String(row['session_id_preview'] ?? ''),
        protocolVersion: String(row['protocol_version'] ?? ''),
        createdAtMs: Number(row['created_at_ms'] ?? 0),
        lastSeenAtMs: Number(row['last_seen_at_ms'] ?? 0),
        expiresAtMs: Number(row['expires_at_ms'] ?? 0),
        status: /** @type {McpHttpStoredSessionStatus} */ (String(row['status'] ?? 'terminated')),
        terminatedAtMs: row['terminated_at_ms'] === null ? null : Number(row['terminated_at_ms'] ?? 0),
        terminateReason:
            row['terminate_reason'] === null
                ? null
                : /** @type {McpHttpSessionTerminateReason} */ (String(row['terminate_reason'] ?? 'runtime_error')),
        authBinding: parseJsonObject(row['auth_binding_json']),
        transport: parseJsonObject(row['transport_json']),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(String(value ?? '{}'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : {};
    } catch {
        return {};
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
    return JSON.stringify(sortForStableJson(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortForStableJson(value) {
    if (Array.isArray(value)) return value.map(sortForStableJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(/** @type {Record<string, unknown>} */ (value))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, sortForStableJson(nested)]),
    );
}
