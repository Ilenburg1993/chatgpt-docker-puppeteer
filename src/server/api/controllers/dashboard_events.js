// @ts-check
import express from 'express';
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import { ok, fail, encodeCursor, decodeCursor } from '../utils/api_envelope.js';

/** Constante/valor exportado: default. */
const router = express.Router();

function _asInt(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _safeParsePayloadJson(raw) {
    try {
        return raw ? JSON.parse(String(raw)) : {};
    } catch (err) {
        log.debug({ error: err?.message }, '[dashboard_events] _safeParsePayloadJson fallback to raw');
        return raw ?? {};
    }
}

/**
 * GET /api/dashboard/events
 * Global SSOT audit feed (cursor-based by id desc).
 *
 * Query:
 *  - entity_type?: string
 *  - entity_id?: string
 *  - event_type?: string
 *  - limit?: number (default 200, max 500)
 *  - cursor?: base64 json { sort:'id_desc', id:number }
 */
router.get('/events', async (req, res) => {
    try {
        const db = getDb();
        const limit = Math.max(1, Math.min(_asInt(req.query.limit, 200), 500));
        const cursor = decodeCursor(req.query.cursor);

        const entityType = req.query.entity_type ? String(req.query.entity_type).trim() : null;
        const entityId = req.query.entity_id ? String(req.query.entity_id).trim() : null;
        const eventType = req.query.event_type ? String(req.query.event_type).trim() : null;

        const where = [];
        /** @type {Record<string, any>} */
        const params = { limit: limit + 1 };

        if (entityType) {
            where.push('entity_type = @entity_type');
            params.entity_type = entityType;
        }
        if (entityId) {
            where.push('entity_id = @entity_id');
            params.entity_id = entityId;
        }
        if (eventType) {
            where.push('event_type = @event_type');
            params.event_type = eventType;
        }

        const cursorId = cursor?.id !== undefined ? Number(cursor.id) : null;
        if (Number.isFinite(cursorId) && cursorId > 0) {
            where.push('id < @cursor_id');
            params.cursor_id = cursorId;
        }

        const rows = db
            .prepare(
                `
                SELECT *
                FROM events
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY id DESC
                LIMIT @limit
            `
            )
            .all(params);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor = hasMore && last ? encodeCursor({ sort: 'id_desc', id: last.id }) : null;

        const items = page.map(e => ({
            id: e.id,
            entity_type: e.entity_type,
            entity_id: e.entity_id,
            ts_ms: e.ts_ms,
            actor_type: e.actor_type,
            actor_id: e.actor_id,
            event_type: e.event_type,
            payload: _safeParsePayloadJson(e.payload_json),
            dedup_key: e.dedup_key ?? null,
        }));

        ok(res, req, { items }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] global events failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, {
            code: 'DASHBOARD_EVENTS_FAILED',
            error: 'Erro ao listar eventos',
            details: err?.message || String(err),
        });
    }
});

export default router;
