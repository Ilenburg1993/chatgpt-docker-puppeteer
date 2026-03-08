// @ts-check
/** @typedef {any} InferenceModel */
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
    } catch {
        return fallback;
    }
}

/**
 * @param {any} raw
 * @param {any} fallback
 */
function _parseJson(raw, fallback) {
    if (raw == null) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

/**
 * @param {any} row
 * @param {any} row
 */
function _rowToModel(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        backend_id: String(row.backend_id),
        model_name: String(row.model_name),
        alias: String(row.alias),
        enabled: Number(row.enabled) === 1,
        capabilities_json: _parseJson(row.capabilities_json, {}),
        resource_profile_json: _parseJson(row.resource_profile_json, {}),
        safety_profile_json: _parseJson(row.safety_profile_json, {}),
        default_params_json: _parseJson(row.default_params_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * @param {any} id
 * @param {any} enabled
 */
function _setModelEnabled(id, enabled) {
    const db = getDb();
    const targetId = String(id || '').trim();
    if (!targetId) return null;
    const existing = db.prepare('SELECT * FROM inference_models WHERE id = ?').get(targetId);
    if (!existing) return null;
    db.prepare('UPDATE inference_models SET enabled = ?, updated_at_ms = ? WHERE id = ?').run(
        enabled ? 1 : 0,
        _now(),
        targetId,
    );
    return getInferenceModelById(targetId);
}

/** @typedef {any} UpsertInferenceModelInput */
/**
 * Função exportada: upsertInferenceModel.
 *
 * @param {any} [input]
 * @returns {InferenceModel | null}
 */
function upsertInferenceModel(input = {}) {
    const db = getDb();
    const now = _now();
    const existing = /** @type {any} */ (
        input.id
            ? db.prepare('SELECT * FROM inference_models WHERE id = ?').get(String(input.id))
            : input.alias
              ? db.prepare('SELECT * FROM inference_models WHERE alias = ?').get(String(input.alias))
              : null
    );
    const id = existing?.id || `infm-${uuidv4()}`;
    const alias = String(input.alias || existing?.alias || '').trim();
    const modelName = String(input.model_name || input.modelName || existing?.model_name || '').trim();
    const backendId = String(input.backend_id || input.backendId || existing?.backend_id || '').trim();
    if (!alias) throw new Error('inference model alias obrigatório');
    if (!modelName) throw new Error('inference model model_name obrigatório');
    if (!backendId) throw new Error('inference model backend_id obrigatório');

    db.prepare(
        `
        INSERT INTO inference_models (
            id, backend_id, model_name, alias, enabled, capabilities_json, resource_profile_json, safety_profile_json, default_params_json, created_at_ms, updated_at_ms
        ) VALUES (
            @id, @backend_id, @model_name, @alias, @enabled, @capabilities_json, @resource_profile_json, @safety_profile_json, @default_params_json, @created_at_ms, @updated_at_ms
        )
        ON CONFLICT(id) DO UPDATE SET
            backend_id = excluded.backend_id,
            model_name = excluded.model_name,
            alias = excluded.alias,
            enabled = excluded.enabled,
            capabilities_json = excluded.capabilities_json,
            resource_profile_json = excluded.resource_profile_json,
            safety_profile_json = excluded.safety_profile_json,
            default_params_json = excluded.default_params_json,
            updated_at_ms = excluded.updated_at_ms
    `,
    ).run({
        id,
        backend_id: backendId,
        model_name: modelName,
        alias,
        enabled: input.enabled === undefined ? Number(existing?.enabled ?? 1) : input.enabled ? 1 : 0,
        capabilities_json: _safeJsonString(input.capabilities_json ?? input.capabilities ?? {}),
        resource_profile_json: _safeJsonString(input.resource_profile_json ?? input.resource_profile ?? {}),
        safety_profile_json: _safeJsonString(input.safety_profile_json ?? input.safety_profile ?? {}),
        default_params_json: _safeJsonString(input.default_params_json ?? input.default_params ?? {}),
        created_at_ms: Number(existing?.created_at_ms) || now,
        updated_at_ms: now,
    });
    return getInferenceModelById(id);
}

/**
 * Função exportada: getInferenceModelById.
 *
 * @param {string} id Unique identifier.
 * @returns {InferenceModel | null}
 */
function getInferenceModelById(id) {
    const db = getDb();
    return _rowToModel(db.prepare('SELECT * FROM inference_models WHERE id = ?').get(String(id || '').trim()));
}

/** @typedef {any} ListInferenceModelsOptions */
/**
 * Função exportada: listInferenceModels.
 *
 * @param {ListInferenceModelsOptions} [options]
 * @returns {InferenceModel[]}
 */
function listInferenceModels({ backendId = null, enabledOnly = false, limit = 200 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM inference_models
            WHERE (@backendId IS NULL OR backend_id = @backendId)
              AND (@enabledOnly = 0 OR enabled = 1)
            ORDER BY updated_at_ms DESC
            LIMIT @limit
        `,
        )
        .all({
            backendId: backendId ? String(backendId) : null,
            enabledOnly: enabledOnly ? 1 : 0,
            limit: Math.max(1, Math.min(Number(limit) || 200, 1000)),
        });
    return rows.map(_rowToModel).filter(Boolean);
}

/**
 * Função exportada: setInferenceModelEnabled.
 *
 * @param {string} id
 * @param {boolean} enabled
 * @returns {InferenceModel | null}
 */
function setInferenceModelEnabled(id, enabled) {
    return _setModelEnabled(id, Boolean(enabled));
}

export { getInferenceModelById, listInferenceModels, setInferenceModelEnabled, upsertInferenceModel };
