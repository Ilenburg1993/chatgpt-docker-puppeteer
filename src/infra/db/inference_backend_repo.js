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

function _rowToBackend(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        name: String(row.name),
        kind: String(row.kind),
        enabled: Number(row.enabled) === 1,
        base_url: row.base_url ? String(row.base_url) : null,
        auth_ref: row.auth_ref ? String(row.auth_ref) : null,
        health_policy_json: _parseJson(row.health_policy_json, {}),
        transport_policy_json: _parseJson(row.transport_policy_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

function _setBackendEnabled(id, enabled) {
    const db = getDb();
    const targetId = String(id || '').trim();
    if (!targetId) return null;
    const existing = db.prepare('SELECT * FROM inference_backends WHERE id = ?').get(targetId);
    if (!existing) return null;
    db.prepare('UPDATE inference_backends SET enabled = ?, updated_at_ms = ? WHERE id = ?').run(
        enabled ? 1 : 0,
        _now(),
        targetId
    );
    return getInferenceBackendById(targetId);
}

/** Função exportada: upsertInferenceBackend. */
function upsertInferenceBackend(input = {}) {
    const db = getDb();
    const now = _now();
    const existing = input.id
        ? db.prepare('SELECT * FROM inference_backends WHERE id = ?').get(String(input.id))
        : input.name
          ? db.prepare('SELECT * FROM inference_backends WHERE name = ?').get(String(input.name))
          : null;
    const id = existing?.id || `infb-${uuidv4()}`;
    const name = String(input.name || existing?.name || '').trim();
    const kind = String(input.kind || existing?.kind || '').trim();
    if (!name) throw new Error('inference backend name obrigatório');
    if (!kind) throw new Error('inference backend kind obrigatório');

    db.prepare(
        `
        INSERT INTO inference_backends (
            id, name, kind, enabled, base_url, auth_ref, health_policy_json, transport_policy_json, created_at_ms, updated_at_ms
        ) VALUES (
            @id, @name, @kind, @enabled, @base_url, @auth_ref, @health_policy_json, @transport_policy_json, @created_at_ms, @updated_at_ms
        )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            enabled = excluded.enabled,
            base_url = excluded.base_url,
            auth_ref = excluded.auth_ref,
            health_policy_json = excluded.health_policy_json,
            transport_policy_json = excluded.transport_policy_json,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        id,
        name,
        kind,
        enabled: input.enabled === undefined ? Number(existing?.enabled ?? 1) : input.enabled ? 1 : 0,
        base_url: input.base_url ?? existing?.base_url ?? null,
        auth_ref: input.auth_ref ?? existing?.auth_ref ?? null,
        health_policy_json: _safeJsonString(input.health_policy_json ?? input.health_policy ?? {}),
        transport_policy_json: _safeJsonString(input.transport_policy_json ?? input.transport_policy ?? {}),
        created_at_ms: Number(existing?.created_at_ms) || now,
        updated_at_ms: now,
    });
    return getInferenceBackendById(id);
}

/** Função exportada: getInferenceBackendById. */
function getInferenceBackendById(id) {
    const db = getDb();
    return _rowToBackend(db.prepare('SELECT * FROM inference_backends WHERE id = ?').get(String(id || '').trim()));
}

/** Função exportada: listInferenceBackends. */
function listInferenceBackends({ enabledOnly = false, limit = 100 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM inference_backends
            ${enabledOnly ? 'WHERE enabled = 1' : ''}
            ORDER BY updated_at_ms DESC
            LIMIT @limit
        `
        )
        .all({ limit: Math.max(1, Math.min(Number(limit) || 100, 500)) });
    return rows.map(_rowToBackend).filter(Boolean);
}

/** Função exportada: setInferenceBackendEnabled. */
function setInferenceBackendEnabled(id, enabled) {
    return _setBackendEnabled(id, Boolean(enabled));
}

export { getInferenceBackendById, listInferenceBackends, setInferenceBackendEnabled, upsertInferenceBackend };
