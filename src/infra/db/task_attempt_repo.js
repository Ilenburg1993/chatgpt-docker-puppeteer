// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

/**
 * @typedef {{
 *   id: string,
 *   task_id: string,
 *   mission_id?: string|null,
 *   status: string,
 *   worker_id?: string|null,
 *   created_at_ms?: number,
 *   started_at_ms?: number|null,
 *   ended_at_ms?: number|null,
 *   rendered_prompt_artifact_id?: string|null,
 *   response_text_artifact_id?: string|null,
 *   response_v2_json_artifact_id?: string|null,
 *   response_md_artifact_id?: string|null,
 *   response_html_artifact_id?: string|null,
 *   error?: string|null,
 *   driver_target?: string|null,
 *   model?: string|null,
 *   reason_class?: string|null,
 *   count_attempt?: number|null,
 *   last_heartbeat_at_ms?: number|null,
 *   reason_code?: string|null,
 *   cause_layer?: string|null,
 *   diagnostic_artifacts_json?: string|null,
 *   diagnosis_json?: string|null,
 * }} AttemptUpsert
 */

function upsertAttempt(input) {
    const db = getDb();
    const createdAtMs = Number.isFinite(Number(input?.created_at_ms)) ? Number(input.created_at_ms) : _now();
    const countAttemptRaw = input?.count_attempt;
    const countAttempt = Number.isFinite(Number(countAttemptRaw)) ? Number(countAttemptRaw) : 0;

    db.prepare(
        `
        INSERT INTO task_attempts (
            id, task_id, mission_id, status, worker_id,
            created_at_ms, started_at_ms, ended_at_ms,
            rendered_prompt_artifact_id,
            response_text_artifact_id, response_v2_json_artifact_id, response_md_artifact_id, response_html_artifact_id,
            error, driver_target, model,
            reason_class, count_attempt, last_heartbeat_at_ms,
            reason_code, cause_layer, diagnostic_artifacts_json, diagnosis_json
        ) VALUES (
            @id, @task_id, @mission_id, @status, @worker_id,
            @created_at_ms, @started_at_ms, @ended_at_ms,
            @rendered_prompt_artifact_id,
            @response_text_artifact_id, @response_v2_json_artifact_id, @response_md_artifact_id, @response_html_artifact_id,
            @error, @driver_target, @model,
            @reason_class, @count_attempt, @last_heartbeat_at_ms,
            @reason_code, @cause_layer, @diagnostic_artifacts_json, @diagnosis_json
        )
        ON CONFLICT(id) DO UPDATE SET
            task_id = excluded.task_id,
            mission_id = excluded.mission_id,
            status = excluded.status,
            worker_id = excluded.worker_id,
            started_at_ms = COALESCE(excluded.started_at_ms, task_attempts.started_at_ms),
            ended_at_ms = COALESCE(excluded.ended_at_ms, task_attempts.ended_at_ms),
            rendered_prompt_artifact_id = COALESCE(excluded.rendered_prompt_artifact_id, task_attempts.rendered_prompt_artifact_id),
            response_text_artifact_id = COALESCE(excluded.response_text_artifact_id, task_attempts.response_text_artifact_id),
            response_v2_json_artifact_id = COALESCE(excluded.response_v2_json_artifact_id, task_attempts.response_v2_json_artifact_id),
            response_md_artifact_id = COALESCE(excluded.response_md_artifact_id, task_attempts.response_md_artifact_id),
            response_html_artifact_id = COALESCE(excluded.response_html_artifact_id, task_attempts.response_html_artifact_id),
            error = COALESCE(excluded.error, task_attempts.error),
            driver_target = COALESCE(excluded.driver_target, task_attempts.driver_target),
            model = COALESCE(excluded.model, task_attempts.model),
            reason_class = COALESCE(excluded.reason_class, task_attempts.reason_class),
            count_attempt = COALESCE(excluded.count_attempt, task_attempts.count_attempt),
            last_heartbeat_at_ms = COALESCE(excluded.last_heartbeat_at_ms, task_attempts.last_heartbeat_at_ms),
            reason_code = COALESCE(excluded.reason_code, task_attempts.reason_code),
            cause_layer = COALESCE(excluded.cause_layer, task_attempts.cause_layer),
            diagnostic_artifacts_json = COALESCE(excluded.diagnostic_artifacts_json, task_attempts.diagnostic_artifacts_json),
            diagnosis_json = COALESCE(excluded.diagnosis_json, task_attempts.diagnosis_json)
    `
    ).run({
        id: String(input.id),
        task_id: String(input.task_id),
        mission_id: input.mission_id ? String(input.mission_id) : null,
        status: String(input.status),
        worker_id: input.worker_id ? String(input.worker_id) : null,
        created_at_ms: createdAtMs,
        started_at_ms: input.started_at_ms ?? null,
        ended_at_ms: input.ended_at_ms ?? null,
        rendered_prompt_artifact_id: input.rendered_prompt_artifact_id ?? null,
        response_text_artifact_id: input.response_text_artifact_id ?? null,
        response_v2_json_artifact_id: input.response_v2_json_artifact_id ?? null,
        response_md_artifact_id: input.response_md_artifact_id ?? null,
        response_html_artifact_id: input.response_html_artifact_id ?? null,
        error: input.error ? String(input.error).slice(0, 2000) : null,
        driver_target: input.driver_target ? String(input.driver_target) : null,
        model: input.model ? String(input.model) : null,
        reason_class: input.reason_class ? String(input.reason_class) : null,
        count_attempt: countAttempt,
        last_heartbeat_at_ms: input.last_heartbeat_at_ms ?? null,
        reason_code: input.reason_code ? String(input.reason_code) : null,
        cause_layer: input.cause_layer ? String(input.cause_layer) : null,
        diagnostic_artifacts_json: input.diagnostic_artifacts_json ? String(input.diagnostic_artifacts_json) : null,
        diagnosis_json: input.diagnosis_json ? String(input.diagnosis_json) : null,
    });
}

function updateAttempt(attemptId, updates = {}) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM task_attempts WHERE id = ?').get(attemptId);
    if (!existing) return null;

    const next = { ...existing, ...updates };
    upsertAttempt(next);
    return db.prepare('SELECT * FROM task_attempts WHERE id = ?').get(attemptId) || null;
}

function getAttemptById(attemptId) {
    const db = getDb();
    return db.prepare('SELECT * FROM task_attempts WHERE id = ?').get(attemptId) || null;
}

function listAttemptsByTask(taskId, { limit = 200 } = {}) {
    const db = getDb();
    const lim = Math.max(1, Math.min(Number(limit) || 200, 2000));
    return db
        .prepare(
            `
            SELECT *
            FROM task_attempts
            WHERE task_id = ?
            ORDER BY created_at_ms DESC
            LIMIT ?
        `
        )
        .all(taskId, lim);
}

export { upsertAttempt, updateAttempt, getAttemptById, listAttemptsByTask };
