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

function _rowToPolicy(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        client_tag: String(row.client_tag),
        enabled: Number(row.enabled) === 1,
        profile_id: row.profile_id ? String(row.profile_id) : null,
        allowed_backends_json: _parseJson(row.allowed_backends_json, []),
        allowed_models_json: _parseJson(row.allowed_models_json, []),
        max_parallel: Number(row.max_parallel) || 1,
        rate_limit_json: _parseJson(row.rate_limit_json, {}),
        timeout_ms: row.timeout_ms == null ? null : Number(row.timeout_ms),
        token_budget_json: _parseJson(row.token_budget_json, {}),
        priority: Number(row.priority) || 50,
        degraded_behavior_json: _parseJson(row.degraded_behavior_json, {}),
        approval_policy_json: _parseJson(row.approval_policy_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * Função exportada: upsertInferenceClientPolicy.
 * @returns {InferenceClientPolicy|null}
 */
function upsertInferenceClientPolicy(input = {}) {
    const db = getDb();
    const now = _now();
    const clientTag = String(input.client_tag || input.clientTag || '').trim();
    if (!clientTag) throw new Error('client_tag obrigatório');
    const existing = db.prepare('SELECT * FROM inference_client_policies WHERE client_tag = ?').get(clientTag);
    const id = existing?.id || `infcp-${uuidv4()}`;
    db.prepare(
        `
        INSERT INTO inference_client_policies (
            id, client_tag, enabled, profile_id,
            allowed_backends_json, allowed_models_json, max_parallel, rate_limit_json,
            timeout_ms, token_budget_json, priority, degraded_behavior_json, approval_policy_json,
            created_at_ms, updated_at_ms
        ) VALUES (
            @id, @client_tag, @enabled, @profile_id,
            @allowed_backends_json, @allowed_models_json, @max_parallel, @rate_limit_json,
            @timeout_ms, @token_budget_json, @priority, @degraded_behavior_json, @approval_policy_json,
            @created_at_ms, @updated_at_ms
        )
        ON CONFLICT(client_tag) DO UPDATE SET
            enabled = excluded.enabled,
            profile_id = excluded.profile_id,
            allowed_backends_json = excluded.allowed_backends_json,
            allowed_models_json = excluded.allowed_models_json,
            max_parallel = excluded.max_parallel,
            rate_limit_json = excluded.rate_limit_json,
            timeout_ms = excluded.timeout_ms,
            token_budget_json = excluded.token_budget_json,
            priority = excluded.priority,
            degraded_behavior_json = excluded.degraded_behavior_json,
            approval_policy_json = excluded.approval_policy_json,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        id,
        client_tag: clientTag,
        enabled: input.enabled === undefined ? Number(existing?.enabled ?? 1) : input.enabled ? 1 : 0,
        profile_id: input.profile_id ?? existing?.profile_id ?? null,
        allowed_backends_json: _safeJsonString(input.allowed_backends_json ?? input.allowed_backends ?? []),
        allowed_models_json: _safeJsonString(input.allowed_models_json ?? input.allowed_models ?? []),
        max_parallel: Math.max(1, Number(input.max_parallel ?? existing?.max_parallel ?? 1) || 1),
        rate_limit_json: _safeJsonString(input.rate_limit_json ?? input.rate_limit ?? {}),
        timeout_ms:
            input.timeout_ms === undefined
                ? (existing?.timeout_ms ?? null)
                : input.timeout_ms == null
                  ? null
                  : Number(input.timeout_ms),
        token_budget_json: _safeJsonString(input.token_budget_json ?? input.token_budget ?? {}),
        priority: Number(input.priority ?? existing?.priority ?? 50) || 50,
        degraded_behavior_json: _safeJsonString(input.degraded_behavior_json ?? input.degraded_behavior ?? {}),
        approval_policy_json: _safeJsonString(input.approval_policy_json ?? input.approval_policy ?? {}),
        created_at_ms: Number(existing?.created_at_ms) || now,
        updated_at_ms: now,
    });
    return getInferenceClientPolicyByTag(clientTag);
}

/**
 * Função exportada: getInferenceClientPolicyByTag.
 * @returns {InferenceClientPolicy|null}
 */
function getInferenceClientPolicyByTag(clientTag) {
    const db = getDb();
    return _rowToPolicy(
        db.prepare('SELECT * FROM inference_client_policies WHERE client_tag = ?').get(String(clientTag || '').trim())
    );
}

/**
 * Função exportada: listInferenceClientPolicies.
 * @returns {InferenceClientPolicy[]}
 */
function listInferenceClientPolicies({ enabledOnly = false, limit = 100 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT * FROM inference_client_policies
            ${enabledOnly ? 'WHERE enabled = 1' : ''}
            ORDER BY priority DESC, updated_at_ms DESC
            LIMIT @limit
        `
        )
        .all({ limit: Math.max(1, Math.min(Number(limit) || 100, 500)) });
    return rows.map(_rowToPolicy).filter(Boolean);
}

export { getInferenceClientPolicyByTag, listInferenceClientPolicies, upsertInferenceClientPolicy };
