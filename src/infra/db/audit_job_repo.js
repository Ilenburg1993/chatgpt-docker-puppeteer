// @ts-check
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function _safeJsonString(value, fallback = '{}') {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return fallback;
    }
}

/**
 * @param {unknown} raw
 * @param {unknown} [fallback]
 * @returns {any}
 */
function _parseJson(raw, fallback = null) {
    if (raw === null || raw === undefined) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

/**
 * @typedef {object} AuditJob
 * @property {string} id
 * @property {string} status
 * @property {string} kind
 * @property {number} priority
 * @property {string} trigger_type
 * @property {string | null} trigger_ref
 * @property {Record<string, any>} scope_json
 * @property {Record<string, any>} policy_json
 * @property {string | null} mission_id
 * @property {string | null} current_step
 * @property {string | null} created_by
 * @property {string | null} assigned_to
 * @property {number} attempt_seq
 * @property {any} result_json
 * @property {any} error_json
 * @property {number} created_at_ms
 * @property {number} updated_at_ms
 * @property {number | null} started_at_ms
 * @property {number | null} completed_at_ms
 */

/**
 * @param {Record<string, any> | null | undefined} row
 * @returns {AuditJob | null}
 */
function _rowToAuditJob(row) {
    if (!row) return null;
    return {
        id: String(row['id']),
        status: String(row['status']),
        kind: String(row['kind']),
        priority: Number(row['priority']) || 50,
        trigger_type: String(row['trigger_type'] || ''),
        trigger_ref: row['trigger_ref'] ? String(row['trigger_ref']) : null,
        scope_json: _parseJson(row['scope_json'], {}),
        policy_json: _parseJson(row['policy_json'], {}),
        mission_id: row['mission_id'] ? String(row['mission_id']) : null,
        current_step: row['current_step'] ? String(row['current_step']) : null,
        created_by: row['created_by'] ? String(row['created_by']) : null,
        assigned_to: row['assigned_to'] ? String(row['assigned_to']) : null,
        attempt_seq: Number(row['attempt_seq']) || 0,
        result_json: _parseJson(row['result_json'], null),
        error_json: _parseJson(row['error_json'], null),
        created_at_ms: Number(row['created_at_ms']) || 0,
        updated_at_ms: Number(row['updated_at_ms']) || 0,
        started_at_ms: row['started_at_ms'] == null ? null : Number(row['started_at_ms']),
        completed_at_ms: row['completed_at_ms'] == null ? null : Number(row['completed_at_ms']),
    };
}

/**
 * @typedef {object} CreateAuditJobInput
 * @property {string} [id]
 * @property {string} [status]
 * @property {string} [kind]
 * @property {number} [priority]
 * @property {string} [trigger_type]
 * @property {string} [trigger_ref]
 * @property {Record<string, any>} [scope_json]
 * @property {Record<string, any>} [scope]
 * @property {Record<string, any>} [policy_json]
 * @property {Record<string, any>} [policy]
 * @property {string} [mission_id]
 * @property {string} [current_step]
 * @property {string} [created_by]
 * @property {string} [assigned_to]
 * @property {number} [attempt_seq]
 * @property {any} [result_json]
 * @property {any} [error_json]
 * @property {number} [created_at_ms]
 * @property {number} [updated_at_ms]
 * @property {number | null} [started_at_ms]
 * @property {number | null} [completed_at_ms]
 */
/**
 * Função exportada: createAuditJob.
 *
 * @param {CreateAuditJobInput} [input]
 * @returns {AuditJob | null}
 */
function createAuditJob(input = /** @type {CreateAuditJobInput} */ ({})) {
    const db = getDb();
    const now = _now();
    db.prepare(
        `
        INSERT INTO audit_jobs (
            id, status, kind, priority, trigger_type, trigger_ref,
            scope_json, policy_json, mission_id, current_step,
            created_by, assigned_to, attempt_seq, result_json, error_json,
            created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
        ) VALUES (
            @id, @status, @kind, @priority, @trigger_type, @trigger_ref,
            @scope_json, @policy_json, @mission_id, @current_step,
            @created_by, @assigned_to, @attempt_seq, @result_json, @error_json,
            @created_at_ms, @updated_at_ms, @started_at_ms, @completed_at_ms
        )
    `,
    ).run({
        id: String(input.id || '').trim(),
        status: String(input.status || 'PENDING')
            .trim()
            .toUpperCase(),
        kind: String(input.kind || 'quick_audit').trim(),
        priority: Number(input.priority) || 50,
        trigger_type: String(input.trigger_type || 'manual').trim(),
        trigger_ref: input.trigger_ref ? String(input.trigger_ref) : null,
        scope_json: _safeJsonString(input.scope_json ?? input.scope ?? {}),
        policy_json: _safeJsonString(input.policy_json ?? input.policy ?? {}),
        mission_id: input.mission_id ? String(input.mission_id) : null,
        current_step: input.current_step ? String(input.current_step) : null,
        created_by: input.created_by ? String(input.created_by) : null,
        assigned_to: input.assigned_to ? String(input.assigned_to) : null,
        attempt_seq: Number(input.attempt_seq) || 0,
        result_json: input.result_json !== undefined ? _safeJsonString(input.result_json, 'null') : null,
        error_json: input.error_json !== undefined ? _safeJsonString(input.error_json, 'null') : null,
        created_at_ms: Number(input.created_at_ms) || now,
        updated_at_ms: Number(input.updated_at_ms) || now,
        started_at_ms: input.started_at_ms == null ? null : Number(input.started_at_ms),
        completed_at_ms: input.completed_at_ms == null ? null : Number(input.completed_at_ms),
    });
    return getAuditJobById(String(input.id));
}

/**
 * Função exportada: getAuditJobById.
 *
 * @param {string} id Unique identifier.
 * @returns {AuditJob | null}
 */
function getAuditJobById(id) {
    const db = getDb();
    const row = /** @type {Record<string, any> | null} */ (
        db.prepare('SELECT * FROM audit_jobs WHERE id = ?').get(String(id || '').trim())
    );
    return _rowToAuditJob(row);
}

/**
 * @typedef {object} ListAuditJobsOptions
 * @property {any} [status]
 * @property {any} [limit]
 */
/**
 * Função exportada: listAuditJobs.
 *
 * @param {ListAuditJobsOptions} [options]
 * @returns {AuditJob[]}
 */
function listAuditJobs({ status = null, limit = 100 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT *
            FROM audit_jobs
            ${status ? 'WHERE status = @status' : ''}
            ORDER BY updated_at_ms DESC
            LIMIT @limit
        `,
        )
        .all({
            status: status ? String(status) : null,
            limit: Math.max(1, Math.min(Number(limit) || 100, 500)),
        });
    return /** @type {AuditJob[]} */ (/** @type {Record<string, any>[]} */ (rows).map(_rowToAuditJob).filter(Boolean));
}

/**
 * @typedef {object} UpdateAuditJobUpdates
 * @property {string} [status]
 * @property {number} [priority]
 * @property {string} [trigger_ref]
 * @property {Record<string, any>} [scope_json]
 * @property {Record<string, any>} [scope]
 * @property {Record<string, any>} [policy_json]
 * @property {Record<string, any>} [policy]
 * @property {string} [mission_id]
 * @property {string} [current_step]
 * @property {string} [assigned_to]
 * @property {number} [attempt_seq]
 * @property {any} [result_json]
 * @property {any} [error_json]
 * @property {number | null} [started_at_ms]
 * @property {number | null} [completed_at_ms]
 */
/**
 * Função exportada: updateAuditJob.
 *
 * @param {string} id
 * @param {UpdateAuditJobUpdates} [updates]
 * @returns {AuditJob | null}
 */
function updateAuditJob(id, updates = {}) {
    const existing = getAuditJobById(id);
    if (!existing) return null;
    const db = getDb();
    const now = _now();
    db.prepare(
        `
        UPDATE audit_jobs SET
            status = @status,
            priority = @priority,
            trigger_ref = @trigger_ref,
            scope_json = @scope_json,
            policy_json = @policy_json,
            mission_id = @mission_id,
            current_step = @current_step,
            assigned_to = @assigned_to,
            attempt_seq = @attempt_seq,
            result_json = @result_json,
            error_json = @error_json,
            updated_at_ms = @updated_at_ms,
            started_at_ms = @started_at_ms,
            completed_at_ms = @completed_at_ms
        WHERE id = @id
    `,
    ).run({
        id: existing.id,
        status: updates.status ? String(updates.status).trim().toUpperCase() : existing.status,
        priority: updates.priority !== undefined ? Number(updates.priority) || existing.priority : existing.priority,
        trigger_ref:
            updates.trigger_ref !== undefined
                ? updates.trigger_ref
                    ? String(updates.trigger_ref)
                    : null
                : existing.trigger_ref,
        scope_json:
            updates.scope_json !== undefined || updates.scope !== undefined
                ? _safeJsonString(updates.scope_json ?? updates.scope ?? {}, '{}')
                : _safeJsonString(existing.scope_json, '{}'),
        policy_json:
            updates.policy_json !== undefined || updates.policy !== undefined
                ? _safeJsonString(updates.policy_json ?? updates.policy ?? {}, '{}')
                : _safeJsonString(existing.policy_json, '{}'),
        mission_id:
            updates.mission_id !== undefined
                ? updates.mission_id
                    ? String(updates.mission_id)
                    : null
                : existing.mission_id,
        current_step:
            updates.current_step !== undefined
                ? updates.current_step
                    ? String(updates.current_step)
                    : null
                : existing.current_step,
        assigned_to:
            updates.assigned_to !== undefined
                ? updates.assigned_to
                    ? String(updates.assigned_to)
                    : null
                : existing.assigned_to,
        attempt_seq: updates.attempt_seq !== undefined ? Number(updates.attempt_seq) || 0 : existing.attempt_seq,
        result_json:
            updates.result_json !== undefined
                ? _safeJsonString(updates.result_json, 'null')
                : existing.result_json !== null
                  ? _safeJsonString(existing.result_json, 'null')
                  : null,
        error_json:
            updates.error_json !== undefined
                ? _safeJsonString(updates.error_json, 'null')
                : existing.error_json !== null
                  ? _safeJsonString(existing.error_json, 'null')
                  : null,
        updated_at_ms: now,
        started_at_ms:
            updates.started_at_ms !== undefined
                ? updates.started_at_ms == null
                    ? null
                    : Number(updates.started_at_ms)
                : existing.started_at_ms,
        completed_at_ms:
            updates.completed_at_ms !== undefined
                ? updates.completed_at_ms == null
                    ? null
                    : Number(updates.completed_at_ms)
                : existing.completed_at_ms,
    });
    return getAuditJobById(existing.id);
}

/**
 * Função exportada: upsertAuditJobSnapshot.
 *
 * @param {any} job
 * @returns {AuditJob | null}
 */
function upsertAuditJobSnapshot(job) {
    const existing = getAuditJobById(job?.id);
    if (!existing) return createAuditJob(job);
    return updateAuditJob(job.id, job);
}

export { createAuditJob, getAuditJobById, listAuditJobs, updateAuditJob, upsertAuditJobSnapshot };
