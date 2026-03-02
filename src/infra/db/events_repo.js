// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { getDb } from './sqlite.js';

/**
 * @typedef {Object} RecordEventParams
 * @property {string} entityType - The type of entity (e.g., 'task', 'queue')
 * @property {string} entityId - The entity ID
 * @property {number} [tsMs] - Timestamp in ms (defaults to Date.now())
 * @property {string} [actorType='system'] - Actor type
 * @property {any} [actorId=null] - Actor ID
 * @property {string} eventType - Event type
 * @property {any} [payload={}] - Event payload (JSON-serializable)
 * @property {string|null} [dedupKey=null] - Deduplication key
 */

/**
 * Records an event in the database.
 * Returns true if inserted, false if duplicate (INSERT OR IGNORE).
 *
 * @param {RecordEventParams} params
 * @returns {boolean} True if inserted, false if duplicate
 */
function recordEvent(params) {
    const {
        entityType,
        entityId,
        tsMs,
        actorType = 'system',
        actorId = null,
        eventType,
        payload = {},
        dedupKey = null,
    } = /** @type {RecordEventParams} */ (params ?? {});

    if (!entityType) throw new TypeError('recordEvent: "entityType" is required');
    if (!entityId) throw new TypeError('recordEvent: "entityId" is required');
    if (!eventType) throw new TypeError('recordEvent: "eventType" is required');

    const db = getDb();
    const now = Date.now();

    const ts_ms = Number.isFinite(tsMs) ? tsMs : now;

    let payload_json;
    try {
        payload_json = JSON.stringify(payload ?? {});
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TypeError(`recordEvent: payload is not JSON-serializable: ${msg}`); // eslint-disable-line preserve-caught-error
    }

    const res = db
        .prepare(
            `
      INSERT OR IGNORE INTO events
        (entity_type, entity_id, ts_ms, actor_type, actor_id, event_type, payload_json, dedup_key)
      VALUES
        (@entity_type, @entity_id, @ts_ms, @actor_type, @actor_id, @event_type, @payload_json, @dedup_key)
      `
        )
        .run({
            entity_type: String(entityType),
            entity_id: String(entityId),
            ts_ms,
            actor_type: String(actorType),
            actor_id: actorId,
            event_type: String(eventType),
            payload_json,
            dedup_key: dedupKey == null ? null : String(dedupKey),
        });

    return Boolean(res?.changes);
}

/**
 * Prune events older than the specified retention period.
 * Keeps events table bounded to prevent unbounded disk growth.
 *
 * @param {object} [options={}]
 * @param {number} [options.retentionMs=604800000] - Retention period in ms (default: 7 days)
 * @param {number} [options.maxRows=100000] - Max rows to keep regardless of age
 * @returns {{ deleted: number }} Number of rows deleted
 */
function pruneEvents(options = {}) {
    const { retentionMs = 7 * 24 * 60 * 60 * 1000, maxRows = 100000 } = options;
    const db = getDb();
    const cutoff = Date.now() - retentionMs;

    // Phase 1: Delete events older than retention period
    const res1 = db.prepare('DELETE FROM events WHERE ts_ms < @cutoff').run({ cutoff });

    // Phase 2: If still over maxRows, delete oldest events beyond limit
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM events').get();
    const count = /** @type {{ cnt: number }} */ (countRow)?.cnt ?? 0;
    let res2Changes = 0;
    if (count > maxRows) {
        const excess = count - maxRows;
        const res2 = db
            .prepare('DELETE FROM events WHERE rowid IN (SELECT rowid FROM events ORDER BY ts_ms ASC LIMIT @excess)')
            .run({ excess });
        res2Changes = res2?.changes ?? 0;
    }

    return { deleted: (res1?.changes ?? 0) + res2Changes };
}

export { recordEvent, pruneEvents };
