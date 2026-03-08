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
 * @returns {InferenceClientPolicy | null}
 */
function _rowToPolicy(row) {
    if (!row) return null;
    const _row = /** @type {any} */ (row);
    return {
        id: String(_row.id),
        client_tag: String(_row.client_tag),
        enabled: Number(_row.enabled) === 1,
        profile_id: _row.profile_id ? String(_row.profile_id) : null,
        allowed_backends_json: _parseJson(_row.allowed_backends_json, []),
        allowed_models_json: _parseJson(_row.allowed_models_json, []),
        max_parallel: Number(_row.max_parallel) || 1,
        rate_limit_json: _parseJson(_row.rate_limit_json, {}),
        timeout_ms: _row.timeout_ms == null ? null : Number(_row.timeout_ms),
        token_budget_json: _parseJson(_row.token_budget_json, {}),
        priority: Number(_row.priority) || 50,
        degraded_behavior_json: _parseJson(_row.degraded_behavior_json, {}),
        approval_policy_json: _parseJson(_row.approval_policy_json, {}),
        created_at_ms: Number(_row.created_at_ms) || 0,
        updated_at_ms: Number(_row.updated_at_ms) || 0,
    };
}

/**
 * @typedef {object} InferenceClientPolicy
 * @property {string} id
 * @property {string} client_tag
 * @property {boolean} enabled
 * @property {string | null} profile_id
 * @property {any[]} allowed_backends_json
 * @property {any[]} allowed_models_json
 * @property {number} max_parallel
 * @property {object} rate_limit_json
 * @property {number | null} timeout_ms
 * @property {object} token_budget_json
 * @property {number} priority
 * @property {object} degraded_behavior_json
 * @property {object} approval_policy_json
 * @property {number} created_at_ms
 * @property {number} updated_at_ms
 */
/**
 * @typedef {object} UpsertInferenceClientPolicyInput
 * @property {string} [client_tag]
 * @property {string} [clientTag]
 * @property {boolean} [enabled]
 * @property {string | null} [profile_id]
 * @property {any} [allowed_backends_json]
 * @property {any} [allowed_backends]
 * @property {any} [allowed_models_json]
 * @property {any} [allowed_models]
 * @property {number} [max_parallel]
 * @property {any} [rate_limit_json]
 * @property {any} [rate_limit]
 * @property {number | null} [timeout_ms]
 * @property {any} [token_budget_json]
 * @property {any} [token_budget]
 * @property {number} [priority]
 * @property {any} [degraded_behavior_json]
 * @property {any} [degraded_behavior]
 * @property {any} [approval_policy_json]
 * @property {any} [approval_policy]
 */
/**
 * Função exportada: upsertInferenceClientPolicy.
 *
 * @param {UpsertInferenceClientPolicyInput} [input]
 * @returns {InferenceClientPolicy | null}
 */
function upsertInferenceClientPolicy(input = {}) {
    const db = getDb();
    const now = _now();
    const clientTag = String(input.client_tag || input.clientTag || '').trim();
    if (!clientTag) throw new Error('client_tag obrigatório');
    const existing = /** @type {any} */ (
        db.prepare('SELECT * FROM inference_client_policies WHERE client_tag = ?').get(clientTag)
    );
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
    `,
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
 *
 * @param {any} clientTag
 * @returns {InferenceClientPolicy | null}
 */
function getInferenceClientPolicyByTag(clientTag) {
    const db = getDb();
    return _rowToPolicy(
        db.prepare('SELECT * FROM inference_client_policies WHERE client_tag = ?').get(String(clientTag || '').trim()),
    );
}

/**
 * @typedef {object} ListInferenceClientPoliciesOptions
 * @property {any} [enabledOnly]
 * @property {any} [limit]
 */
/**
 * Função exportada: listInferenceClientPolicies.
 *
 * @param {ListInferenceClientPoliciesOptions} [options]
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
        `,
        )
        .all({ limit: Math.max(1, Math.min(Number(limit) || 100, 500)) });
    return rows
        .map(_rowToPolicy)
        .filter(/** @param {InferenceClientPolicy | null} x @returns {x is InferenceClientPolicy} */ (x) => x != null);
}

export { getInferenceClientPolicyByTag, listInferenceClientPolicies, upsertInferenceClientPolicy };
