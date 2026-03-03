// @ts-check
import { v4 as uuidv4 } from 'uuid';
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
function _parseJson(raw, fallback = {}) {
    if (raw == null) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}
function _rowToFinding(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        job_id: String(row.job_id),
        severity: String(row.severity || 'info'),
        category: String(row.category || 'generic'),
        title: String(row.title || ''),
        source: String(row.source || 'audit-agent'),
        contract_id: row.contract_id ? String(row.contract_id) : null,
        dedup_key: row.dedup_key ? String(row.dedup_key) : null,
        status: String(row.status || 'open'),
        evidence_json: _parseJson(row.evidence_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * Função exportada: upsertAuditFinding.
 * @returns {any}
 */
function upsertAuditFinding(input = {}) {
    const db = getDb();
    const now = _now();
    const id = String(input.id || `afnd-${uuidv4()}`);
    const jobId = String(input.job_id || '').trim();
    if (!jobId) throw new Error('job_id obrigatório');
    const dedupKey = input.dedup_key ? String(input.dedup_key) : null;

    if (dedupKey) {
        const existing = db
            .prepare('SELECT * FROM audit_job_findings WHERE job_id = ? AND dedup_key = ?')
            .get(jobId, dedupKey);
        if (existing) {
            db.prepare(
                `
                UPDATE audit_job_findings SET
                    severity=@severity, category=@category, title=@title, source=@source,
                    contract_id=@contract_id, status=@status, evidence_json=@evidence_json, updated_at_ms=@updated_at_ms
                WHERE id=@id
            `
            ).run({
                id: existing.id,
                severity: String(input.severity || existing.severity || 'info'),
                category: String(input.category || existing.category || 'generic'),
                title: String(input.title || existing.title || ''),
                source: String(input.source || existing.source || 'audit-agent'),
                contract_id: input.contract_id ? String(input.contract_id) : existing.contract_id,
                status: String(input.status || existing.status || 'open'),
                evidence_json: _safeJsonString(input.evidence_json ?? input.evidence ?? {}, '{}'),
                updated_at_ms: now,
            });
            return getAuditFindingById(String(existing.id));
        }
    }

    db.prepare(
        `
        INSERT INTO audit_job_findings (
            id, job_id, severity, category, title, source, contract_id, dedup_key, status, evidence_json, created_at_ms, updated_at_ms
        ) VALUES (
            @id, @job_id, @severity, @category, @title, @source, @contract_id, @dedup_key, @status, @evidence_json, @created_at_ms, @updated_at_ms
        )
    `
    ).run({
        id,
        job_id: jobId,
        severity: String(input.severity || 'info'),
        category: String(input.category || 'generic'),
        title: String(input.title || ''),
        source: String(input.source || 'audit-agent'),
        contract_id: input.contract_id ? String(input.contract_id) : null,
        dedup_key: dedupKey,
        status: String(input.status || 'open'),
        evidence_json: _safeJsonString(input.evidence_json ?? input.evidence ?? {}, '{}'),
        created_at_ms: now,
        updated_at_ms: now,
    });
    return getAuditFindingById(id);
}

/**
 * Função exportada: getAuditFindingById.
 * @returns {any}
 */
function getAuditFindingById(id) {
    const db = getDb();
    return _rowToFinding(db.prepare('SELECT * FROM audit_job_findings WHERE id = ?').get(String(id || '').trim()));
}

/**
 * Função exportada: listAuditFindingsByJobId.
 * @returns {any}
 */
function listAuditFindingsByJobId(jobId, { limit = 200 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM audit_job_findings
            WHERE job_id = ?
            ORDER BY created_at_ms DESC
            LIMIT ?
        `
        )
        .all(String(jobId || '').trim(), Math.max(1, Math.min(Number(limit) || 200, 1000)));
    return rows.map(_rowToFinding).filter(Boolean);
}

export { getAuditFindingById, listAuditFindingsByJobId, upsertAuditFinding };
