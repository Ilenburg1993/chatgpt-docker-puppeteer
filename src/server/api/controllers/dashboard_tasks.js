// @ts-check
import express from 'express';
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import { listAttemptsByTask } from '#infra/db/task_attempt_repo';
import { ok, fail, encodeCursor, decodeCursor, parseIncludeParam } from '../utils/api_envelope.js';
import { taskRowToListItem, taskRowToDetailTask } from '../utils/task_views.js';

const router = express.Router();

function _asInt(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _buildTasksWhere({ status, stage, missionId, target, blocked, search, priorityGte } = {}) {
    const where = [];
    /** @type {Record<string, any>} */
    const params = {};

    if (status) {
        where.push('t.status = @status');
        params.status = String(status).toUpperCase().trim();
    }
    if (stage) {
        where.push('t.stage = @stage');
        params.stage = String(stage).toUpperCase().trim();
    }
    if (missionId) {
        where.push('t.mission_id = @mission_id');
        params.mission_id = String(missionId);
    }
    if (target) {
        where.push('t.target = @target');
        params.target = String(target).toLowerCase().trim();
    }
    if (blocked === true) {
        where.push("(t.status = 'BLOCKED' OR t.blocked_reason IS NOT NULL)");
    } else if (blocked === false) {
        where.push("(t.status != 'BLOCKED' AND t.blocked_reason IS NULL)");
    }
    if (search) {
        where.push('(instr(lower(t.id), lower(@search)) > 0 OR instr(lower(t.spec_user_message), lower(@search)) > 0)');
        params.search = String(search);
    }
    if (priorityGte !== null && priorityGte !== undefined && String(priorityGte) !== '') {
        where.push('t.priority >= @priority_gte');
        params.priority_gte = Number(priorityGte) || 0;
    }

    return { where, params };
}

function _applyCursorToWhere(where, params, cursor) {
    if (!cursor) return;
    const updated = Number(cursor.updated_at_ms);
    const id = cursor.id ? String(cursor.id) : null;
    if (!Number.isFinite(updated) || !id) return;

    where.push('(t.updated_at_ms < @cursor_updated OR (t.updated_at_ms = @cursor_updated AND t.id < @cursor_id))');
    params.cursor_updated = updated;
    params.cursor_id = id;
}

/**
 * GET /api/dashboard/tasks
 * Cursor-based, SSOT-first list view for the dashboard.
 */
router.get('/tasks', async (req, res) => {
    try {
        const db = getDb();

        const limit = Math.max(1, Math.min(_asInt(req.query.limit, 200), 500));
        const cursor = decodeCursor(req.query.cursor);

        const status = req.query.status ? String(req.query.status) : null;
        const stage = req.query.stage ? String(req.query.stage) : null;
        const missionId = req.query.mission_id ? String(req.query.mission_id) : null;
        const target = req.query.target ? String(req.query.target) : null;
        const search = req.query.search ? String(req.query.search) : null;
        const priorityGte = req.query.priority_gte ?? null;
        const blockedRaw = req.query.blocked;
        const blocked =
            blockedRaw === undefined
                ? null
                : String(blockedRaw).toLowerCase().trim() === 'true'
                    ? true
                    : String(blockedRaw).toLowerCase().trim() === 'false'
                        ? false
                        : null;

        const { where, params } = _buildTasksWhere({
            status,
            stage,
            missionId,
            target,
            blocked,
            search,
            priorityGte,
        });
        _applyCursorToWhere(where, params, cursor);

        params.limit = limit + 1;

        const sql = `
            SELECT
                t.id, t.mission_id, t.parent_id, t.workflow_id,
                t.stage, t.status,
                t.priority, t.target, t.model,
                t.execute_after_ms, t.attempts,
                t.locked_by, t.lock_expires_at_ms,
                t.blocked_reason, t.blocked_at_ms,
                t.latest_attempt_id,
                t.spec_user_message, t.spec_system_message,
                t.task_json,
                t.created_at_ms, t.updated_at_ms,
                t.started_at_ms, t.completed_at_ms, t.failed_at_ms, t.paused_at_ms, t.cancelled_at_ms
            FROM tasks t
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY t.updated_at_ms DESC, t.id DESC
            LIMIT @limit
        `;

        const rows = db.prepare(sql).all(params);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        const items = page.map(taskRowToListItem);
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor = hasMore && last ? encodeCursor({ sort: 'updated_desc', updated_at_ms: last.updated_at_ms, id: last.id }) : null;

        ok(res, req, { items }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] tasks list failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'TASKS_LIST_FAILED', error: 'Erro ao recuperar tasks', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/tasks/:id
 * Rich detail view (includes are opt-in).
 */
router.get('/tasks/:id', async (req, res) => {
    try {
        const db = getDb();
        const taskId = String(req.params.id);
        const include = parseIncludeParam(req.query.include);

        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!row) {
            return fail(res, req, 404, { code: 'TASK_NOT_FOUND', error: 'Task não encontrada', details: { task_id: taskId } });
        }

        const task = taskRowToDetailTask(row);

        /** @type {any} */
        const data = { task };

        if (include.has('attempts')) {
            data.attempts = listAttemptsByTask(taskId, { limit: 200 });
        }

        if (include.has('events')) {
            data.events = db
                .prepare(
                    `
                    SELECT *
                    FROM events
                    WHERE entity_type = 'task'
                      AND entity_id = ?
                    ORDER BY id DESC
                    LIMIT 200
                `
                )
                .all(taskId)
                .map(e => ({
                    ...e,
                    payload: (() => {
                        try {
                            return JSON.parse(e.payload_json);
                        } catch (_) {
                            return e.payload_json;
                        }
                    })(),
                }));
        }

        if (include.has('dependencies')) {
            const deps = db
                .prepare(
                    `
                    SELECT t.*
                    FROM task_dependencies d
                    JOIN tasks t ON t.id = d.depends_on_task_id
                    WHERE d.task_id = ?
                    ORDER BY t.created_at_ms ASC
                `
                )
                .all(taskId);
            data.dependencies = deps.map(taskRowToListItem);
        }

        if (include.has('children')) {
            const children = db
                .prepare(
                    `
                    SELECT *
                    FROM tasks
                    WHERE parent_id = ?
                    ORDER BY created_at_ms ASC
                    LIMIT 500
                `
                )
                .all(taskId);
            data.children = children.map(taskRowToListItem);
        }

        if (include.has('workflow')) {
            const workflowId = row.workflow_id || task?.meta?.workflow_id || null;
            if (workflowId) {
                const wfTasks = db
                    .prepare(
                        `
                        SELECT *
                        FROM tasks
                        WHERE workflow_id = ?
                        ORDER BY created_at_ms ASC
                        LIMIT 2000
                    `
                    )
                    .all(workflowId);
                data.workflow = {
                    workflow_id: workflowId,
                    tasks: wfTasks.map(taskRowToListItem),
                };
            } else {
                data.workflow = null;
            }
        }

        if (include.has('artifacts')) {
            const artifactIds = new Set();
            if (row.prompt_template_artifact_id) artifactIds.add(String(row.prompt_template_artifact_id));
            if (row.latest_rendered_prompt_artifact_id) artifactIds.add(String(row.latest_rendered_prompt_artifact_id));
            if (row.latest_response_v2_json_artifact_id) artifactIds.add(String(row.latest_response_v2_json_artifact_id));

            const attempts = include.has('attempts') ? data.attempts : listAttemptsByTask(taskId, { limit: 50 });
            for (const a of attempts || []) {
                for (const k of [
                    'rendered_prompt_artifact_id',
                    'response_text_artifact_id',
                    'response_v2_json_artifact_id',
                    'response_md_artifact_id',
                    'response_html_artifact_id',
                ]) {
                    if (a && a[k]) artifactIds.add(String(a[k]));
                }
                if (a && a.diagnostic_artifacts_json) {
                    try {
                        const parsed = JSON.parse(String(a.diagnostic_artifacts_json));
                        if (Array.isArray(parsed)) {
                            for (const item of parsed) {
                                if (item && typeof item === 'object' && item.artifact_id) {
                                    artifactIds.add(String(item.artifact_id));
                                }
                            }
                        }
                    } catch (_) {
                        /* ignore */
                    }
                }
            }

            const ids = Array.from(artifactIds);
            if (ids.length === 0) {
                data.artifacts = [];
            } else {
                const placeholders = ids.map(() => '?').join(',');
                data.artifacts = db.prepare(`SELECT * FROM artifacts WHERE id IN (${placeholders})`).all(...ids);
            }
        }

        ok(res, req, data, { includes: Array.from(include) });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] task detail failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'TASK_DETAIL_FAILED', error: 'Erro ao recuperar task', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/tasks-stats
 * Aggregated counters for tasks.
 */
router.get('/tasks-stats', async (req, res) => {
    try {
        const db = getDb();
        const rows = db
            .prepare(
                `
                SELECT status, COUNT(*) AS c
                FROM tasks
                GROUP BY status
            `
            )
            .all();

        const byStatus = {};
        for (const r of rows) {
            byStatus[String(r.status)] = Number(r.c) || 0;
        }

        const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
        ok(res, req, { total, by_status: byStatus }, {});
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] tasks stats failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'TASKS_STATS_FAILED', error: 'Erro ao calcular estatísticas', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/tasks/:id/attempts
 */
router.get('/tasks/:id/attempts', async (req, res) => {
    try {
        const db = getDb();
        const taskId = String(req.params.id);
        const limit = Math.max(1, Math.min(_asInt(req.query.limit, 200), 500));
        const cursor = decodeCursor(req.query.cursor);

        const where = ['task_id = @task_id'];
        const params = { task_id: taskId, limit: limit + 1 };

        const cMs = cursor && Number(cursor.created_at_ms);
        const cId = cursor && cursor.id ? String(cursor.id) : null;
        if (Number.isFinite(cMs) && cId) {
            where.push('(created_at_ms < @cursor_created OR (created_at_ms = @cursor_created AND id < @cursor_id))');
            params.cursor_created = cMs;
            params.cursor_id = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT *
                FROM task_attempts
                WHERE ${where.join(' AND ')}
                ORDER BY created_at_ms DESC, id DESC
                LIMIT @limit
            `
            )
            .all(params);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor = hasMore && last ? encodeCursor({ sort: 'created_desc', created_at_ms: last.created_at_ms, id: last.id }) : null;

        ok(res, req, { items: page }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] attempts list failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'ATTEMPTS_LIST_FAILED', error: 'Erro ao listar attempts', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/tasks/:id/events
 */
router.get('/tasks/:id/events', async (req, res) => {
    try {
        const db = getDb();
        const taskId = String(req.params.id);
        const limit = Math.max(1, Math.min(_asInt(req.query.limit, 200), 500));
        const cursor = decodeCursor(req.query.cursor);
        const eventType = req.query.event_type ? String(req.query.event_type) : null;

        const where = ["entity_type = 'task'", 'entity_id = @entity_id'];
        /** @type {Record<string, any>} */
        const params = { entity_id: taskId, limit: limit + 1 };

        if (eventType) {
            where.push('event_type = @event_type');
            params.event_type = eventType;
        }

        const cId = cursor && Number(cursor.id);
        if (Number.isFinite(cId)) {
            where.push('id < @cursor_id');
            params.cursor_id = cId;
        }

        const rows = db
            .prepare(
                `
                SELECT *
                FROM events
                WHERE ${where.join(' AND ')}
                ORDER BY id DESC
                LIMIT @limit
            `
            )
            .all(params)
            .map(e => ({
                ...e,
                payload: (() => {
                    try {
                        return JSON.parse(e.payload_json);
                    } catch (_) {
                        return e.payload_json;
                    }
                })(),
            }));

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page.length ? page[page.length - 1] : null;
        const nextCursor = hasMore && last ? encodeCursor({ sort: 'id_desc', id: last.id }) : null;

        ok(res, req, { items: page }, { limit, next_cursor: nextCursor, has_more: hasMore });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] events list failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'EVENTS_LIST_FAILED', error: 'Erro ao listar eventos', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/tasks/:id/timeline
 * One-shot payload for UI: task + recent attempts + recent events.
 */
router.get('/tasks/:id/timeline', async (req, res) => {
    try {
        const db = getDb();
        const taskId = String(req.params.id);
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!row) {
            return fail(res, req, 404, { code: 'TASK_NOT_FOUND', error: 'Task não encontrada', details: { task_id: taskId } });
        }

        const task = taskRowToDetailTask(row);
        const attempts = listAttemptsByTask(taskId, { limit: 200 });
        const events = db
            .prepare(
                `
                SELECT *
                FROM events
                WHERE entity_type = 'task'
                  AND entity_id = ?
                ORDER BY id DESC
                LIMIT 500
            `
            )
            .all(taskId)
            .map(e => ({
                ...e,
                payload: (() => {
                    try {
                        return JSON.parse(e.payload_json);
                    } catch (_) {
                        return e.payload_json;
                    }
                })(),
            }));

        ok(res, req, { task, attempts, events }, {});
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] timeline failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'TASK_TIMELINE_FAILED', error: 'Erro ao recuperar timeline', details: err?.message || String(err) });
    }
});

/**
 * GET /api/dashboard/workflows/:workflow_id
 */
router.get('/workflows/:workflow_id', async (req, res) => {
    try {
        const db = getDb();
        const workflowId = String(req.params.workflow_id);

        const tasks = db
            .prepare(
                `
                SELECT *
                FROM tasks
                WHERE workflow_id = ?
                ORDER BY created_at_ms ASC
                LIMIT 5000
            `
            )
            .all(workflowId);

        if (!tasks || tasks.length === 0) {
            return ok(res, req, { workflow_id: workflowId, tasks: [], edges: [] }, {});
        }

        const taskIds = new Set(tasks.map(t => t.id));
        const deps = db
            .prepare(
                `
                SELECT task_id, depends_on_task_id
                FROM task_dependencies
                WHERE task_id IN (${tasks.map(() => '?').join(',')})
            `
            )
            .all(...tasks.map(t => t.id))
            .filter(e => taskIds.has(e.task_id) && taskIds.has(e.depends_on_task_id));

        ok(res, req, { workflow_id: workflowId, tasks: tasks.map(taskRowToListItem), edges: deps }, {});
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] workflow view failed: ${err?.message || String(err)}`, req.id);
        fail(res, req, 500, { code: 'WORKFLOW_VIEW_FAILED', error: 'Erro ao recuperar workflow', details: err?.message || String(err) });
    }
});

export default router;
