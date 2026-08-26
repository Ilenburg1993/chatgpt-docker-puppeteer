// @ts-check
/**
 * Model Gateway SQLite schema bootstrap and historical data-migration owner.
 *
 * Reopening the current schema must be a semantic no-op after CREATE IF NOT EXISTS. Historical backfills execute only
 * while advancing from an older user_version; replaying them on every store construction would create false external
 * `data_version` changes and invalidate operational readiness snapshots.
 *
 * @module copilot/model-gateway/catalog/sqlite-schema-migration
 */

import {
    MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
} from '#copilot/infra/public/database/sqlite/model-gateway-schema';

/** @typedef {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} SqliteDatabasePort */

/** @param {unknown} value @returns {number | null} */
function optionalInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}

/** @param {unknown} value @returns {string | null} */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {SqliteDatabasePort} db */
export function readModelGatewaySqliteUserVersion(db) {
    const row = /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA user_version').get());
    return optionalInteger(row?.['user_version']) ?? 0;
}

/** @param {SqliteDatabasePort} db @param {string} table @param {string} column */
function sqliteTableHasColumn(db, table, column) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        return optionalString(/** @type {Record<string, unknown>} */ (row)['name']) === column;
    });
}

/**
 * Initialize the schema and apply historical data migrations exactly once per schema-generation advance.
 *
 * @param {SqliteDatabasePort} db
 * @returns {{ fromVersion:number; toVersion:number; migrated:boolean }}
 */
