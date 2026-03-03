// @ts-check
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

/** Constante/valor exportado: CONTROL_OPERATION_STATUS. */
const CONTROL_OPERATION_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    REJECTED: 'REJECTED',
});

function _now() {
    return Date.now();
}

function _safeJsonString(value, fallback = '{}') {
    try {
        return JSON.stringify(value ?? {});
    } catch (_) {
        return fallback;
    }
}

function _parseJson(raw, fallback = {}) {
    if (!raw) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch (_) {
        return fallback;
    }
}

function _rowToOperation(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        command: String(row.command),
        entity_type: String(row.entity_type),
        entity_id: String(row.entity_id),
        actor_id: row.actor_id ? String(row.actor_id) : null,
        actor_role: row.actor_role ? String(row.actor_role) : null,
        reason: String(row.reason || ''),
        idempotency_key: String(row.idempotency_key || ''),
        status: String(row.status || CONTROL_OPERATION_STATUS.PENDING),
        payload: _parseJson(row.payload_json, {}),
        result: _parseJson(row.result_json, null),
        error_code: row.error_code ? String(row.error_code) : null,
        error_message: row.error_message ? String(row.error_message) : null,
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * @typedef {object} CreateControlOperationOptions
 * @property {*} [command]
 * @property {*} [entityType]
 * @property {*} [entityId]
 * @property {*} [actorId]
 * @property {*} [actorRole]
 * @property {*} [reason]
 * @property {*} [idempotencyKey]
 * @property {*} [payload]
 */
/**
 * Função exportada: createControlOperation.
 * @param {CreateControlOperationOptions} [options]
 * @returns {ControlOperation|null}
 */
function createControlOperation({
    command,
    entityType,
    entityId,
    actorId = null,
    actorRole = null,
    reason,
    idempotencyKey,
    payload = {},
}) {
    const db = getDb();
    const now = _now();
    const id = `cop-${uuidv4()}`;

    db.prepare(
        `
        INSERT INTO control_operations (
            id, command, entity_type, entity_id,
            actor_id, actor_role, reason, idempotency_key,
            status, payload_json, result_json,
            error_code, error_message,
            created_at_ms, updated_at_ms
        ) VALUES (
            @id, @command, @entity_type, @entity_id,
            @actor_id, @actor_role, @reason, @idempotency_key,
            @status, @payload_json, NULL,
            NULL, NULL,
            @created_at_ms, @updated_at_ms
        )
    `
    ).run({
        id,
        command: String(command || '')
            .trim()
            .toUpperCase(),
        entity_type: String(entityType || '').trim(),
        entity_id: String(entityId || '').trim(),
        actor_id: actorId ? String(actorId) : null,
        actor_role: actorRole ? String(actorRole) : null,
        reason: String(reason || '').trim(),
        idempotency_key: String(idempotencyKey || '').trim(),
        status: CONTROL_OPERATION_STATUS.PENDING,
        payload_json: _safeJsonString(payload),
        created_at_ms: now,
        updated_at_ms: now,
    });

    return getControlOperationById(id);
}

/**
 * Função exportada: getControlOperationById.
 * @param {string} id Unique identifier.
 * @returns {ControlOperation|null}
 */
function getControlOperationById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM control_operations WHERE id = ?').get(String(id || '').trim());
    return _rowToOperation(row);
}

/**
 * Função exportada: getControlOperationByIdempotencyKey.
 * @param {*} idempotencyKey
 * @returns {ControlOperation|null}
 */
function getControlOperationByIdempotencyKey(idempotencyKey) {
    const db = getDb();
    const row = db
        .prepare('SELECT * FROM control_operations WHERE idempotency_key = ?')
        .get(String(idempotencyKey || '').trim());
    return _rowToOperation(row);
}

/**
 * @typedef {object} UpdateControlOperationUpdates
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Função exportada: updateControlOperation.
 * @param {string} id
 * @param {UpdateControlOperationUpdates} [updates]
 * @returns {ControlOperation|null}
 */
function updateControlOperation(id, updates = {}) {
    const db = getDb();
    const existing = getControlOperationById(id);
    if (!existing) return null;

    const now = _now();

    db.prepare(
        `
        UPDATE control_operations
        SET status = @status,
            result_json = @result_json,
            error_code = @error_code,
            error_message = @error_message,
            updated_at_ms = @updated_at_ms
        WHERE id = @id
    `
    ).run({
        id: existing.id,
        status: updates.status ? String(updates.status).trim().toUpperCase() : existing.status,
        result_json:
            updates.result !== undefined
                ? _safeJsonString(updates.result, 'null')
                : existing.result !== null
                  ? _safeJsonString(existing.result, 'null')
                  : null,
        error_code: updates.error_code !== undefined ? updates.error_code : existing.error_code,
        error_message: updates.error_message !== undefined ? updates.error_message : existing.error_message,
        updated_at_ms: now,
    });

    return getControlOperationById(existing.id);
}

/**
 * @typedef {object} ListControlOperationsOptions
 * @property {*} [limit]
 * @property {*} [entityType]
 * @property {*} [entityId]
 */
/**
 * Função exportada: listControlOperations.
 * @param {ListControlOperationsOptions} [options]
 * @returns {ControlOperation[]}
 */
function listControlOperations({ limit = 100, entityType = null, entityId = null } = {}) {
    const db = getDb();
    const where = [];
    const params = { limit: Math.max(1, Math.min(Number(limit) || 100, 500)) };

    if (entityType) {
        where.push('entity_type = @entity_type');
        params.entity_type = String(entityType).trim();
    }

    if (entityId) {
        where.push('entity_id = @entity_id');
        params.entity_id = String(entityId).trim();
    }

    const rows = db
        .prepare(
            `
            SELECT *
            FROM control_operations
            ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY created_at_ms DESC
            LIMIT @limit
        `
        )
        .all(params);

    return rows.map(_rowToOperation).filter(Boolean);
}

export {
    CONTROL_OPERATION_STATUS,
    createControlOperation,
    getControlOperationById,
    getControlOperationByIdempotencyKey,
    listControlOperations,
    updateControlOperation,
};
