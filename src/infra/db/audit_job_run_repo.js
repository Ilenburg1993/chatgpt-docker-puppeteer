// @ts-check
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

function _safeJsonString(value, fallback = '{}') {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return fallback;
    }
}

function _parseJson(raw, fallback = null) {
    if (raw === null || raw === undefined) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

function _rowToRun(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        job_id: String(row.job_id),
        attempt_seq: Number(row.attempt_seq) || 0,
        status: String(row.status || ''),
        executor: String(row.executor || 'audit-agent'),
        llm_model: row.llm_model ? String(row.llm_model) : null,
        llm_provider: row.llm_provider ? String(row.llm_provider) : null,
        token_usage_json: _parseJson(row.token_usage_json, null),
        metrics_json: _parseJson(row.metrics_json, null),
        error_json: _parseJson(row.error_json, null),
        started_at_ms: Number(row.started_at_ms) || 0,
        completed_at_ms: row.completed_at_ms == null ? null : Number(row.completed_at_ms),
    };
}

/**
 * Função exportada: createAuditJobRun.
 * @param {object} input Input data for the AuditJobRun record.
 * @returns {AuditJobRun|null}
 */
function createAuditJobRun(input = {}) {
    const db = getDb();
    db.prepare(
        `
        INSERT INTO audit_job_runs (
            id, job_id, attempt_seq, status, executor,
            llm_model, llm_provider, token_usage_json, metrics_json, error_json,
            started_at_ms, completed_at_ms
        ) VALUES (
            @id, @job_id, @attempt_seq, @status, @executor,
            @llm_model, @llm_provider, @token_usage_json, @metrics_json, @error_json,
            @started_at_ms, @completed_at_ms
        )
    `
    ).run({
        id: String(input.id || '').trim(),
        job_id: String(input.job_id || '').trim(),
        attempt_seq: Number(input.attempt_seq) || 0,
        status: String(input.status || 'RUNNING')
            .trim()
            .toUpperCase(),
        executor: String(input.executor || 'audit-agent'),
        llm_model: input.llm_model ? String(input.llm_model) : null,
        llm_provider: input.llm_provider ? String(input.llm_provider) : null,
        token_usage_json: input.token_usage_json !== undefined ? _safeJsonString(input.token_usage_json, 'null') : null,
        metrics_json: input.metrics_json !== undefined ? _safeJsonString(input.metrics_json, 'null') : null,
        error_json: input.error_json !== undefined ? _safeJsonString(input.error_json, 'null') : null,
        started_at_ms: Number(input.started_at_ms) || _now(),
        completed_at_ms: input.completed_at_ms == null ? null : Number(input.completed_at_ms),
    });
    return getAuditJobRunById(String(input.id));
}

/**
 * Função exportada: getAuditJobRunById.
 * @param {string} id Unique identifier.
 * @returns {AuditJobRun|null}
 */
function getAuditJobRunById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM audit_job_runs WHERE id = ?').get(String(id || '').trim());
    return _rowToRun(row);
}

/**
 * Função exportada: updateAuditJobRun.
 * @returns {AuditJobRun|null}
 */
function updateAuditJobRun(id, updates = {}) {
    const existing = getAuditJobRunById(id);
    if (!existing) return null;
    const db = getDb();
    db.prepare(
        `
        UPDATE audit_job_runs SET
            status = @status,
            llm_model = @llm_model,
            llm_provider = @llm_provider,
            token_usage_json = @token_usage_json,
            metrics_json = @metrics_json,
            error_json = @error_json,
            completed_at_ms = @completed_at_ms
        WHERE id = @id
    `
    ).run({
        id: existing.id,
        status: updates.status ? String(updates.status).trim().toUpperCase() : existing.status,
        llm_model:
            updates.llm_model !== undefined
                ? updates.llm_model
                    ? String(updates.llm_model)
                    : null
                : existing.llm_model,
        llm_provider:
            updates.llm_provider !== undefined
                ? updates.llm_provider
                    ? String(updates.llm_provider)
                    : null
                : existing.llm_provider,
        token_usage_json:
            updates.token_usage_json !== undefined
                ? _safeJsonString(updates.token_usage_json, 'null')
                : existing.token_usage_json !== null
                  ? _safeJsonString(existing.token_usage_json, 'null')
                  : null,
        metrics_json:
            updates.metrics_json !== undefined
                ? _safeJsonString(updates.metrics_json, 'null')
                : existing.metrics_json !== null
                  ? _safeJsonString(existing.metrics_json, 'null')
                  : null,
        error_json:
            updates.error_json !== undefined
                ? _safeJsonString(updates.error_json, 'null')
                : existing.error_json !== null
                  ? _safeJsonString(existing.error_json, 'null')
                  : null,
        completed_at_ms:
            updates.completed_at_ms !== undefined
                ? updates.completed_at_ms == null
                    ? null
                    : Number(updates.completed_at_ms)
                : existing.completed_at_ms,
    });
    return getAuditJobRunById(existing.id);
}

/**
 * Função exportada: listAuditJobRunsByJobId.
 * @returns {AuditJobRun[]}
 */
function listAuditJobRunsByJobId(jobId, { limit = 50 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM audit_job_runs
            WHERE job_id = ?
            ORDER BY started_at_ms DESC
            LIMIT ?
        `
        )
        .all(String(jobId || '').trim(), Math.max(1, Math.min(Number(limit) || 50, 500)));
    return rows.map(_rowToRun).filter(Boolean);
}

export { createAuditJobRun, getAuditJobRunById, listAuditJobRunsByJobId, updateAuditJobRun };
