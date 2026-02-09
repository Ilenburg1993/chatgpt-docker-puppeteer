// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { getDb } from './sqlite.js';

function recordEvent({
    entityType,
    entityId,
    tsMs,
    actorType = 'system',
    actorId = null,
    eventType,
    payload = {},
    dedupKey = null,
} = {}) {
    const db = getDb();
    const now = Date.now();
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
            entity_type: entityType,
            entity_id: entityId,
            ts_ms: Number.isFinite(Number(tsMs)) ? Number(tsMs) : now,
            actor_type: actorType,
            actor_id: actorId,
            event_type: eventType,
            payload_json: JSON.stringify(payload ?? {}),
            dedup_key: dedupKey,
        });

    return Boolean(res.changes);
}

export { recordEvent };

