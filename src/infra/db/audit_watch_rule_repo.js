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
function _rowToRule(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        enabled: Number(row.enabled) === 1,
        name: String(row.name || ''),
        trigger_type: String(row.trigger_type || ''),
        scope_json: _parseJson(row.scope_json, {}),
        schedule_cron: row.schedule_cron ? String(row.schedule_cron) : null,
        debounce_ms: Number(row.debounce_ms) || 5000,
        cooldown_ms: Number(row.cooldown_ms) || 30000,
        action_policy_json: _parseJson(row.action_policy_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/** Função exportada: getAuditWatchRuleById. */
function getAuditWatchRuleById(id) {
    const db = getDb();
    return _rowToRule(db.prepare('SELECT * FROM audit_watch_rules WHERE id = ?').get(String(id || '').trim()));
}

/** Função exportada: listAuditWatchRules. */
function listAuditWatchRules({ enabledOnly = false, limit = 100 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM audit_watch_rules
            ${enabledOnly ? 'WHERE enabled = 1' : ''}
            ORDER BY updated_at_ms DESC
            LIMIT @limit
        `
        )
        .all({ limit: Math.max(1, Math.min(Number(limit) || 100, 500)) });
    return rows.map(_rowToRule).filter(Boolean);
}

/** Função exportada: upsertAuditWatchRule. */
function upsertAuditWatchRule(input = {}) {
    const db = getDb();
    const now = _now();
    const existing = input.id ? db.prepare('SELECT * FROM audit_watch_rules WHERE id = ?').get(String(input.id)) : null;
    const id = existing?.id || `awr-${uuidv4()}`;
    db.prepare(
        `
        INSERT INTO audit_watch_rules (
            id, enabled, name, trigger_type, scope_json, schedule_cron, debounce_ms, cooldown_ms, action_policy_json, created_at_ms, updated_at_ms
        ) VALUES (
            @id, @enabled, @name, @trigger_type, @scope_json, @schedule_cron, @debounce_ms, @cooldown_ms, @action_policy_json, @created_at_ms, @updated_at_ms
        )
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            name = excluded.name,
            trigger_type = excluded.trigger_type,
            scope_json = excluded.scope_json,
            schedule_cron = excluded.schedule_cron,
            debounce_ms = excluded.debounce_ms,
            cooldown_ms = excluded.cooldown_ms,
            action_policy_json = excluded.action_policy_json,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        id,
        enabled: input.enabled === false ? 0 : 1,
        name: String(input.name || existing?.name || 'watch-rule'),
        trigger_type: String(input.trigger_type || existing?.trigger_type || 'manual'),
        scope_json: _safeJsonString(input.scope_json ?? input.scope ?? {}, '{}'),
        schedule_cron: input.schedule_cron ?? existing?.schedule_cron ?? null,
        debounce_ms: Math.max(0, Number(input.debounce_ms ?? existing?.debounce_ms ?? 5000) || 5000),
        cooldown_ms: Math.max(0, Number(input.cooldown_ms ?? existing?.cooldown_ms ?? 30000) || 30000),
        action_policy_json: _safeJsonString(input.action_policy_json ?? input.action_policy ?? {}, '{}'),
        created_at_ms: Number(existing?.created_at_ms) || now,
        updated_at_ms: now,
    });
    return _rowToRule(db.prepare('SELECT * FROM audit_watch_rules WHERE id = ?').get(id));
}

export { getAuditWatchRuleById, listAuditWatchRules, upsertAuditWatchRule };
