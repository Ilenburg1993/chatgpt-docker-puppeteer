// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { getDb } from './sqlite.js';

/** Constante/valor exportado: TASK_STAGES. */
const TASK_STAGES = Object.freeze({
    DRAFT: 'DRAFT',
    PROPOSED: 'PROPOSED',
    READY: 'READY',
    REJECTED: 'REJECTED',
    ARCHIVED: 'ARCHIVED',
});

/**
 * @typedef {{
 *   id: string,
 *   mission_id: string|null,
 *   parent_id?: string|null,
 *   workflow_id?: string|null,
 *   stage: string,
 *   status: string,
 *   priority: number,
 *   target: string,
 *   model: string|null,
 *   execute_after_ms: number|null,
 *   attempts: number,
 *   last_error: string|null,
 *   last_correlation_id: string|null,
 *   locked_by: string|null,
 *   locked_at_ms: number|null,
 *   lock_expires_at_ms: number|null,
 *   spec_user_message: string,
 *   spec_system_message: string,
 *   task_json: string,
 *   result_json: string|null,
 *   prompt_template_artifact_id?: string|null,
 *   latest_attempt_id?: string|null,
 *   latest_rendered_prompt_artifact_id?: string|null,
 *   latest_response_v2_json_artifact_id?: string|null,
 *   created_at_ms: number,
 *   updated_at_ms: number,
 *   started_at_ms: number|null,
 *   completed_at_ms: number|null,
 *   paused_at_ms: number|null,
 *   cancelled_at_ms: number|null,
 *   failed_at_ms: number|null,
 *   blocked_reason?: string|null,
 *   blocked_at_ms?: number|null,
 *   blocked_details_json?: string|null,
 * }} TaskRow
 */

function _now() {
    return Date.now();
}

