// @ts-check
import { v4 as uuidv4 } from 'uuid';
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
function _parseJson(raw, fallback = {}) {
    if (raw == null) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

/**
 * @typedef {object} AuditPatch
 * @property {string} id
 * @property {string} job_id
 * @property {string} status
 * @property {string} patch_unified_diff
 * @property {Record<string, any>} patch_summary_json
 * @property {number | null} risk_score
 * @property {any} dry_run_result_json
 * @property {boolean} approval_required
 * @property {string | null} approved_by
 * @property {number | null} approved_at_ms
 * @property {string | null} applied_by
 * @property {number | null} applied_at_ms
 * @property {string | null} rollback_patch
 * @property {number} created_at_ms
 * @property {number} updated_at_ms
 */

/**
 * @param {Record<string, any> | null | undefined} row
 * @returns {AuditPatch | null}
 */
function _rowToPatch(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        job_id: String(row.job_id),
        status: String(row.status || 'draft'),
        patch_unified_diff: String(row.patch_unified_diff || ''),
        patch_summary_json: _parseJson(row.patch_summary_json, {}),
        risk_score: row.risk_score == null ? null : Number(row.risk_score),
        dry_run_result_json: _parseJson(row.dry_run_result_json, null),
        approval_required: Number(row.approval_required) === 1,
        approved_by: row.approved_by ? String(row.approved_by) : null,
        approved_at_ms: row.approved_at_ms == null ? null : Number(row.approved_at_ms),
        applied_by: row.applied_by ? String(row.applied_by) : null,
        applied_at_ms: row.applied_at_ms == null ? null : Number(row.applied_at_ms),
        rollback_patch: row.rollback_patch ? String(row.rollback_patch) : null,
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * @param {string} id
 * @param {Record<string, any>} [fields]
 * @returns {AuditPatch | null}
 */
function _updatePatch(id, fields = {}) {
    const db = getDb();
    const now = _now();
    const existing = /** @type {Record<string, any> | null} */ (
        db.prepare('SELECT * FROM audit_patch_proposals WHERE id = ?').get(String(id || '').trim())
    );
    if (!existing) return null;

    db.prepare(
        `
        UPDATE audit_patch_proposals SET
            status = @status,
            patch_unified_diff = @patch_unified_diff,
            patch_summary_json = @patch_summary_json,
            risk_score = @risk_score,
            dry_run_result_json = @dry_run_result_json,
            approval_required = @approval_required,
            approved_by = @approved_by,
            approved_at_ms = @approved_at_ms,
            applied_by = @applied_by,
            applied_at_ms = @applied_at_ms,
            rollback_patch = @rollback_patch,
            updated_at_ms = @updated_at_ms
        WHERE id = @id
    `,
    ).run({
        id: existing.id,
        status: String(fields.status ?? existing.status ?? 'draft'),
        patch_unified_diff: String(fields.patch_unified_diff ?? existing.patch_unified_diff ?? ''),
        patch_summary_json: _safeJsonString(
            fields.patch_summary_json ?? fields.patch_summary ?? _parseJson(existing.patch_summary_json, {}),
            '{}',
        ),
        risk_score: fields.risk_score == null ? existing.risk_score : Number(fields.risk_score),
        dry_run_result_json:
            fields.dry_run_result_json === undefined
                ? existing.dry_run_result_json
                : _safeJsonString(fields.dry_run_result_json, 'null'),
        approval_required:
            fields.approval_required === undefined ? existing.approval_required : fields.approval_required ? 1 : 0,
        approved_by: fields.approved_by === undefined ? existing.approved_by : fields.approved_by,
        approved_at_ms: fields.approved_at_ms === undefined ? existing.approved_at_ms : fields.approved_at_ms,
        applied_by: fields.applied_by === undefined ? existing.applied_by : fields.applied_by,
        applied_at_ms: fields.applied_at_ms === undefined ? existing.applied_at_ms : fields.applied_at_ms,
        rollback_patch: fields.rollback_patch === undefined ? existing.rollback_patch : fields.rollback_patch,
        updated_at_ms: now,
    });
    return getAuditPatchProposalById(existing.id);
}

/**
 * @typedef {object} CreateAuditPatchProposalInput
 * @property {string} [id]
 * @property {string} job_id
 * @property {string} [status]
 * @property {string} [patch_unified_diff]
 * @property {Record<string, any>} [patch_summary_json]
 * @property {Record<string, any>} [patch_summary]
 * @property {number | null} [risk_score]
 * @property {any} [dry_run_result_json]
 * @property {boolean} [approval_required]
 * @property {string} [approved_by]
 * @property {number | null} [approved_at_ms]
 * @property {string} [applied_by]
 * @property {number | null} [applied_at_ms]
 * @property {string | undefined} [rollback_patch]
 */
/**
 * Função exportada: createAuditPatchProposal.
 *
 * @param {CreateAuditPatchProposalInput} input Input data for the AuditPatch record.
 * @returns {AuditPatch | null}
 */
function createAuditPatchProposal(input = /** @type {CreateAuditPatchProposalInput} */ ({})) {
    const db = getDb();
    const id = String(input.id || `apch-${uuidv4()}`);
    const now = _now();
    db.prepare(
        `
        INSERT INTO audit_patch_proposals (
            id, job_id, status, patch_unified_diff, patch_summary_json, risk_score, dry_run_result_json,
            approval_required, approved_by, approved_at_ms, applied_by, applied_at_ms, rollback_patch,
            created_at_ms, updated_at_ms
        ) VALUES (
            @id, @job_id, @status, @patch_unified_diff, @patch_summary_json, @risk_score, @dry_run_result_json,
            @approval_required, @approved_by, @approved_at_ms, @applied_by, @applied_at_ms, @rollback_patch,
            @created_at_ms, @updated_at_ms
        )
    `,
    ).run({
        id,
        job_id: String(input.job_id || '').trim(),
        status: String(input.status || 'draft'),
        patch_unified_diff: String(input.patch_unified_diff || ''),
        patch_summary_json: _safeJsonString(input.patch_summary_json ?? input.patch_summary ?? {}, '{}'),
        risk_score: input.risk_score == null ? null : Number(input.risk_score),
        dry_run_result_json:
            input.dry_run_result_json !== undefined ? _safeJsonString(input.dry_run_result_json, 'null') : null,
        approval_required: input.approval_required === false ? 0 : 1,
        approved_by: input.approved_by ? String(input.approved_by) : null,
        approved_at_ms: input.approved_at_ms == null ? null : Number(input.approved_at_ms),
        applied_by: input.applied_by ? String(input.applied_by) : null,
        applied_at_ms: input.applied_at_ms == null ? null : Number(input.applied_at_ms),
        rollback_patch: input.rollback_patch ? String(input.rollback_patch) : null,
        created_at_ms: now,
        updated_at_ms: now,
    });
    return getAuditPatchProposalById(id);
}

/**
 * Função exportada: getAuditPatchProposalById.
 *
 * @param {string} id Unique identifier.
 * @returns {AuditPatch | null}
 */
function getAuditPatchProposalById(id) {
    const db = getDb();
    return _rowToPatch(
        /** @type {Record<string, any> | null} */ (
            db.prepare('SELECT * FROM audit_patch_proposals WHERE id = ?').get(String(id || '').trim())
        ),
    );
}

/**
 * @typedef {object} ListAuditPatchProposalsByJobIdOptions
 * @property {number} [limit]
 */
/**
 * Função exportada: listAuditPatchProposalsByJobId.
 *
 * @param {string} jobId
 * @param {ListAuditPatchProposalsByJobIdOptions} [options]
 * @returns {AuditPatch[]}
 */
function listAuditPatchProposalsByJobId(jobId, { limit = 50 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM audit_patch_proposals
            WHERE job_id = ?
            ORDER BY created_at_ms DESC
            LIMIT ?
        `,
        )
        .all(String(jobId || '').trim(), Math.max(1, Math.min(Number(limit) || 50, 500)));
    return /** @type {AuditPatch[]} */ (/** @type {Record<string, any>[]} */ (rows).map(_rowToPatch).filter(Boolean));
}

/**
 * @typedef {object} UpdateAuditPatchProposalFields
 * @property {string} [status]
 * @property {string} [patch_unified_diff]
 * @property {Record<string, any>} [patch_summary_json]
 * @property {Record<string, any>} [patch_summary]
 * @property {number | null} [risk_score]
 * @property {any} [dry_run_result_json]
 * @property {boolean} [approval_required]
 * @property {string | null} [approved_by]
 * @property {number | null} [approved_at_ms]
 * @property {string | null} [applied_by]
 * @property {number | null} [applied_at_ms]
 * @property {string | null} [rollback_patch]
 */
/**
 * Função exportada: updateAuditPatchProposal.
 *
 * @param {string} id
 * @param {UpdateAuditPatchProposalFields} [fields]
 * @returns {AuditPatch | null}
 */
function updateAuditPatchProposal(id, fields = {}) {
    return _updatePatch(id, fields);
}

export {
    createAuditPatchProposal,
    getAuditPatchProposalById,
    listAuditPatchProposalsByJobId,
    updateAuditPatchProposal,
};
