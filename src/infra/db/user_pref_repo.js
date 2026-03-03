// @ts-check
import { getDb } from './sqlite.js';

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

function _rowToPrefs(row) {
    if (!row) return null;
    return {
        user_id: String(row.user_id),
        layout: _parseJson(row.layout_json, {}),
        columns: _parseJson(row.columns_json, {}),
        filters: _parseJson(row.filters_json, {}),
        density: String(row.density || 'comfortable'),
        shortcuts: _parseJson(row.shortcuts_json, {}),
        alerts: _parseJson(row.alerts_json, {}),
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * Função exportada: getUserPreferences.
 * @param {*} userId
 * @returns {object|null}
 */
function getUserPreferences(userId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(String(userId || '').trim());
    return _rowToPrefs(row);
}

/**
 * @typedef {object} UpsertUserPreferencesUpdates
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Função exportada: upsertUserPreferences.
 * @param {*} userId
 * @param {UpsertUserPreferencesUpdates} [patch]
 * @returns {object|null}
 */
function upsertUserPreferences(userId, patch = {}) {
    const db = getDb();
    const id = String(userId || '').trim();
    if (!id) {
        throw new Error('user_id obrigatório');
    }

    const existing = getUserPreferences(id) || {
        user_id: id,
        layout: {},
        columns: {},
        filters: {},
        density: 'comfortable',
        shortcuts: {},
        alerts: {},
        updated_at_ms: 0,
    };

    const next = {
        ...existing,
        ...patch,
        layout: { ...(existing.layout || {}), ...(patch.layout || {}) },
        columns: { ...(existing.columns || {}), ...(patch.columns || {}) },
        filters: { ...(existing.filters || {}), ...(patch.filters || {}) },
        shortcuts: { ...(existing.shortcuts || {}), ...(patch.shortcuts || {}) },
        alerts: { ...(existing.alerts || {}), ...(patch.alerts || {}) },
        density: patch.density ? String(patch.density) : existing.density,
        updated_at_ms: _now(),
    };

    db.prepare(
        `
        INSERT INTO user_preferences (
            user_id, layout_json, columns_json, filters_json,
            density, shortcuts_json, alerts_json, updated_at_ms
        ) VALUES (
            @user_id, @layout_json, @columns_json, @filters_json,
            @density, @shortcuts_json, @alerts_json, @updated_at_ms
        )
        ON CONFLICT(user_id) DO UPDATE SET
            layout_json = excluded.layout_json,
            columns_json = excluded.columns_json,
            filters_json = excluded.filters_json,
            density = excluded.density,
            shortcuts_json = excluded.shortcuts_json,
            alerts_json = excluded.alerts_json,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        user_id: id,
        layout_json: _safeJsonString(next.layout),
        columns_json: _safeJsonString(next.columns),
        filters_json: _safeJsonString(next.filters),
        density: next.density,
        shortcuts_json: _safeJsonString(next.shortcuts),
        alerts_json: _safeJsonString(next.alerts),
        updated_at_ms: next.updated_at_ms,
    });

    return getUserPreferences(id);
}

export { getUserPreferences, upsertUserPreferences };
