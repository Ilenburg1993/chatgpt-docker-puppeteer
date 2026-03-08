// @ts-check
/** @typedef {any} AuditDiff */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

/**
 * @param {any} value
 * @param {any} value
 */
function _safeJsonString(value, fallback = '{}') {
    try {
        return JSON.stringify(value ?? {});
    } catch (/** @type {any} */ _) {
        return fallback;
    }
}

/**
 * @param {any} raw
 * @param {any} raw
 */
function _parseJson(raw, fallback = {}) {
    if (!raw) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch (/** @type {any} */ _) {
        return fallback;
    }
}

/**
 * @param {any} row
 * @param {any} row
 */
function _rowToAuditDiff(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        operation_id: String(row.operation_id),
        entity_type: String(row.entity_type),
        entity_id: String(row.entity_id),
        before: _parseJson(row.before_json, {}),
        after: _parseJson(row.after_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
    };
}

/**
 * @typedef {object} InsertAuditDiffOptions
 * @property {any} [operationId]
 * @property {any} [entityType]
 * @property {any} [entityId]
 * @property {any} [before]
 */
/**
 * Função exportada: insertAuditDiff.
 *
 * @param {any} options
 * @returns {AuditDiff | null}
 */
function insertAuditDiff({ operationId, entityType, entityId, before = {}, after = {} }) {
    const db = getDb();
    const id = `adf-${uuidv4()}`;
    const now = _now();

    db.prepare(
        `
        INSERT INTO audit_diffs (
            id, operation_id, entity_type, entity_id,
            before_json, after_json, created_at_ms
        ) VALUES (
            @id, @operation_id, @entity_type, @entity_id,
            @before_json, @after_json, @created_at_ms
        )
    `,
    ).run({
        id,
        operation_id: String(operationId || '').trim(),
        entity_type: String(entityType || '').trim(),
        entity_id: String(entityId || '').trim(),
        before_json: _safeJsonString(before),
        after_json: _safeJsonString(after),
        created_at_ms: now,
    });

    return getAuditDiffById(id);
}

/**
 * Função exportada: getAuditDiffById.
 *
 * @param {string} id Unique identifier.
 * @returns {AuditDiff | null}
 */
function getAuditDiffById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM audit_diffs WHERE id = ?').get(String(id || '').trim());
    return _rowToAuditDiff(row);
}

/**
 * Função exportada: listAuditDiffsByOperation.
 *
 * @param {any} operationId
 * @returns {AuditDiff[]}
 */
function listAuditDiffsByOperation(operationId) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT *
            FROM audit_diffs
            WHERE operation_id = ?
            ORDER BY created_at_ms ASC
        `,
        )
        .all(String(operationId || '').trim());

    return rows.map(_rowToAuditDiff).filter(Boolean);
}

/**
 * Função exportada: listAuditDiffsByEntity.
 *
 * @param {any} entityType
 * @param {any} entityId
 * @param {number} [limit]
 * @returns {AuditDiff[]}
 */
function listAuditDiffsByEntity(entityType, entityId, limit = 100) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT *
            FROM audit_diffs
            WHERE entity_type = ? AND entity_id = ?
            ORDER BY created_at_ms DESC
            LIMIT ?
        `,
        )
        .all(
            String(entityType || '').trim(),
            String(entityId || '').trim(),
            Math.max(1, Math.min(Number(limit) || 100, 500)),
        );

    return rows.map(_rowToAuditDiff).filter(Boolean);
}

export { getAuditDiffById, insertAuditDiff, listAuditDiffsByEntity, listAuditDiffsByOperation };
