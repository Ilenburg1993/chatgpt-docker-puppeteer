// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

/** Constante/valor exportado: MISSION_STATUS. */
const MISSION_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    READY: 'READY',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
});

/** Constante/valor exportado: AUTONOMY_MODES. */
const AUTONOMY_MODES = Object.freeze({
    USER_ONLY: 'USER_ONLY',
    LLM_SUGGEST: 'LLM_SUGGEST',
    LLM_CREATE_DRAFTS: 'LLM_CREATE_DRAFTS',
    LLM_AUTO_APPROVE_WITH_BUDGET: 'LLM_AUTO_APPROVE_WITH_BUDGET',
});

function _now() {
    return Date.now();
}

function _normalizePolicy(policy) {
    const base = {
        max_cost_usd_total: 10,
        max_tasks_total: 200,
        max_tasks_per_hour: 60,
        max_concurrent_tasks: 2,
        allowed_targets: ['auto', 'chatgpt'],
        require_user_approval_for_tags: ['external_call', 'bulk_write'],
        stop_conditions: { on_consecutive_failures: 5 },
    };
    if (!policy || typeof policy !== 'object') return base;
    return { ...base, ...policy };
}

/**
 * @param {{
 *   title?: string,
 *   description?: string,
 *   autonomy_mode?: string,
 *   policy?: Record<string, unknown>,
 *   context?: Record<string, unknown>
 * }} [input={}]
 */
function createMission({
    title,
    description = '',
    autonomy_mode = AUTONOMY_MODES.USER_ONLY,
    policy = {},
    context = {},
} = {}) {
    if (!title) {
        throw new Error('Mission title required');
    }

    const db = getDb();
    const now = _now();
    const id = `mission-${uuidv4()}`;

    const normalizedPolicy = _normalizePolicy(policy);
    const contextJson = JSON.stringify(context ?? {});

    db.prepare(
        `
        INSERT INTO missions
            (id, title, description, status, autonomy_mode, policy_json, context_json, created_at_ms, updated_at_ms, started_at_ms, completed_at_ms)
        VALUES
            (@id, @title, @description, @status, @autonomy_mode, @policy_json, @context_json, @created_at_ms, @updated_at_ms, NULL, NULL)
    `
    ).run({
        id,
        title: String(title),
        description: String(description || ''),
        status: MISSION_STATUS.READY,
        autonomy_mode,
        policy_json: JSON.stringify(normalizedPolicy),
        context_json: contextJson,
        created_at_ms: now,
        updated_at_ms: now,
    });

    return getMissionById(id);
}

/** Função exportada: listMissions. */
function listMissions({ status = null, limit = 500 } = {}) {
    const db = getDb();
    const sql = `
        SELECT *
        FROM missions
        ${status ? 'WHERE status = @status' : ''}
        ORDER BY created_at_ms DESC
        LIMIT @limit
    `;
    const rows = db.prepare(sql).all({
        status,
        limit: Math.max(1, Math.min(Number(limit) || 500, 5000)),
    });
    return rows.map(_rowToMission);
}

/** Função exportada: getMissionById. */
function getMissionById(missionId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId);
    return row ? _rowToMission(row) : null;
}

function _rowToMission(row) {
    // ✅ P1-20: Protect JSON.parse() from corrupted policy_json
    let policy = {};
    if (row.policy_json) {
        try {
            policy = JSON.parse(row.policy_json);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mission_repo] Invalid policy_json for mission ${row?.id}: ${msg}`);
            policy = {}; // Fallback to empty object
        }
    }

    // ✅ P1-20: Protect JSON.parse() from corrupted context_json
    let context = {};
    if (row.context_json) {
        try {
            context = JSON.parse(row.context_json);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mission_repo] Invalid context_json for mission ${row?.id}: ${msg}`);
            context = {}; // Fallback to empty object
        }
    }

    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        autonomy_mode: row.autonomy_mode,
        policy,
        context,
        created_at: new Date(row.created_at_ms).toISOString(),
        updated_at: new Date(row.updated_at_ms).toISOString(),
        started_at: row.started_at_ms ? new Date(row.started_at_ms).toISOString() : null,
        completed_at: row.completed_at_ms ? new Date(row.completed_at_ms).toISOString() : null,
    };
}

/** Função exportada: updateMission. */
function updateMission(missionId, updates = {}) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId);
    if (!existing) return null;

    const now = _now();
    const next = _rowToMission(existing);

    const status = updates.status ? String(updates.status).toUpperCase().trim() : next.status;
    const autonomy_mode = updates.autonomy_mode ? String(updates.autonomy_mode).trim() : next.autonomy_mode;
    const policy = updates.policy ? _normalizePolicy({ ...next.policy, ...updates.policy }) : next.policy;
    const context = updates.context ? { ...(next.context || {}), ...(updates.context || {}) } : next.context;

    const startedAtMs =
        updates.started_at_ms !== undefined
            ? updates.started_at_ms
                ? Number(updates.started_at_ms)
                : null
            : (existing.started_at_ms ?? null);
    const completedAtMs =
        updates.completed_at_ms !== undefined
            ? updates.completed_at_ms
                ? Number(updates.completed_at_ms)
                : null
            : (existing.completed_at_ms ?? null);

    db.prepare(
        `
        UPDATE missions SET
            title = @title,
            description = @description,
            status = @status,
            autonomy_mode = @autonomy_mode,
            policy_json = @policy_json,
            context_json = @context_json,
            updated_at_ms = @updated_at_ms,
            started_at_ms = @started_at_ms,
            completed_at_ms = @completed_at_ms
        WHERE id = @id
    `
    ).run({
        id: missionId,
        title: updates.title !== undefined ? String(updates.title) : existing.title,
        description: updates.description !== undefined ? String(updates.description || '') : existing.description,
        status,
        autonomy_mode,
        policy_json: JSON.stringify(policy),
        context_json: JSON.stringify(context ?? {}),
        updated_at_ms: now,
        started_at_ms: startedAtMs,
        completed_at_ms: completedAtMs,
    });

    return getMissionById(missionId);
}

/** Função exportada: deleteMission. */
function deleteMission(missionId) {
    const db = getDb();
    const res = db.prepare('DELETE FROM missions WHERE id = ?').run(missionId);
    return res.changes || 0;
}

export { MISSION_STATUS, AUTONOMY_MODES, createMission, listMissions, getMissionById, updateMission, deleteMission };
