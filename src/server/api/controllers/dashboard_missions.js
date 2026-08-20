// @ts-check
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import express from 'express';
import { decodeCursor, encodeCursor, fail, ok, parseIncludeParam } from '../utils/api_envelope.js';
import { taskDbRowToListItem } from '../utils/task_views.js';

/** Constante/valor exportado: default. */
const router = express.Router();

function _asInt(/** @type {any} */ raw, /** @type {any} */ fallback) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _normalizeStatus(/** @type {any} */ value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _normalizeAutonomy(/** @type {any} */ value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _parseJson(/** @type {any} */ raw, /** @type {any} */ fallback) {
    try {
        return raw ? JSON.parse(String(raw)) : fallback;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log.debug({ error: _e?.message }, '[dashboard_missions] _parseJson fallback to default');
        return fallback;
    }
}

function _missionRowToItem(/** @type {any} */ row, /** @type {any} */ countsByMissionId) {
    const counts = countsByMissionId[String(row.id)] || null;
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        autonomy_mode: row.autonomy_mode,
        created_at_ms: row.created_at_ms,
        updated_at_ms: row.updated_at_ms,
        started_at_ms: row.started_at_ms ?? null,
        completed_at_ms: row.completed_at_ms ?? null,
        counts: counts || {
            tasks_total: 0,
            by_stage: {},
            by_status: {},
            proposed: 0,
            blocked: 0,
            running: 0,
            pending: 0,
            done: 0,
            failed: 0,
        },
    };
}

function _fetchCountsForMissions(/** @type {any} */ db, /** @type {any} */ missionIds) {
    if (!missionIds || missionIds.length === 0) return {};
    const placeholders = missionIds.map(() => '?').join(',');

    const rows = db
        .prepare(
            `
            SELECT mission_id, stage, status, COUNT(*) AS c
            FROM tasks
            WHERE mission_id IN (${placeholders})
            GROUP BY mission_id, stage, status
        `,
        )
        .all(...missionIds);

    /** @type {Record<string, any>} */
    const out = {};
    for (const r of rows) {
        const mid = String(r.mission_id);
        out[mid] = out[mid] || {
            tasks_total: 0,
            by_stage: {},
            by_status: {},
            proposed: 0,
            blocked: 0,
            running: 0,
            pending: 0,
            done: 0,
            failed: 0,
        };
        const c = Number(r.c) || 0;
        out[mid].tasks_total += c;
        out[mid].by_stage[String(r.stage)] = (out[mid].by_stage[String(r.stage)] || 0) + c;
        out[mid].by_status[String(r.status)] = (out[mid].by_status[String(r.status)] || 0) + c;
        if (String(r.stage) === 'PROPOSED') out[mid].proposed += c;
        if (String(r.status) === 'BLOCKED') out[mid].blocked += c;
        if (String(r.status) === 'RUNNING') out[mid].running += c;
        if (String(r.status) === 'PENDING') out[mid].pending += c;
        if (String(r.status) === 'DONE') out[mid].done += c;
        if (String(r.status) === 'FAILED') out[mid].failed += c;
    }
    return out;
}

/**
 * GET /api/dashboard/missions
 */
router.get('/missions', async (req, res) => {
    try {
        const db = getDb();
        const limit = Math.max(1, Math.min(_asInt(req.query['limit'], 100), 200));
        const cursor = decodeCursor(req.query['cursor']);

        const status = _normalizeStatus(req.query['status']);
        const autonomyMode = _normalizeAutonomy(req.query['autonomy_mode']);
        const search = req.query['search'] ? String(req.query['search']) : null;

        const where = [];
        /** @type {Record<string, any>} */
        const params = { limit: limit + 1 };

        if (status) {
            where.push('m.status = @status');
            params['status'] = status;
        }
        if (autonomyMode) {
            where.push('m.autonomy_mode = @autonomy_mode');
            params['autonomy_mode'] = autonomyMode;
        }
        if (search) {
            where.push(
                '(instr(lower(m.title), lower(@search)) > 0 OR instr(lower(m.description), lower(@search)) > 0 OR instr(lower(m.id), lower(@search)) > 0)',
            );
            params['search'] = search;
        }

        const cUpdated = cursor && Number(cursor['updated_at_ms']);
        const cId = cursor && cursor['id'] ? String(cursor['id']) : null;
        if (Number.isFinite(cUpdated) && cId) {
            where.push(
                '(m.updated_at_ms < @cursor_updated OR (m.updated_at_ms = @cursor_updated AND m.id < @cursor_id))',
            );
            params['cursor_updated'] = cUpdated;
            params['cursor_id'] = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT *
                FROM missions m
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY m.updated_at_ms DESC, m.id DESC
                LIMIT @limit
            `,
            )
            .all(params);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        const missionIds = page.map((/** @type {any} */ r) => String(r.id));
        const counts = _fetchCountsForMissions(db, missionIds);

        const items = page.map((r) => _missionRowToItem(r, counts));
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor =
            hasMore && last
                ? encodeCursor({
                      sort: 'updated_desc',
                      updated_at_ms: /** @type {any} */ (last).updated_at_ms,
                      id: /** @type {any} */ (last).id,
                  })
                : null;

        ok(res, req, { items }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] missions list failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSIONS_LIST_FAILED',
            error: 'Erro ao recuperar missions',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /api/dashboard/missions/:id
 */
router.get('/missions/:id', async (req, res) => {
    try {
        const db = getDb();
        const missionId = String(req.params.id);
        const include = parseIncludeParam(req.query['include']);

        const row = /** @type {any} */ (db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId));
        if (!row) {
            return fail(res, req, 404, {
                code: 'MISSION_NOT_FOUND',
                error: 'Missão não encontrada',
                details: { mission_id: missionId },
            });
        }

        const mission = {
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            autonomy_mode: row.autonomy_mode,
            policy: _parseJson(row.policy_json, {}),
            context: _parseJson(row.context_json, {}),
            created_at_ms: row.created_at_ms,
            updated_at_ms: row.updated_at_ms,
            started_at_ms: row.started_at_ms ?? null,
            completed_at_ms: row.completed_at_ms ?? null,
        };

        /** @type {Record<string, any>} */
        const data = { mission };

        // Summary counts (always useful)
        const counts = _fetchCountsForMissions(db, [missionId])[missionId] || null;
        data['counts'] = counts;

        if (include.has('tasks')) {
            const tasks = db
                .prepare(
                    `
                    SELECT
                        t.*,
                        m.title AS mission_title,
                        m.status AS mission_status,
                        m.autonomy_mode AS mission_autonomy_mode
                    FROM tasks t
                    LEFT JOIN missions m ON m.id = t.mission_id
                    WHERE t.mission_id = ?
                    ORDER BY t.updated_at_ms DESC, t.id DESC
                    LIMIT 2000
                `,
                )
                .all(missionId);
            data['tasks'] = tasks.map(taskDbRowToListItem);
        }

        if (include.has('events')) {
            data['events'] = db
                .prepare(
                    `
                    SELECT *
                    FROM events
                    WHERE entity_type = 'mission'
                      AND entity_id = ?
                    ORDER BY id DESC
                    LIMIT 500
                `,
                )
                .all(missionId)
                .map((/** @type {any} */ e) => ({
                    ...e,
                    payload: (() => {
                        try {
                            return JSON.parse(/** @type {any} */ (e).payload_json);
                        } catch (/** @type {any} */ _) {
                            return /** @type {any} */ (e).payload_json;
                        }
                    })(),
                }));
        }

        ok(res, req, data, { includes: Array.from(include) });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] mission detail failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSION_DETAIL_FAILED',
            error: 'Erro ao recuperar mission',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /api/dashboard/missions/:id/tasks
 */
router.get('/missions/:id/tasks', async (req, res) => {
    try {
        const db = getDb();
        const missionId = String(req.params.id);
        const limit = Math.max(1, Math.min(_asInt(req.query['limit'], 200), 500));
        const cursor = decodeCursor(req.query['cursor']);

        const stage = req.query['stage'] ? String(req.query['stage']).toUpperCase().trim() : null;
        const status = req.query['status'] ? String(req.query['status']).toUpperCase().trim() : null;

        const where = ['t.mission_id = @mission_id'];
        /** @type {Record<string, any>} */
        const params = { mission_id: missionId, limit: limit + 1 };

        if (stage) {
            where.push('t.stage = @stage');
            params['stage'] = stage;
        }
        if (status) {
            where.push('t.status = @status');
            params['status'] = status;
        }

        const cUpdated = cursor && Number(cursor['updated_at_ms']);
        const cId = cursor && cursor['id'] ? String(cursor['id']) : null;
        if (Number.isFinite(cUpdated) && cId) {
            where.push(
                '(t.updated_at_ms < @cursor_updated OR (t.updated_at_ms = @cursor_updated AND t.id < @cursor_id))',
            );
            params['cursor_updated'] = cUpdated;
            params['cursor_id'] = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT
                    t.*,
                    m.title AS mission_title,
                    m.status AS mission_status,
                    m.autonomy_mode AS mission_autonomy_mode
                FROM tasks t
                LEFT JOIN missions m ON m.id = t.mission_id
                WHERE ${where.join(' AND ')}
                ORDER BY t.updated_at_ms DESC, t.id DESC
                LIMIT @limit
            `,
            )
            .all(params);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor =
            hasMore && last
                ? encodeCursor({
                      sort: 'updated_desc',
                      updated_at_ms: /** @type {any} */ (last).updated_at_ms,
                      id: /** @type {any} */ (last).id,
                  })
                : null;

        ok(res, req, { items: page.map(taskDbRowToListItem) }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] mission tasks failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSION_TASKS_FAILED',
            error: 'Erro ao listar tasks da mission',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /api/dashboard/missions/:id/proposals
 */
router.get('/missions/:id/proposals', async (req, res) => {
    try {
        const db = getDb();
        const missionId = String(req.params.id);
        const limit = Math.max(1, Math.min(_asInt(req.query['limit'], 200), 500));
        const cursor = decodeCursor(req.query['cursor']);

        const where = ['t.mission_id = @mission_id', "t.stage = 'PROPOSED'"];
        /** @type {Record<string, any>} */
        const params = { mission_id: missionId, limit: limit + 1 };

        const cUpdated = cursor && Number(cursor['updated_at_ms']);
        const cId = cursor && cursor['id'] ? String(cursor['id']) : null;
        if (Number.isFinite(cUpdated) && cId) {
            where.push(
                '(t.updated_at_ms < @cursor_updated OR (t.updated_at_ms = @cursor_updated AND t.id < @cursor_id))',
            );
            params['cursor_updated'] = cUpdated;
            params['cursor_id'] = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT
                    t.*,
                    m.title AS mission_title,
                    m.status AS mission_status,
                    m.autonomy_mode AS mission_autonomy_mode
                FROM tasks t
                LEFT JOIN missions m ON m.id = t.mission_id
                WHERE ${where.join(' AND ')}
                ORDER BY t.updated_at_ms DESC, t.id DESC
                LIMIT @limit
            `,
            )
            .all(params);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor =
            hasMore && last
                ? encodeCursor({
                      sort: 'updated_desc',
                      updated_at_ms: /** @type {any} */ (last).updated_at_ms,
                      id: /** @type {any} */ (last).id,
                  })
                : null;

        ok(res, req, { items: page.map(taskDbRowToListItem) }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] mission proposals failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSION_PROPOSALS_FAILED',
            error: 'Erro ao listar proposals',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /api/dashboard/missions/:id/events
 */
router.get('/missions/:id/events', async (req, res) => {
    try {
        const db = getDb();
        const missionId = String(req.params.id);
        const limit = Math.max(1, Math.min(_asInt(req.query['limit'], 200), 500));
        const cursor = decodeCursor(req.query['cursor']);
        const eventType = req.query['event_type'] ? String(req.query['event_type']) : null;

        const where = ["entity_type = 'mission'", 'entity_id = @entity_id'];
        /** @type {Record<string, any>} */
        const params = { entity_id: missionId, limit: limit + 1 };

        if (eventType) {
            where.push('event_type = @event_type');
            params['event_type'] = eventType;
        }

        const cId = cursor && Number(cursor['id']);
        if (Number.isFinite(cId)) {
            where.push('id < @cursor_id');
            params['cursor_id'] = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT *
                FROM events
                WHERE ${where.join(' AND ')}
                ORDER BY id DESC
                LIMIT @limit
            `,
            )
            .all(params)
            .map((/** @type {any} */ e) => ({
                ...e,
                payload: (() => {
                    try {
                        return JSON.parse(/** @type {any} */ (e).payload_json);
                    } catch (/** @type {any} */ _) {
                        return /** @type {any} */ (e).payload_json;
                    }
                })(),
            }));

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor = hasMore && last ? encodeCursor({ sort: 'id_desc', id: /** @type {any} */ (last).id }) : null;

        ok(res, req, { items: page }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] mission events failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSION_EVENTS_FAILED',
            error: 'Erro ao listar eventos',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /api/dashboard/missions/:id/graph
 */
router.get('/missions/:id/graph', async (req, res) => {
    try {
        const db = getDb();
        const missionId = String(req.params.id);
        const tasks = db
            .prepare(
                `
                SELECT *
                FROM tasks
                WHERE mission_id = ?
                ORDER BY created_at_ms ASC
                LIMIT 5000
            `,
            )
            .all(missionId);

        const taskIds = tasks.map((/** @type {any} */ t) => t.id);
        if (taskIds.length === 0) {
            return ok(res, req, { mission_id: missionId, tasks: [], edges: [], workflows: {} }, {});
        }

        const edges = db
            .prepare(
                `
                SELECT task_id, depends_on_task_id
                FROM task_dependencies
                WHERE task_id IN (${taskIds.map(() => '?').join(',')})
            `,
            )
            .all(...taskIds);

        /** @type {Record<string, any>} */
        const workflows = {};
        for (const t of tasks) {
            const wid = /** @type {any} */ (t).workflow_id || null;
            if (!wid) continue;
            workflows[wid] = workflows[wid] || { workflow_id: wid, task_ids: [] };
            workflows[wid].task_ids.push(/** @type {any} */ (t).id);
        }

        ok(
            res,
            req,
            {
                mission_id: missionId,
                tasks: tasks.map(taskDbRowToListItem),
                edges,
                workflows,
            },
            {},
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] mission graph failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'MISSION_GRAPH_FAILED',
            error: 'Erro ao gerar grafo',
            details: _e?.message || String(_e),
        });
    }
});

export default router;