function _safeParseMs(/** @type {any} */ isoOrMs) {
    if (isoOrMs === null || isoOrMs === undefined) {
        return null;
    }
    if (typeof isoOrMs === 'number' && Number.isFinite(isoOrMs)) {
        return isoOrMs;
    }
    if (typeof isoOrMs === 'string') {
        const parsed = Date.parse(isoOrMs);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function _normalizeTaskForDb(/** @type {any} */ rawTask) {
    const isV5 = rawTask?.meta?.version === '5.0' || rawTask?.execution || rawTask?.mission;
    const task = isV5 ? schemas.core.TaskSchemaV5.parse(rawTask) : schemas.parseTask(rawTask);

    // Ensure V5 has mission id mirrored (meta + mission).
    const missionId = task?.meta?.mission_id ?? task?.mission?.mission_id ?? null;
    if (missionId) {
        task.meta = task.meta || {};
        task.meta.mission_id = missionId;
        task.mission = task.mission || {};
        task.mission.mission_id = missionId;
    }

    return task;
}

/**
 * @param {TaskRow} row
 */
function _rowToTask(row) {
    if (!row) return null;

    // ✅ P1-20: Protect JSON.parse() from corrupted task_json
    let task;
    try {
        task = JSON.parse(row.task_json);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[task_repo] Invalid task_json for task ${row?.id}: ${msg}`);
        // Return null for corrupted tasks - they'll be invisible until fixed
        return null;
    }

    // DB is SSOT for stage/status; mirror into task for UI/compat.
    task.stage = row.stage;
    task.unified_status = row.status;
    task.latest_attempt_id = row.latest_attempt_id ?? null;
    task.prompt_template_artifact_id = row.prompt_template_artifact_id ?? null;

    // Derived workflow fields (SSOT convenience)
    task.meta = task.meta || {};
    if (row.parent_id !== undefined) {
        task.meta.parent_id = row.parent_id ?? undefined;
    }
    if (row.workflow_id !== undefined) {
        task.meta.workflow_id = row.workflow_id ?? undefined;
    }

    task.state = task.state || {};
    task.state.status = row.status;

    // Helpful runtime fields (if present)
    if (row.last_error) task.state.last_error = row.last_error;
    if (row.started_at_ms) task.state.started_at = new Date(row.started_at_ms).toISOString();
    if (row.completed_at_ms) task.state.completed_at = new Date(row.completed_at_ms).toISOString();
    if (row.paused_at_ms) task.state.paused_at = new Date(row.paused_at_ms).toISOString();
    if (row.blocked_reason) task.state.blocked_reason = row.blocked_reason;
    if (row.blocked_at_ms) task.state.blocked_at = new Date(row.blocked_at_ms).toISOString();
    if (row.blocked_details_json) {
        try {
            task.state.blocked_details = JSON.parse(row.blocked_details_json);
        } catch (err) {
            log.warn(
                { taskId: task.id, field: 'blocked_details_json', error: (/** @type {any} */ (err))?.message },
                '[task_repo] Fallback to raw string for malformed JSON'
            );
            task.state.blocked_details = row.blocked_details_json;
        }
    }

    // Attach parsed result_json (optional)
    if (row.result_json) {
        try {
            task.result_db = JSON.parse(row.result_json);
        } catch (err) {
            log.warn(
                { taskId: task.id, field: 'result_json', error: (/** @type {any} */ (err))?.message },
                '[task_repo] Fallback to raw string for malformed JSON'
            );
            task.result_db = row.result_json;
        }
    }

    return task;
}

/**
 * Função exportada: getTaskById.
 * @param {string} taskId Task identifier.
 * @returns {TaskRow|null}
 */
function getTaskById(taskId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return row ? _rowToTask(/** @type {TaskRow} */ (row)) : null;
}

/**
 * @typedef {object} ListTasksOptions
 * @property {string|null} status
 * @property {string|null} stage
 * @property {string|null} missionId
 * @property {number} limit
 * @property {number} offset
 */
/**
 * Lista tasks com suporte a filtros, paginação e limite seguro.
 * PERF-01 FIX: Adicionado parâmetro `offset` para paginação e limitado
 * o máximo retornável a 500 por chamada (vs 20.000 anterior).
 *
 * @param {any} [opts]
  * @returns {TaskRow[]}
 */
function listTasks({ status = null, stage = null, missionId = null, limit = 100, offset = 0 } = /** @type {any} */ ({})) {
    const db = getDb();
    const where = [];
    /** @type {Record<string, unknown>} */
    const params = {};

    if (status) {
        where.push('status = @status');
        params.status = status;
    }
    if (stage) {
        where.push('stage = @stage');
        params.stage = stage;
    }
    if (missionId) {
        where.push('mission_id = @mission_id');
        params.mission_id = missionId;
    }

    const sql = `
        SELECT * FROM tasks
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY priority DESC, created_at_ms DESC
        LIMIT @limit OFFSET @offset
    `;

    params.limit = Math.max(1, Math.min(Number(limit) || 100, 500));
    params.offset = Math.max(0, Number(offset) || 0);
    const rows = db.prepare(sql).all(params);
    return rows.map(r => _rowToTask(/** @type {TaskRow} */ (r)));
}

/**
 * @typedef {object} CountTasksOptions
 * @property {string|null} status
 * @property {string|null} stage
 * @property {string|null} missionId
 */
/**
 * Conta o total de tasks com filtros (para paginação).
 * @param {any} [opts]
 * @returns {number}
 */
function countTasks({ status = null, stage = null, missionId = null } = /** @type {any} */ ({})) {
    const db = getDb();
    const where = [];
    /** @type {Record<string, unknown>} */
    const params = {};

    if (status) {
        where.push('status = @status');
        params.status = status;
    }
    if (stage) {
        where.push('stage = @stage');
        params.stage = stage;
    }
    if (missionId) {
        where.push('mission_id = @mission_id');
        params.mission_id = missionId;
    }

    const sql = `SELECT COUNT(*) as n FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const row = db.prepare(sql).get(params);
    return /** @type {{ n: number }} */ (row)?.n || 0;
}

/**
 * Conta tarefas agrupadas por status numa única query SQL (GROUP BY).
 * Mais eficiente que chamar countTasks() 8 vezes em paralelo.
 *
 * @returns {Record<string, number>} Mapa de status → contagem
 */
function countTasksByStatus() {
    const db = getDb();
    const rows = db.prepare('SELECT status, COUNT(*) as n FROM tasks GROUP BY status').all();
    /** @type {Record<string, number>} */
    const result = {};
    for (const row of rows) {
        const r = /** @type {{ status: string, n: number }} */ (row);
        result[r.status] = r.n;
    }
    return result;
}

/**
 * Função exportada: getTaskDependencies.
 * @param {*} taskId
 * @returns {TaskRow|null}
 */
function getTaskDependencies(taskId) {
    const db = getDb();
    const rows = db
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
    return /** @type {any} */ (rows.map(r => _rowToTask(/** @type {TaskRow} */ (r))));
}

/**
 * @typedef {*} InsertTaskRawTask
 */
/**
 * @typedef {*} InsertTaskOptions
 */
/**
 * Inserts a task into the database.
 * @param {InsertTaskRawTask} rawTask - The raw task object
 * @param {InsertTaskOptions} [options={}] - Options
  * @returns {TaskRow|null}
 */
function insertTask(
    rawTask,
    {
        stage = TASK_STAGES.READY,
        status = 'PENDING',
        actor = 'system',
        ifNotExists = false,
        promptTemplateArtifactId = null,
    } = {}
) {
    const db = getDb();
    const now = _now();

    const task = _normalizeTaskForDb(rawTask);
    const id = task?.meta?.id;
    if (!id) {
        throw new Error('Task inválida: meta.id ausente');
    }

    const missionId = task?.meta?.mission_id ?? task?.mission?.mission_id ?? null;
    const parentId = task?.meta?.parent_id ?? null;
    const workflowId = task?.meta?.workflow_id ?? null;
    const priority = Number(task?.meta?.priority ?? 0) || 0;
    const target = String(task?.spec?.target ?? 'auto');
    const model = task?.spec?.model ? String(task.spec.model) : null;

    const createdAtMs = _safeParseMs(task?.meta?.created_at) ?? now;
    const executeAfterMs = _safeParseMs(task?.policy?.execute_after);

    const specUserMessage = String(task?.spec?.payload?.user_message ?? '');
    const specSystemMessage = String(task?.spec?.payload?.system_message ?? '');

    const taskJson = JSON.stringify(task);

    const startedAtMs = _safeParseMs(task?.state?.started_at);
    const completedAtMs = _safeParseMs(task?.state?.completed_at);

    const attempts = Number(task?.state?.attempts ?? 0) || 0;
    const lastError = task?.state?.last_error ? String(task.state.last_error) : null;

    const tx = db.transaction(() => {
        const insertVerb = ifNotExists ? 'INSERT OR IGNORE' : 'INSERT';
        db.prepare(
            `
            ${insertVerb} INTO tasks (
                id, mission_id, parent_id, workflow_id, stage, status,
                priority, target, model,
                execute_after_ms, attempts, last_error, last_correlation_id,
                locked_by, locked_at_ms, lock_expires_at_ms,
                spec_user_message, spec_system_message,
                task_json, result_json,
                prompt_template_artifact_id, latest_attempt_id, latest_rendered_prompt_artifact_id, latest_response_v2_json_artifact_id,
                created_at_ms, updated_at_ms,
                started_at_ms, completed_at_ms, paused_at_ms, cancelled_at_ms, failed_at_ms,
                blocked_reason, blocked_at_ms, blocked_details_json
            ) VALUES (
                @id, @mission_id, @parent_id, @workflow_id, @stage, @status,
                @priority, @target, @model,
                @execute_after_ms, @attempts, @last_error, @last_correlation_id,
                NULL, NULL, NULL,
                @spec_user_message, @spec_system_message,
                @task_json, NULL,
                @prompt_template_artifact_id, NULL, NULL, NULL,
                @created_at_ms, @updated_at_ms,
                @started_at_ms, @completed_at_ms, NULL, NULL, NULL,
                NULL, NULL, NULL
            )
        `
        ).run({
            id,
            mission_id: missionId,
            parent_id: parentId ? String(parentId) : null,
            workflow_id: workflowId ? String(workflowId) : null,
            stage,
            status,
            priority,
            target,
            model,
            execute_after_ms: executeAfterMs,
            attempts,
            last_error: lastError,
            last_correlation_id: null,
            spec_user_message: specUserMessage,
            spec_system_message: specSystemMessage,
            task_json: taskJson,
            prompt_template_artifact_id: promptTemplateArtifactId ? String(promptTemplateArtifactId) : null,
            created_at_ms: createdAtMs,
            updated_at_ms: now,
            started_at_ms: startedAtMs,
            completed_at_ms: completedAtMs,
        });

        // If task already existed and we chose IGNORE, skip side effects.
        const inserted = (/** @type {any} */ (db.prepare('SELECT changes() AS c').get()))?.c || 0;
        if (!inserted) {
            return;
        }

        const deps = Array.isArray(task?.policy?.dependencies) ? task.policy.dependencies : [];
        if (deps.length > 0) {
            const stmt = db.prepare(
                'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)'
            );
            for (const depId of deps) {
                if (typeof depId === 'string' && depId.trim()) {
                    stmt.run(id, depId.trim());
                }
            }
        }

        // Audit event (best-effort)
        try {
            const dedupKey = `task:${id}:created:${createdAtMs}`;
            db.prepare(
                `
                INSERT OR IGNORE INTO events (entity_type, entity_id, ts_ms, actor_type, actor_id, event_type, payload_json, dedup_key)
                VALUES ('task', @id, @ts, @actor_type, NULL, 'TASK_CREATED', @payload, @dedup_key)
            `
            ).run({
                id,
                ts: now,
                actor_type: actor,
                payload: JSON.stringify({ id, stage, status }),
                dedup_key: dedupKey,
            });
        } catch (_) {
            /* ignore */
        }
    });

    tx();
    return getTaskById(id);
}

/**
 * @typedef {*} UpdateTaskUpdates
 */
/**
 * Updates a task with optimistic locking (retries up to 3 times on version conflict).
 * FIXED (P0-2.6): Agora throws em conflito permanente ao invés de retornar null
 *
 * @param {string} taskId
 * @param {UpdateTaskUpdates} updates
 * @param {number} [_retryCount=0] - Internal retry counter
 * @returns {any} - Task atualizado (nunca null em conflito)
 * @throws {Error} OptimisticLockError se max retries excedido
 */
function updateTask(taskId, updates = {}, _retryCount = 0) {
    // Exponential backoff em retries (evita thundering herd)
    if (_retryCount > 0) {
        const backoffMs = Math.min(10 * Math.pow(2, _retryCount - 1), 100);
        const start = Date.now();
        while (Date.now() - start < backoffMs) {
            // Busy wait - intencional para backoff curto
        }
    }

    const db = getDb();
    const now = _now();

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!existing) {
        return /** @type {any} */ (null);
    }

    /** @type {TaskRow} */
    const row = /** @type {TaskRow} */ (existing);
    const expectedVersion = row.updated_at_ms;

    const nextStage = updates.stage ?? row.stage;
    const nextStatus = updates.status ?? row.status;

    // If a full task object is provided, normalize and store.
    let nextTaskJson = row.task_json;
    let nextSpecUser = row.spec_user_message;
    let nextSpecSystem = row.spec_system_message;
    let nextMissionId = row.mission_id;
    let nextParentId = row.parent_id ?? null;
    let nextWorkflowId = row.workflow_id ?? null;
    let nextPriority = row.priority;
    let nextTarget = row.target;
    let nextModel = row.model;
    let nextExecuteAfterMs = row.execute_after_ms;
    /** @type {string[]|null} */
    let nextDeps = null;

    if (updates.task) {
        const normalized = _normalizeTaskForDb(updates.task);

        const depsFromTask = Array.isArray(normalized?.policy?.dependencies) ? normalized.policy.dependencies : null;

        const hasDepsOverride = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
        const depsRaw = hasDepsOverride ? updates.dependencies : depsFromTask;
        if (depsRaw !== undefined && depsRaw !== null) {
            const arr = Array.isArray(depsRaw) ? depsRaw : [];
            const seen = new Set();
            const cleaned = [];
            for (const d of arr) {
                const s = typeof d === 'string' ? d.trim() : String(d ?? '').trim();
                if (!s) continue;
                if (s === taskId) continue;
                if (seen.has(s)) continue;
                seen.add(s);
                cleaned.push(s);
            }
            nextDeps = cleaned;
        }

        if (nextDeps !== null) {
            normalized.policy = normalized.policy || {};
            normalized.policy.dependencies = nextDeps;
        }

        nextTaskJson = JSON.stringify(normalized);
        nextSpecUser = String(normalized?.spec?.payload?.user_message ?? '');
        nextSpecSystem = String(normalized?.spec?.payload?.system_message ?? '');
        nextMissionId = normalized?.meta?.mission_id ?? normalized?.mission?.mission_id ?? null;
        nextParentId = normalized?.meta?.parent_id ?? null;
        nextWorkflowId = normalized?.meta?.workflow_id ?? null;
        nextPriority = Number(normalized?.meta?.priority ?? row.priority) || 0;
        nextTarget = String(normalized?.spec?.target ?? row.target);
        nextModel = normalized?.spec?.model ? String(normalized.spec.model) : null;
        nextExecuteAfterMs = _safeParseMs(normalized?.policy?.execute_after);
    } else if (Object.prototype.hasOwnProperty.call(updates, 'dependencies')) {
        const arr = Array.isArray(updates.dependencies) ? updates.dependencies : [];
        const seen = new Set();
        const cleaned = [];
        for (const d of arr) {
            const s = typeof d === 'string' ? d.trim() : String(d ?? '').trim();
            if (!s) continue;
            if (s === taskId) continue;
            if (seen.has(s)) continue;
            seen.add(s);
            cleaned.push(s);
        }
        nextDeps = cleaned;

        // Keep task_json.policy.dependencies mirrored even when only deps are updated.
        try {
            const parsed = JSON.parse(String(nextTaskJson));
            if (parsed && typeof parsed === 'object') {
                parsed.policy = parsed.policy || {};
                parsed.policy.dependencies = nextDeps;
                nextTaskJson = JSON.stringify(parsed);
            }
        } catch (_) {
            /* best-effort */
        }
    }

    if (updates.execute_after_ms !== undefined) {
        const v = updates.execute_after_ms;
        if (v === null) {
            nextExecuteAfterMs = null;
        } else {
            const n = Number(v);
            nextExecuteAfterMs = Number.isFinite(n) ? n : null;
        }
    }

    const lastError =
        updates.last_error !== undefined ? (updates.last_error ? String(updates.last_error) : null) : row.last_error;
    const lastCorrelationId =
        updates.last_correlation_id !== undefined
            ? updates.last_correlation_id
                ? String(updates.last_correlation_id)
                : null
            : row.last_correlation_id;

    const attempts = updates.attempts !== undefined ? Number(updates.attempts) || 0 : row.attempts;

    const startedAtMs = updates.started_at_ms !== undefined ? Number(updates.started_at_ms) || null : row.started_at_ms;
    const completedAtMs =
        updates.completed_at_ms !== undefined ? Number(updates.completed_at_ms) || null : row.completed_at_ms;
    const pausedAtMs = updates.paused_at_ms !== undefined ? Number(updates.paused_at_ms) || null : row.paused_at_ms;
    const cancelledAtMs =
        updates.cancelled_at_ms !== undefined ? Number(updates.cancelled_at_ms) || null : row.cancelled_at_ms;
    const failedAtMs = updates.failed_at_ms !== undefined ? Number(updates.failed_at_ms) || null : row.failed_at_ms;

    const blockedReason =
        updates.blocked_reason !== undefined
            ? updates.blocked_reason
                ? String(updates.blocked_reason)
                : null
            : (row.blocked_reason ?? null);
    const blockedAtMs =
        updates.blocked_at_ms !== undefined ? Number(updates.blocked_at_ms) || null : (row.blocked_at_ms ?? null);
    const blockedDetailsJson =
        updates.blocked_details_json !== undefined
            ? updates.blocked_details_json
                ? String(updates.blocked_details_json)
                : null
            : (row.blocked_details_json ?? null);

    const resultJson =
        updates.result_json !== undefined
            ? updates.result_json
                ? JSON.stringify(updates.result_json)
                : null
            : row.result_json;

    const promptTemplateArtifactId =
        updates.prompt_template_artifact_id !== undefined
            ? updates.prompt_template_artifact_id
                ? String(updates.prompt_template_artifact_id)
                : null
            : (row.prompt_template_artifact_id ?? null);

    const latestAttemptId =
        updates.latest_attempt_id !== undefined
            ? updates.latest_attempt_id
                ? String(updates.latest_attempt_id)
                : null
            : (row.latest_attempt_id ?? null);

    const latestRenderedPromptArtifactId =
        updates.latest_rendered_prompt_artifact_id !== undefined
            ? updates.latest_rendered_prompt_artifact_id
                ? String(updates.latest_rendered_prompt_artifact_id)
                : null
            : (row.latest_rendered_prompt_artifact_id ?? null);

    const latestResponseV2JsonArtifactId =
        updates.latest_response_v2_json_artifact_id !== undefined
            ? updates.latest_response_v2_json_artifact_id
                ? String(updates.latest_response_v2_json_artifact_id)
                : null
            : (row.latest_response_v2_json_artifact_id ?? null);

    const tx = db.transaction(() => {
        const result = db
            .prepare(
                `
            UPDATE tasks SET
                mission_id = @mission_id,
                parent_id = @parent_id,
                workflow_id = @workflow_id,
                stage = @stage,
                status = @status,
                priority = @priority,
                target = @target,
                model = @model,
                execute_after_ms = @execute_after_ms,
                attempts = @attempts,
                last_error = @last_error,
                last_correlation_id = @last_correlation_id,
                spec_user_message = @spec_user_message,
                spec_system_message = @spec_system_message,
                task_json = @task_json,
                result_json = @result_json,
                prompt_template_artifact_id = @prompt_template_artifact_id,
                latest_attempt_id = @latest_attempt_id,
                latest_rendered_prompt_artifact_id = @latest_rendered_prompt_artifact_id,
                latest_response_v2_json_artifact_id = @latest_response_v2_json_artifact_id,
                updated_at_ms = @updated_at_ms,
                started_at_ms = @started_at_ms,
                completed_at_ms = @completed_at_ms,
                paused_at_ms = @paused_at_ms,
                cancelled_at_ms = @cancelled_at_ms,
                failed_at_ms = @failed_at_ms,
                blocked_reason = @blocked_reason,
                blocked_at_ms = @blocked_at_ms,
                blocked_details_json = @blocked_details_json
            WHERE id = @id AND updated_at_ms = @expected_version
        `
            )
            .run({
                id: taskId,
                expected_version: expectedVersion,
                mission_id: nextMissionId,
                parent_id: nextParentId ? String(nextParentId) : null,
                workflow_id: nextWorkflowId ? String(nextWorkflowId) : null,
                stage: nextStage,
                status: nextStatus,
                priority: nextPriority,
                target: nextTarget,
                model: nextModel,
                execute_after_ms: nextExecuteAfterMs,
                attempts,
                last_error: lastError,
                last_correlation_id: lastCorrelationId,
                spec_user_message: nextSpecUser,
                spec_system_message: nextSpecSystem,
                task_json: nextTaskJson,
                result_json: resultJson,
                prompt_template_artifact_id: promptTemplateArtifactId,
                latest_attempt_id: latestAttemptId,
                latest_rendered_prompt_artifact_id: latestRenderedPromptArtifactId,
                latest_response_v2_json_artifact_id: latestResponseV2JsonArtifactId,
                updated_at_ms: now,
                started_at_ms: startedAtMs,
                completed_at_ms: completedAtMs,
                paused_at_ms: pausedAtMs,
                cancelled_at_ms: cancelledAtMs,
                failed_at_ms: failedAtMs,
                blocked_reason: blockedReason,
                blocked_at_ms: blockedAtMs,
                blocked_details_json: blockedDetailsJson,
            });

        // Optimistic locking: check if update actually happened
        if (result.changes === 0) {
            // Version conflict detected
            return { conflict: true };
        }

        if (nextDeps !== null) {
            db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
            if (nextDeps.length > 0) {
                const stmt = db.prepare(
                    'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)'
                );
                for (const depId of nextDeps) {
                    stmt.run(taskId, depId);
                }
            }
        }

        return { conflict: false };
    });

    const txResult = tx();

    // FIXED (P0-2.6): Throw em conflito permanente ao invés de retornar null
    if (txResult.conflict) {
        const MAX_RETRIES = 2; // 3 tentativas total (0, 1, 2)

        if (_retryCount < MAX_RETRIES) {
            return updateTask(taskId, updates, _retryCount + 1);
        }

        // Max retries exceeded - throw ao invés de retornar null
        const error = new Error(
            `Task ${taskId} update failed: version conflict after ${MAX_RETRIES + 1} attempts (OptimisticLockError)`
        );
        error.name = 'OptimisticLockError';

        throw error;
    }

    return getTaskById(taskId);
}

/**
 * Função exportada: setTaskStage.
 * @param {*} taskId
 * @param {*} stage
 * @returns {any}
 */
function setTaskStage(taskId, stage) {
    return updateTask(taskId, { stage });
}

/**
 * @typedef {*} SetTaskStatusExtra
 */
/**
 * Função exportada: setTaskStatus.
 * @param {*} taskId
 * @param {*} status
 * @param {SetTaskStatusExtra} [extra]
 * @returns {any}
 */
function setTaskStatus(taskId, status, extra = {}) {
    return updateTask(taskId, { status, ...extra });
}

/**
 * @typedef {*} ClaimNextEligibleTaskParams
 */
/**
 * @typedef {*} ClaimNextEligibleTaskOptions
 */
/**
 * Atomically claims next eligible task (READY + PENDING).
 * @param {ClaimNextEligibleTaskParams} params - Parameters
 * @returns {object|null} { task, row } or null
 */
function claimNextEligibleTask({ workerId, nowMs = _now(), lockTtlMs = 60000 }) {
    if (!workerId) {
        throw new Error('claimNextEligibleTask requer workerId');
    }

    const db = getDb();

    const tx = db.transaction(() => {
        // Atomic claim with re-validation of dependencies in UPDATE clause
        const updated = db
            .prepare(
                `
                WITH eligible AS (
                    SELECT t.id
                    FROM tasks t
                    LEFT JOIN missions m ON m.id = t.mission_id
                    WHERE t.stage = 'READY'
                      AND t.status = 'PENDING'
                      AND (t.execute_after_ms IS NULL OR t.execute_after_ms <= @now)
                      AND (t.lock_expires_at_ms IS NULL OR t.lock_expires_at_ms <= @now)
                      AND (t.mission_id IS NULL OR m.status = 'RUNNING')
                      AND NOT EXISTS (
                        SELECT 1
                        FROM task_dependencies d
                        LEFT JOIN tasks parent ON parent.id = d.depends_on_task_id
                        WHERE d.task_id = t.id
                          AND (parent.id IS NULL OR parent.status != 'DONE')
                      )
                    ORDER BY t.priority DESC, t.created_at_ms ASC
                    LIMIT 1
                )
                UPDATE tasks
                SET locked_by = @workerId,
                    locked_at_ms = @now,
                    lock_expires_at_ms = @expires,
                    updated_at_ms = @now
                WHERE id IN (SELECT id FROM eligible)
                  AND stage = 'READY'
                  AND status = 'PENDING'
                  AND (lock_expires_at_ms IS NULL OR lock_expires_at_ms <= @now)
                  -- Re-validate dependencies atomically within UPDATE
                  AND NOT EXISTS (
                    SELECT 1
                    FROM task_dependencies d
                    LEFT JOIN tasks parent ON parent.id = d.depends_on_task_id
                    WHERE d.task_id = tasks.id
                      AND (parent.id IS NULL OR parent.status != 'DONE')
                  )
            `
            )
            .run({
                workerId,
                now: nowMs,
                expires: nowMs + Math.max(1000, Number(lockTtlMs) || 60000),
            });

        if (!updated || updated.changes !== 1) {
            return null;
        }

        // Retrieve the claimed task
        const claimed = db.prepare('SELECT * FROM tasks WHERE locked_by = @workerId AND locked_at_ms = @now').get({
            workerId,
            now: nowMs,
        });

        return claimed ? /** @type {TaskRow} */ (claimed) : null;
    });

    const claimed = tx();
    if (!claimed) {
        return null;
    }

    return {
        row: claimed,
        task: _rowToTask(/** @type {TaskRow} */ (claimed)),
    };
}

/**
 * @typedef {object} ReleaseTaskLockParams
 * @property {string} taskId
 */
/**
 * Releases the lock on a task.
 * @param {ReleaseTaskLockParams} params - Parameters
 * @returns {any}
 */
function releaseTaskLock(
    /** @type {{ taskId: string, workerId?: string, expectedAttemptId?: string }} */ {
        taskId,
        workerId,
        expectedAttemptId,
    }
) {
    const db = getDb();
    const now = _now();
    const res = db
        .prepare(
            `
            UPDATE tasks
            SET locked_by = NULL,
                locked_at_ms = NULL,
                lock_expires_at_ms = NULL,
                updated_at_ms = @now
            WHERE id = @id
              AND (@workerId IS NULL OR locked_by = @workerId)
              AND (
                @expectedAttemptId IS NULL OR
                latest_attempt_id = @expectedAttemptId OR
                last_correlation_id = @expectedAttemptId
              )
        `
        )
        .run({ id: taskId, workerId: workerId || null, expectedAttemptId: expectedAttemptId || null, now });
    return res.changes || 0;
}

/**
 * @typedef {object} ExtendTaskLockParams
 * @property {string} taskId
 * @property {string} workerId
 */
/**
 * Extends the lock on a task.
 * @param {ExtendTaskLockParams} params - Parameters
 * @returns {any}
 */
function extendTaskLock(
    /** @type {{ taskId: string, workerId: string, nowMs?: number, lockTtlMs?: number }} */ {
        taskId,
        workerId,
        nowMs = _now(),
        lockTtlMs = 60000,
    }
) {
    const db = getDb();
    const res = db
        .prepare(
            `
            UPDATE tasks
            SET lock_expires_at_ms = @expires,
                updated_at_ms = @now
            WHERE id = @id
              AND lock_expires_at_ms IS NOT NULL
              AND (@workerId IS NULL OR locked_by = @workerId)
        `
        )
        .run({
            id: taskId,
            workerId: workerId || null,
            now: nowMs,
            expires: nowMs + Math.max(1000, Number(lockTtlMs) || 60000),
        });
    return res.changes || 0;
}

/**
 * Função exportada: retryFailedTasks.
 * @returns {any}
 */
function retryFailedTasks() {
    const db = getDb();
    const now = _now();
    const res = db
        .prepare(
            `
            UPDATE tasks
            SET status = 'PENDING',
                last_error = NULL,
                failed_at_ms = NULL,
                updated_at_ms = @now
            WHERE status = 'FAILED'
        `
        )
        .run({ now });
    return res.changes || 0;
}

/**
 * Função exportada: incrementTaskAttempts.
 * @param {*} taskId
 * @param {*} [delta]
 * @returns {any}
 */
function incrementTaskAttempts(taskId, delta = 1) {
    const db = getDb();
    const now = _now();
    const d = Number(delta) || 0;
    const res = db
        .prepare(
            `
            UPDATE tasks
            SET attempts = MAX(0, attempts + @delta),
                updated_at_ms = @now
            WHERE id = @id
        `
        )
        .run({ id: taskId, delta: d, now });
    return res.changes || 0;
}

/**
 * Função exportada: clearQueuePreserveRunning.
 * @returns {any}
 */
function clearQueuePreserveRunning() {
    const db = getDb();
    const _runResult = db.prepare("SELECT COUNT(1) AS c FROM tasks WHERE status = 'RUNNING'").get();
    const running = (/** @type {any} */ (_runResult))?.c || 0;
    const res = db.prepare("DELETE FROM tasks WHERE status != 'RUNNING'").run();
    return { deleted: res.changes || 0, preserved: running };
}

/**
 * Função exportada: purgeTask.
 * @param {*} taskId
 * @returns {any}
 */
function purgeTask(taskId) {
    const db = getDb();
    const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    return res.changes || 0;
}

export {
    claimNextEligibleTask,
    clearQueuePreserveRunning,
    countTasks,
    countTasksByStatus,
    extendTaskLock,
    getTaskById,
    getTaskDependencies,
    incrementTaskAttempts,
    insertTask,
    listTasks,
    purgeTask,
    releaseTaskLock,
    retryFailedTasks,
    setTaskStage,
    setTaskStatus,
    TASK_STAGES,
    updateTask,
};
