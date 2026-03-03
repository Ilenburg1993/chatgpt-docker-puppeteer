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

function _parseJson(raw, fallback) {
    if (raw == null) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

function _rowToProfile(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        name: String(row.name),
        purpose: String(row.purpose || ''),
        enabled: Number(row.enabled) === 1,
        preferred_backend_id: row.preferred_backend_id ? String(row.preferred_backend_id) : null,
        preferred_model_id: row.preferred_model_id ? String(row.preferred_model_id) : null,
        fallback_chain_json: _parseJson(row.fallback_chain_json, []),
        generation_params_json: _parseJson(row.generation_params_json, {}),
        budget_policy_json: _parseJson(row.budget_policy_json, {}),
        validation_policy_json: _parseJson(row.validation_policy_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * Função exportada: upsertInferenceProfile.
 * @returns {InferenceProfile|null}
 */
function upsertInferenceProfile(input = {}) {
    const db = getDb();
    const now = _now();
    const existing = input.id
        ? db.prepare('SELECT * FROM inference_profiles WHERE id = ?').get(String(input.id))
        : input.name
          ? db.prepare('SELECT * FROM inference_profiles WHERE name = ?').get(String(input.name))
          : null;
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
 * Função exportada: listInferenceProfiles.
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
    return rows.map(_rowToProfile).filter(Boolean);
}

export { getInferenceProfileById, listInferenceProfiles, upsertInferenceProfile };
