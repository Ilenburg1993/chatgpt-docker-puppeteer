// @ts-check
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

function _now() {
    return Date.now();
}

/**
 * @param {any} value
 * @param {string} [fallback]
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
 * @returns {InferenceProfile|null}
 */
function _rowToProfile(row) {
    if (!row) return null;
    const _row = /** @type {any} */ (row);
    return {
        id: String(_row.id),
        name: String(_row.name),
        purpose: String(_row.purpose || ''),
        enabled: Number(_row.enabled) === 1,
        preferred_backend_id: _row.preferred_backend_id ? String(_row.preferred_backend_id) : null,
        preferred_model_id: _row.preferred_model_id ? String(_row.preferred_model_id) : null,
        fallback_chain_json: _parseJson(_row.fallback_chain_json, []),
        generation_params_json: _parseJson(_row.generation_params_json, {}),
        budget_policy_json: _parseJson(_row.budget_policy_json, {}),
        validation_policy_json: _parseJson(_row.validation_policy_json, {}),
        created_at_ms: Number(_row.created_at_ms) || 0,
        updated_at_ms: Number(_row.updated_at_ms) || 0,
    };
}

/**
 * @typedef {object} InferenceProfile
 * @property {string} id
 * @property {string} name
 * @property {string} purpose
 * @property {boolean} enabled
 * @property {string|null} preferred_backend_id
 * @property {string|null} preferred_model_id
 * @property {any[]} fallback_chain_json
 * @property {object} generation_params_json
 * @property {object} budget_policy_json
 * @property {object} validation_policy_json
 * @property {number} created_at_ms
 * @property {number} updated_at_ms
 */
/**
 * @typedef {object} UpsertInferenceProfileInput
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [purpose]
 * @property {boolean} [enabled]
 * @property {string|null} [preferred_backend_id]
 * @property {string|null} [preferred_model_id]
 * @property {any} [fallback_chain_json]
 * @property {any} [fallback_chain]
 * @property {any} [generation_params_json]
 * @property {any} [generation_params]
 * @property {any} [budget_policy_json]
 * @property {any} [budget_policy]
 * @property {any} [validation_policy_json]
 * @property {any} [validation_policy]
 */
/**
 * Função exportada: upsertInferenceProfile.
 * @param {UpsertInferenceProfileInput} [input]
 * @returns {InferenceProfile|null}
 */
function upsertInferenceProfile(input = {}) {
    const db = getDb();
    const now = _now();
    const existing = /** @type {any} */ (
        input.id
            ? db.prepare('SELECT * FROM inference_profiles WHERE id = ?').get(String(input.id))
            : input.name
              ? db.prepare('SELECT * FROM inference_profiles WHERE name = ?').get(String(input.name))
              : null
    );
    const id = existing?.id || `infprof-${uuidv4()}`;
    const name = String(input.name || existing?.name || '').trim();
    if (!name) throw new Error('inference profile name obrigatório');
    db.prepare(
        `
        INSERT INTO inference_profiles (
            id, name, purpose, enabled, preferred_backend_id, preferred_model_id,
            fallback_chain_json, generation_params_json, budget_policy_json, validation_policy_json,
            created_at_ms, updated_at_ms
        ) VALUES (
            @id, @name, @purpose, @enabled, @preferred_backend_id, @preferred_model_id,
            @fallback_chain_json, @generation_params_json, @budget_policy_json, @validation_policy_json,
            @created_at_ms, @updated_at_ms
        )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            purpose = excluded.purpose,
            enabled = excluded.enabled,
            preferred_backend_id = excluded.preferred_backend_id,
            preferred_model_id = excluded.preferred_model_id,
            fallback_chain_json = excluded.fallback_chain_json,
            generation_params_json = excluded.generation_params_json,
            budget_policy_json = excluded.budget_policy_json,
            validation_policy_json = excluded.validation_policy_json,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        id,
        name,
        purpose: String(input.purpose || existing?.purpose || ''),
        enabled: input.enabled === undefined ? Number(existing?.enabled ?? 1) : input.enabled ? 1 : 0,
        preferred_backend_id: input.preferred_backend_id ?? existing?.preferred_backend_id ?? null,
        preferred_model_id: input.preferred_model_id ?? existing?.preferred_model_id ?? null,
        fallback_chain_json: _safeJsonString(input.fallback_chain_json ?? input.fallback_chain ?? []),
        generation_params_json: _safeJsonString(input.generation_params_json ?? input.generation_params ?? {}),
        budget_policy_json: _safeJsonString(input.budget_policy_json ?? input.budget_policy ?? {}),
        validation_policy_json: _safeJsonString(input.validation_policy_json ?? input.validation_policy ?? {}),
        created_at_ms: Number(existing?.created_at_ms) || now,
        updated_at_ms: now,
    });
    return getInferenceProfileById(id);
}

/**
 * Função exportada: getInferenceProfileById.
 * @param {string} id Unique identifier.
 * @returns {InferenceProfile|null}
 */
function getInferenceProfileById(id) {
    const db = getDb();
    return _rowToProfile(db.prepare('SELECT * FROM inference_profiles WHERE id = ?').get(String(id || '').trim()));
}

/**
 * @typedef {object} ListInferenceProfilesOptions
 * @property {*} [enabledOnly]
 * @property {*} [limit]
 */
/**
 * Função exportada: listInferenceProfiles.
 * @param {ListInferenceProfilesOptions} [options]
 * @returns {InferenceProfile[]}
 */
function listInferenceProfiles({ enabledOnly = false, limit = 100 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM inference_profiles
            ${enabledOnly ? 'WHERE enabled = 1' : ''}
            ORDER BY updated_at_ms DESC
            LIMIT @limit
        `
        )
        .all({ limit: Math.max(1, Math.min(Number(limit) || 100, 500)) });
    return rows
        .map(_rowToProfile)
        .filter(/** @param {InferenceProfile|null} x @returns {x is InferenceProfile} */ x => x != null);
}

export { getInferenceProfileById, listInferenceProfiles, upsertInferenceProfile };