export function initializeModelGatewaySqliteSchema(db) {
    const fromVersion = readModelGatewaySqliteUserVersion(db);
    if (fromVersion > MODEL_GATEWAY_SQLITE_SCHEMA_VERSION) {
        throw new Error(
            `[model-gateway/sqlite] database schema version ${fromVersion} is newer than supported version ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION}`,
        );
    }

    db.exec(MODEL_GATEWAY_SQLITE_SCHEMA_SQL);
    if (fromVersion >= MODEL_GATEWAY_SQLITE_SCHEMA_VERSION) {
        return { fromVersion, toVersion: MODEL_GATEWAY_SQLITE_SCHEMA_VERSION, migrated: false };
    }

    if (fromVersion < 14) {
        db.exec(`
            DELETE FROM copilot_model_gateway_runtime_health_latest;
            INSERT INTO copilot_model_gateway_runtime_health_latest
                (provider_id, provider_model, route_profile, observation_key, observed_at_ms)
            SELECT provider_id, provider_model, route_profile, observation_key, observed_at_ms
            FROM (
                SELECT provider_id, provider_model, route_profile, observation_key, observed_at_ms,
                       ROW_NUMBER() OVER (
                           PARTITION BY provider_id, provider_model, route_profile
                           ORDER BY observed_at_ms DESC, observation_key DESC
                       ) AS row_number
                FROM copilot_model_gateway_health_observations
            )
            WHERE row_number = 1;

            DELETE FROM copilot_model_gateway_runtime_probe_latest;
            INSERT INTO copilot_model_gateway_runtime_probe_latest
                (provider_id, provider_model, route_profile, probe_kind, result_key, observed_at_ms)
            SELECT provider_id, provider_model, route_profile, probe_kind, result_key, observed_at_ms
            FROM (
                SELECT provider_id, provider_model, route_profile, probe_kind, result_key, observed_at_ms,
                       ROW_NUMBER() OVER (
                           PARTITION BY provider_id, provider_model, route_profile, probe_kind
                           ORDER BY observed_at_ms DESC, result_key DESC
                       ) AS row_number
                FROM copilot_model_gateway_runtime_probe_results
            )
            WHERE row_number = 1;
        `);
    }

    const handoffColumns = /** @type {[string, string][]} */ ([
        ['operation_kind', "TEXT NOT NULL DEFAULT 'unknown'"],
        ['idempotency_key', 'TEXT'],
        ['provider_id', 'TEXT'],
        ['provider_model', 'TEXT'],
        ['defer_reason', 'TEXT'],
        ['promotion_policy', "TEXT NOT NULL DEFAULT 'manual_review'"],
        ['promotion_authorized', 'INTEGER NOT NULL DEFAULT 0'],
        ['expires_at_ms', 'INTEGER'],
    ]);
    for (const [column, definition] of handoffColumns) {
        if (sqliteTableHasColumn(db, 'copilot_model_gateway_sdk_session_handoffs', column)) continue;
        db.exec(`ALTER TABLE copilot_model_gateway_sdk_session_handoffs ADD COLUMN ${column} ${definition};`);
    }

    const confirmationColumns = /** @type {[string, string][]} */ ([
        ['previous_provider_id', 'TEXT'],
        ['provider_id', 'TEXT'],
        ['binding_strategy', "TEXT NOT NULL DEFAULT 'unknown'"],
        ['wire_api', 'TEXT'],
        ['selected_route_key', 'TEXT'],
        ['operation_state', 'TEXT'],
    ]);
    for (const [column, definition] of confirmationColumns) {
        if (sqliteTableHasColumn(db, 'copilot_model_gateway_sdk_session_confirmations', column)) continue;
        db.exec(`ALTER TABLE copilot_model_gateway_sdk_session_confirmations ADD COLUMN ${column} ${definition};`);
    }

    db.exec(`
        UPDATE copilot_model_gateway_sdk_session_handoffs
        SET operation_kind = COALESCE(NULLIF(json_extract(payload_json, '$.operation.schemaVersion'), ''), operation_kind),
            idempotency_key = COALESCE(NULLIF(json_extract(payload_json, '$.operation.idempotencyKey'), ''), idempotency_key),
            provider_id = COALESCE(NULLIF(json_extract(payload_json, '$.operation.targetRoute.providerId'), ''), provider_id),
            provider_model = COALESCE(
                NULLIF(json_extract(payload_json, '$.operation.targetRoute.providerModel'), ''),
                NULLIF(json_extract(payload_json, '$.operation.targetRoute.selectorSyntax'), ''),
                provider_model
            ),
            defer_reason = COALESCE(NULLIF(json_extract(payload_json, '$.operation.deferReason'), ''), defer_reason),
            promotion_policy = COALESCE(
                NULLIF(json_extract(payload_json, '$.operation.promotionAuthorization.policy'), ''),
                NULLIF(json_extract(payload_json, '$.operation.deferDetails.promotionAuthorization.policy'), ''),
                promotion_policy
            ),
            promotion_authorized = CASE
                WHEN json_extract(payload_json, '$.operation.promotionAuthorization.authorized') = 1
                  OR json_extract(payload_json, '$.operation.deferDetails.promotionAuthorization.authorized') = 1
                THEN 1 ELSE promotion_authorized
            END,
            expires_at_ms = COALESCE(
                CAST(strftime('%s', json_extract(payload_json, '$.operation.promotionAuthorization.expiresAt')) AS INTEGER) * 1000,
                CAST(strftime('%s', json_extract(payload_json, '$.operation.deferDetails.promotionAuthorization.expiresAt')) AS INTEGER) * 1000,
                expires_at_ms
            );
        CREATE INDEX IF NOT EXISTS idx_mg_sdk_session_handoffs_deferred_session
            ON copilot_model_gateway_sdk_session_handoffs(session_id, status, requested_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_mg_sdk_session_handoffs_idempotency
            ON copilot_model_gateway_sdk_session_handoffs(idempotency_key, requested_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_mg_sdk_session_handoffs_provider_route
            ON copilot_model_gateway_sdk_session_handoffs(provider_id, provider_model, selected_route_key, requested_at_ms DESC);

        UPDATE copilot_model_gateway_sdk_session_confirmations
        SET previous_provider_id = COALESCE(
                NULLIF(json_extract(payload_json, '$.previousProviderId'), ''),
                previous_provider_id
            ),
            provider_id = COALESCE(
                NULLIF(json_extract(payload_json, '$.providerId'), ''),
                NULLIF(json_extract(payload_json, '$.targetProviderId'), ''),
                NULLIF(json_extract(payload_json, '$.confirmedProviderId'), ''),
                provider_id
            ),
            binding_strategy = COALESCE(
                NULLIF(json_extract(payload_json, '$.bindingStrategy'), ''),
                binding_strategy
            ),
            wire_api = COALESCE(NULLIF(json_extract(payload_json, '$.wireApi'), ''), wire_api),
            selected_route_key = COALESCE(
                NULLIF(json_extract(payload_json, '$.selectedRouteKey'), ''),
                selected_route_key
            ),
            operation_state = COALESCE(
                NULLIF(json_extract(payload_json, '$.operationState'), ''),
                operation_state
            );
        CREATE INDEX IF NOT EXISTS idx_mg_sdk_session_confirmations_binding
            ON copilot_model_gateway_sdk_session_confirmations(
                previous_provider_id,
                provider_id,
                binding_strategy,
                wire_api,
                observed_at_ms DESC
            );
        CREATE INDEX IF NOT EXISTS idx_mg_sdk_session_confirmations_route
            ON copilot_model_gateway_sdk_session_confirmations(
                provider_id,
                selected_route_key,
                binding_strategy,
                wire_api,
                observed_at_ms DESC
            );
    `);

    if (!sqliteTableHasColumn(db, 'copilot_model_gateway_eligibility_decisions', 'selector_syntax')) {
        db.exec(`
            ALTER TABLE copilot_model_gateway_eligibility_decisions
                ADD COLUMN selector_syntax TEXT NOT NULL DEFAULT '';
        `);
    }
    db.exec(`
        DROP INDEX IF EXISTS idx_mg_eligibility_decisions_model;
        UPDATE copilot_model_gateway_eligibility_decisions
        SET selector_syntax = COALESCE(NULLIF(json_extract(payload_json, '$.selectorSyntax'), ''), provider_model)
        WHERE selector_syntax = '';
        CREATE INDEX IF NOT EXISTS idx_mg_eligibility_decisions_model
            ON copilot_model_gateway_eligibility_decisions(provider_id, provider_model, route_profile, selector_kind, selector_syntax);
    `);
    db.exec(`PRAGMA user_version = ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION}`);
    return { fromVersion, toVersion: MODEL_GATEWAY_SQLITE_SCHEMA_VERSION, migrated: true };
}
