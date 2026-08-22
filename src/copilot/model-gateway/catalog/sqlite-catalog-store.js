// @ts-check
/**
 * SQLite-backed universal catalog store.
 *
 * This is the first normalized durable store for the model-gateway catalog. The JSON snapshot remains useful for debug
 * and interchange, while this class writes the same redacted snapshot into separated relational layers.
 *
 * @module copilot/model-gateway/catalog/sqlite-catalog-store
 */

import { createHash } from 'node:crypto';

import { getApplicationSqliteDatabase } from '#copilot/boot/application-infra';
import {
    MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
    MODEL_GATEWAY_SQLITE_TABLES,
} from '#copilot/infra/public/database/sqlite/model-gateway-schema';
import { normalizeModelGatewayAccountLimitState } from '../account-access/limits.js';
import {
    auditModelGatewayValueRedaction,
    redactModelGatewayAuditedValue,
    redactSecretText,
    summarizeModelGatewayRedactionAudits,
} from '../secrets/index.js';
import { MODEL_GATEWAY_CATALOG_SCHEMA_VERSION } from './contracts.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { toOpenAIModelCatalogList } from './openai-schema.js';
import { parseModelGatewayRefreshLogText, summarizeModelGatewayRefreshLogEvents } from './refresh-logs.js';

const ACTIVE_SNAPSHOT_ID = 'active';
const DEFAULT_ROUTE_PROFILE = 'default';
const DEFAULT_ACCOUNT_SCOPE = 'default';
const DEFAULT_POLICY_PROFILE = 'default';
const DEFAULT_TASK_PROFILE = 'default';
let _runtimeHealthRunSequence = 0;
let _automationDecisionSequence = 0;
let _automationPolicySnapshotSequence = 0;
let _automationEffectSequence = 0;
let _recoveryAttemptSequence = 0;
let _sdkSessionHandoffSequence = 0;
let _sdkSessionConfirmationSequence = 0;
let _standbyPlanSequence = 0;
let _liveScenarioRunSequence = 0;
/** @typedef {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} SqliteDatabasePort */
/** @typedef {SqliteDatabasePort & { transaction: (operation: () => unknown) => () => unknown }} SqliteCatalogDatabase */
/** @type {WeakSet<SqliteCatalogDatabase>} */
const initializedSqliteCatalogDatabases = new WeakSet();

/** @param {SqliteDatabasePort} db @returns {SqliteCatalogDatabase} */
function requireCatalogDatabase(db) {
    if (typeof db.transaction !== 'function') {
        throw new TypeError('Model Gateway SQLite store requires a transactional database capability.');
    }
    return /** @type {SqliteCatalogDatabase} */ (db);
}

export const DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION = Object.freeze({
    accountHistoryMaxRowsPerTable: 10_000,
    accountQuotaSnapshotMaxRows: 20_000,
    accountRateLimitSnapshotMaxRows: 50_000,
    accountSpendingSnapshotMaxRows: 20_000,
    routeDecisionMaxRows: 50_000,
    automationDecisionMaxRows: 50_000,
    automationPolicySnapshotMaxRows: 50_000,
    automationEffectApplicationMaxRows: 50_000,
    recoveryAttemptMaxRows: 50_000,
    sdkSessionHandoffMaxRows: 50_000,
    sdkSessionHandoffTransitionMaxRows: 200000,
    sdkSessionConfirmationMaxRows: 50_000,
    standbyPlanMaxRows: 50_000,
    liveScenarioRunMaxRows: 50_000,
    refreshLogMaxRows: 200_000,
    runtimeProbeRunMaxRows: 10_000,
    runtimeProbeResultMaxRows: 100_000,
    healthObservationMaxRows: 100_000,
});

const DELETE_TABLES_IN_ORDER = Object.freeze([
    'copilot_model_gateway_eligibility_decisions',
    'copilot_model_gateway_eligibility_runs',
    'copilot_model_gateway_conflicts',
    'copilot_model_gateway_raw_payload_refs',
    'copilot_model_gateway_import_runs',
    'copilot_model_gateway_account_overlays',
    'copilot_model_gateway_route_options',
    'copilot_model_gateway_provider_projections',
    'copilot_model_gateway_model_projections',
    'copilot_model_gateway_provider_evidence',
    'copilot_model_gateway_model_evidence',
    'copilot_model_gateway_catalog_sources',
    'copilot_model_gateway_snapshots',
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalInteger(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.floor(number) : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function retentionLimit(value, fallback) {
    const limit = optionalInteger(value);
    return limit === null ? fallback : Math.max(0, limit);
}

/**
 * @param {SqliteCatalogDatabase} db
 * @returns {number}
 */
function sqliteUserVersion(db) {
    const row = /** @type {Record<string, unknown> | undefined} */ (db.prepare('PRAGMA user_version').get());
    return optionalInteger(row?.['user_version']) ?? 0;
}

/**
 * @param {SqliteCatalogDatabase} db
 * @returns {void}
 */
function ensureCompatibleSqliteSchemaVersion(db) {
    const userVersion = sqliteUserVersion(db);
    if (userVersion > MODEL_GATEWAY_SQLITE_SCHEMA_VERSION) {
        throw new Error(
            `[model-gateway/sqlite] database schema version ${userVersion} is newer than supported version ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION}`,
        );
    }
}

/**
 * @param {SqliteCatalogDatabase} db
 * @param {string} table
 * @param {string} column
 * @returns {boolean}
 */
function sqliteTableHasColumn(db, table, column) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => isRecord(row) && optionalString(row['name']) === column);
}

/**
 * @param {SqliteCatalogDatabase} db
 * @returns {void}
 */
function migrateModelGatewaySqliteSchema(db) {
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
            wire_api = COALESCE(
                NULLIF(json_extract(payload_json, '$.wireApi'), ''),
                wire_api
            ),
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
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function payloadJson(value) {
    return JSON.stringify(value ?? null);
}

const SENSITIVE_OPERATIONAL_KEY_RE =
    /^(?:authorization|proxy-authorization|api[_-]?key|secret|token|bearer[_-]?token|access[_-]?token|password)$/iu;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeOperationalPayload(value) {
    if (typeof value === 'string') return redactSecretText(value);
    if (Array.isArray(value)) return value.map(sanitizeOperationalPayload);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                SENSITIVE_OPERATIONAL_KEY_RE.test(key) ? '[redacted]' : sanitizeOperationalPayload(item),
            ]),
        );
    }
    if (value === undefined) return null;
    return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function operationalPayloadJson(value) {
    return JSON.stringify(sanitizeOperationalPayload(value ?? null));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    return `{${Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(',')}}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function routeProfile(row) {
    return optionalString(row['routeProfile']) ?? DEFAULT_ROUTE_PROFILE;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerModel(row) {
    return optionalString(row['providerModel']) ?? 'unknown-model';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerId(row) {
    return optionalString(row['providerId']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function selectorKind(row) {
    return optionalString(row['selectorKind']) ?? 'exact_model';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function selectorSyntax(row) {
    return optionalString(row['selectorSyntax']) ?? providerModel(row);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function modelKey(row) {
    return [providerId(row), providerModel(row), routeProfile(row)].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function lifecycleStatus(row) {
    const lifecycle = row['lifecycle'];
    if (typeof lifecycle === 'string' && lifecycle.trim()) return lifecycle.trim();
    if (isRecord(lifecycle)) {
        return (
            optionalString(lifecycle['status']) ??
            optionalString(lifecycle['state']) ??
            optionalString(lifecycle['availability']) ??
            'unknown'
        );
    }
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function routeKey(row) {
    return [modelKey(row), selectorKind(row), selectorSyntax(row)].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function eligibilityDecisionKey(row) {
    return [
        optionalString(row['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
        optionalString(row['taskProfile']) ?? DEFAULT_TASK_PROFILE,
        optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
        modelKey(row),
        selectorKind(row),
        selectorSyntax(row),
    ].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} fallback
 * @returns {string}
 */
function idOr(row, fallback) {
    return (
        optionalString(row['id']) ??
        optionalString(row['evidenceId']) ??
        optionalString(row['runId']) ??
        optionalString(row['rawPayloadRef']) ??
        optionalString(row['accountOverlayId']) ??
        fallback
    );
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parsePayload(raw) {
    if (typeof raw !== 'string') return {};
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * @param {SqliteCatalogDatabase} db
 * @param {string} table
 * @param {string} orderBy
 * @returns {Record<string, unknown>[]}
 */
function readPayloadRows(db, table, orderBy) {
    return db
        .prepare(`SELECT payload_json FROM ${table} ORDER BY ${orderBy}`)
        .all()
        .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>[]}
 */
function runtimeProbeRecords(row) {
    return isRecord(row['probes']) ? Object.values(row['probes']).filter(isRecord) : [];
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown> | null}
 */
function latestRuntimeProbe(row) {
    return (
        runtimeProbeRecords(row).sort(
            (left, right) => (dateMs(right['lastAt']) ?? 0) - (dateMs(left['lastAt']) ?? 0),
        )[0] ?? null
    );
}

/**
 * @param {Record<string, unknown>} row
 * @returns {number}
 */
function latestRuntimeAt(row) {
    const direct = Math.max(
        dateMs(row['lastFailureAt']) ?? 0,
        dateMs(row['lastSuccessAt']) ?? 0,
        dateMs(row['lastAgentProbeFailureAt']) ?? 0,
        dateMs(row['lastAgentProbeSuccessAt']) ?? 0,
    );
    return runtimeProbeRecords(row).reduce((max, probe) => Math.max(max, dateMs(probe['lastAt']) ?? 0), direct);
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function runtimeHealthStatus(record) {
    const lastStatus = optionalString(record['lastStatus']);
    const agentStatus = optionalString(record['agentProbeStatus']);
    const chatFailed =
        lastStatus === 'failed' && (dateMs(record['lastFailureAt']) ?? 0) >= (dateMs(record['lastSuccessAt']) ?? 0);
    const agentFailed =
        agentStatus === 'failed' &&
        (dateMs(record['lastAgentProbeFailureAt']) ?? 0) >= (dateMs(record['lastAgentProbeSuccessAt']) ?? 0);
    if (chatFailed || agentFailed) return 'failed';
    if (lastStatus === 'ok' || agentStatus === 'ok') return 'ok';
    const latestProbe = latestRuntimeProbe(record);
    if (latestProbe?.['ok'] === true) return 'ok';
    if (latestProbe?.['ok'] === false) return 'failed';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function runtimeFailureContext(record) {
    const latestProbe = latestRuntimeProbe(record);
    return (
        optionalString(record['lastFailureKind']) ??
        optionalString(record['lastErrorContext']) ??
        optionalString(record['lastAgentProbeErrorContext']) ??
        optionalString(record['lastMessage']) ??
        optionalString(record['lastAgentProbeMessage']) ??
        optionalString(latestProbe?.['lastFailureKind']) ??
        optionalString(latestProbe?.['lastErrorContext']) ??
        optionalString(latestProbe?.['lastMessage'])
    );
}

/**
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function isWritableRuntimeHealthRecord(record) {
    const provider = optionalString(record['providerId']) ?? optionalString(record['provider']);
    const model = optionalString(record['providerModel']) ?? optionalString(record['model']);
    return Boolean(provider && model);
}

/**
 * @param {string} runId
 * @param {string} key
 * @returns {string}
 */
function runtimeObservationKey(runId, key) {
    return `runtime-health:${sha256(stableJson({ runId, key })).slice(0, 40)}`;
}

/**
 * @param {string} runId
 * @param {string} key
 * @param {string} probeKind
 * @returns {string}
 */
function runtimeProbeResultKey(runId, key, probeKind) {
    return `runtime-probe:${sha256(stableJson({ runId, key, probeKind })).slice(0, 40)}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createRuntimeHealthRunId(observedAtMs) {
    _runtimeHealthRunSequence += 1;
    return `model-gateway:runtime-health:${observedAtMs}:${process.pid}:${_runtimeHealthRunSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createRuntimeProbeRunId(observedAtMs) {
    _runtimeHealthRunSequence += 1;
    return `model-gateway:runtime-probe:${observedAtMs}:${process.pid}:${_runtimeHealthRunSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createAutomationDecisionId(observedAtMs) {
    _automationDecisionSequence += 1;
    return `model-gateway:automation:${observedAtMs}:${process.pid}:${_automationDecisionSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createAutomationPolicySnapshotId(observedAtMs) {
    _automationPolicySnapshotSequence += 1;
    return `model-gateway:automation-policy:${observedAtMs}:${process.pid}:${_automationPolicySnapshotSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createAutomationEffectId(observedAtMs) {
    _automationEffectSequence += 1;
    return `model-gateway:automation-effect:${observedAtMs}:${process.pid}:${_automationEffectSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createRecoveryAttemptId(observedAtMs) {
    _recoveryAttemptSequence += 1;
    return `model-gateway:recovery:${observedAtMs}:${process.pid}:${_recoveryAttemptSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createSdkSessionHandoffId(observedAtMs) {
    _sdkSessionHandoffSequence += 1;
    return `model-gateway:sdk-handoff:${observedAtMs}:${process.pid}:${_sdkSessionHandoffSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createSdkSessionConfirmationId(observedAtMs) {
    _sdkSessionConfirmationSequence += 1;
    return `model-gateway:sdk-confirmation:${observedAtMs}:${process.pid}:${_sdkSessionConfirmationSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createStandbyPlanId(observedAtMs) {
    _standbyPlanSequence += 1;
    return `model-gateway:standby:${observedAtMs}:${process.pid}:${_standbyPlanSequence}`;
}

/**
 * @param {number} observedAtMs
 * @returns {string}
 */
function createLiveScenarioRunId(observedAtMs) {
    _liveScenarioRunSequence += 1;
    return `model-gateway:live-scenario:${observedAtMs}:${process.pid}:${_liveScenarioRunSequence}`;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string | null}
 */
function runtimeProbeKind(result) {
    return optionalString(result['probeKind']) ?? optionalString(result['kind']);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string | null}
 */
function runtimeProbeProviderId(result) {
    return optionalString(result['providerId']) ?? optionalString(result['provider']);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string | null}
 */
function runtimeProbeProviderModel(result) {
    return optionalString(result['providerModel']) ?? optionalString(result['model']);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function runtimeProbeRouteProfile(result) {
    return optionalString(result['routeProfile']) ?? DEFAULT_ROUTE_PROFILE;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {boolean}
 */
function isWritableRuntimeProbeResult(result) {
    return Boolean(
        runtimeProbeProviderId(result) &&
        runtimeProbeProviderModel(result) &&
        runtimeProbeKind(result) &&
        optionalString(result['status']),
    );
}

/**
 * @param {Record<string, unknown>[]} probes
 * @returns {Record<string, unknown>[]}
 */
function latestProbePerKind(probes) {
    /** @type {Map<string, Record<string, unknown>>} */
    const byKind = new Map();
    for (const probe of probes) {
        const kind = optionalString(probe['kind']) ?? optionalString(probe['probeKind']);
        if (!kind || byKind.has(kind)) continue;
        byKind.set(kind, probe);
    }
    return [...byKind.values()];
}

/**
 * @param {{
 *     payload_json: string;
 *     status?: string | null;
 *     classified_failure?: string | null;
 *     observed_at_ms?: number | null;
 *     expires_at_ms?: number | null;
 *     route_profile?: string | null;
 *     provider_id?: string | null;
 *     provider_model?: string | null;
 * }} row
 * @returns {Record<string, unknown>}
 */
function parseRuntimeHealthRow(row) {
    const payload = parsePayload(row.payload_json);
    return {
        ...payload,
        providerId: optionalString(payload['providerId']) ?? optionalString(row.provider_id),
        providerModel: optionalString(payload['providerModel']) ?? optionalString(row.provider_model),
        routeProfile:
            optionalString(payload['routeProfile']) ?? optionalString(row.route_profile) ?? DEFAULT_ROUTE_PROFILE,
        runtimeHealthStatus: optionalString(row.status),
        runtimeClassifiedFailure: optionalString(row.classified_failure),
        runtimeObservedAtMs: optionalInteger(row.observed_at_ms),
        runtimeExpiresAtMs: optionalInteger(row.expires_at_ms),
    };
}

/**
 * @param {{
 *     payload_json: string;
 *     probe_kind?: string | null;
 *     wire_api?: string | null;
 *     ok?: number | null;
 *     status?: string | null;
 *     observed_at_ms?: number | null;
 *     expires_at_ms?: number | null;
 *     route_profile?: string | null;
 *     provider_id?: string | null;
 *     provider_model?: string | null;
 * }} row
 * @returns {Record<string, unknown>}
 */
function parseRuntimeProbeRow(row) {
    const payload = parsePayload(row.payload_json);
    return {
        ...payload,
        providerId: optionalString(payload['providerId']) ?? optionalString(row.provider_id),
        providerModel: optionalString(payload['providerModel']) ?? optionalString(row.provider_model),
        routeProfile:
            optionalString(payload['routeProfile']) ?? optionalString(row.route_profile) ?? DEFAULT_ROUTE_PROFILE,
        kind: optionalString(payload['kind']) ?? optionalString(row.probe_kind),
        wireApi: optionalString(payload['wireApi']) ?? optionalString(row.wire_api),
        ok: typeof payload['ok'] === 'boolean' ? payload['ok'] : row.ok === 1,
        status: optionalString(payload['status']) ?? optionalString(row.status) ?? 'unknown',
        runtimeObservedAtMs: optionalInteger(row.observed_at_ms),
        runtimeExpiresAtMs: optionalInteger(row.expires_at_ms),
    };
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function runtimeRecordKey(record) {
    const provider = optionalString(record['providerId']);
    const model = optionalString(record['providerModel']);
    if (!provider || !model) return null;
    return `${optionalString(record['routeProfile']) ?? DEFAULT_ROUTE_PROFILE}|${provider}|${model}`;
}

/**
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown>} probe
 * @returns {Record<string, unknown>}
 */
function mergeRuntimeProbeIntoHealthRecord(record, probe) {
    const kind = optionalString(probe['kind']) ?? optionalString(probe['probeKind']);
    if (!kind) return record;
    const observedAt = optionalInteger(probe['runtimeObservedAtMs']) ?? dateMs(probe['lastAt']) ?? Date.now();
    const probeRecord = {
        ...probe,
        kind,
        lastAt: observedAt,
        ok: probe['ok'] === true,
        status: optionalString(probe['status']) ?? 'unknown',
    };
    const probes = {
        ...(isRecord(record['probes']) ? record['probes'] : {}),
        [kind]: probeRecord,
    };
    const healthObservedAt = Math.max(
        dateMs(record['lastSuccessAt']) ?? 0,
        dateMs(record['lastFailureAt']) ?? 0,
        optionalInteger(record['runtimeObservedAtMs']) ?? 0,
    );
    const probeIsNewer = observedAt >= healthObservedAt;
    return {
        ...record,
        probes,
        ...(probeIsNewer && probe['ok'] === true
            ? {
                  lastStatus: 'ok',
                  lastSuccessAt: observedAt,
                  lastSuccessContext: optionalString(record['lastSuccessContext']) ?? `runtime_probe:${kind}`,
              }
            : {}),
        ...(probeIsNewer && probe['ok'] === false
            ? {
                  lastStatus: 'failed',
                  lastFailureAt: observedAt,
                  lastMessage: optionalString(probe['message']) ?? optionalString(probe['status']),
                  lastErrorContext: optionalString(probe['errorContext']) ?? `runtime_probe:${kind}`,
                  lastFailureKind: optionalString(probe['failureKind']) ?? optionalString(probe['status']),
              }
            : {}),
    };
}

/**
 * @param {Record<string, unknown>} event
 * @returns {string}
 */
function refreshLogPhase(event) {
    return optionalString(event['phase']) ?? optionalString(event['schema']) ?? 'unknown';
}

/**
 * @param {Record<string, unknown>} event
 * @returns {Record<string, unknown>}
 */
function refreshLogImporter(event) {
    return isRecord(event['importer']) ? event['importer'] : {};
}

/**
 * @param {Record<string, unknown>} event
 * @returns {string}
 */
function refreshLogStatus(event) {
    const status = optionalString(event['status']);
    if (status) return status;
    const phase = refreshLogPhase(event);
    if (phase.endsWith('_failed') || phase.includes('failed')) return 'failed';
    if (phase.endsWith('_completed') || phase === 'refresh_completed') return 'completed';
    if (phase.endsWith('_started') || phase === 'refresh_started') return 'started';
    return 'observed';
}

/**
 * @param {Record<string, unknown>} event
 * @returns {number | null}
 */
function refreshLogProgressPct(event) {
    const direct = optionalInteger(event['progressPct']);
    if (direct !== null) return Math.max(0, Math.min(direct, 100));
    const progress = isRecord(event['progress']) ? event['progress'] : {};
    const nested = optionalInteger(progress['pct']);
    return nested === null ? null : Math.max(0, Math.min(nested, 100));
}

/**
 * @param {Record<string, unknown>} event
 * @param {number} index
 * @param {string} runId
 * @returns {string}
 */
function refreshLogEventKey(event, index, runId) {
    return (
        optionalString(event['eventKey']) ??
        optionalString(event['eventId']) ??
        `refresh-log:${sha256(stableJson({ runId, index, event: sanitizeOperationalPayload(event) }))}`
    );
}

/**
 * @param {Record<string, unknown>[]} events
 * @param {string | null | undefined} fallback
 * @returns {string}
 */
function refreshLogRunId(events, fallback) {
    const explicit = optionalString(fallback);
    if (explicit) return explicit;
    const first = events[0];
    const last = events[events.length - 1] ?? first;
    return `model-gateway-refresh:${optionalString(first?.['ts']) ?? optionalString(last?.['ts']) ?? Date.now()}`;
}

/**
 * @param {SqliteCatalogDatabase} db
 * @param {object} input
 * @param {string} input.table
 * @param {string} input.keyColumn
 * @param {string} input.orderColumn
 * @param {number} input.maxRows
 * @returns {number}
 */
function deleteRowsKeepingLatest(db, input) {
    const statement = db.prepare(`
        DELETE FROM ${input.table}
        WHERE ${input.keyColumn} IN (
            SELECT ${input.keyColumn}
            FROM ${input.table}
            ORDER BY ${input.orderColumn} DESC, ${input.keyColumn} DESC
            LIMIT -1 OFFSET ?
        )
    `);
    return Number(statement.run(input.maxRows).changes ?? 0);
}

export class SqliteModelGatewayCatalogStore {
    /** @type {SqliteCatalogDatabase} */
    #db;

    /**
     * @param {{ db?: SqliteDatabasePort }} [options]
     */
    constructor(options = {}) {
        this.#db = requireCatalogDatabase(options.db ?? getApplicationSqliteDatabase());
        if (initializedSqliteCatalogDatabases.has(this.#db)) return;
        this.#db.exec('PRAGMA foreign_keys = ON');
        ensureCompatibleSqliteSchemaVersion(this.#db);
        this.#db.exec(MODEL_GATEWAY_SQLITE_SCHEMA_SQL);
        migrateModelGatewaySqliteSchema(this.#db);
        this.#db.exec(`PRAGMA user_version = ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION}`);
        initializedSqliteCatalogDatabases.add(this.#db);
    }

    /**
     * @returns {Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>}
     */
    async readSnapshot() {
        const meta = /** @type {{ payload_json: string } | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT payload_json
                        FROM copilot_model_gateway_snapshots
                        WHERE snapshot_id = ?
                        LIMIT 1
                    `,
                )
                .get(ACTIVE_SNAPSHOT_ID)
        );
        const base = meta ? parsePayload(meta.payload_json) : {};
        return normalizeStoredCatalogSnapshot({
            ...base,
            sources: readPayloadRows(this.#db, 'copilot_model_gateway_catalog_sources', 'source_id'),
            providerEvidences: readPayloadRows(this.#db, 'copilot_model_gateway_provider_evidence', 'evidence_id'),
            evidences: readPayloadRows(this.#db, 'copilot_model_gateway_model_evidence', 'evidence_id'),
            routeOptions: readPayloadRows(this.#db, 'copilot_model_gateway_route_options', 'route_key'),
            accountOverlays: readPayloadRows(this.#db, 'copilot_model_gateway_account_overlays', 'account_overlay_id'),
            providerProjections: readPayloadRows(
                this.#db,
                'copilot_model_gateway_provider_projections',
                'projection_key',
            ),
            projections: readPayloadRows(this.#db, 'copilot_model_gateway_model_projections', 'projection_key'),
            importRuns: readPayloadRows(this.#db, 'copilot_model_gateway_import_runs', 'run_id'),
            rawPayloadRefs: readPayloadRows(this.#db, 'copilot_model_gateway_raw_payload_refs', 'raw_payload_ref'),
            conflicts: readPayloadRows(this.#db, 'copilot_model_gateway_conflicts', 'conflict_key'),
            modelEligibilityRuns: readPayloadRows(this.#db, 'copilot_model_gateway_eligibility_runs', 'run_id'),
            modelEligibilityDecisions: readPayloadRows(
                this.#db,
                'copilot_model_gateway_eligibility_decisions',
                'decision_key',
            ),
        });
    }

    /**
     * Reads only the relational layers required by routine search, routing, evaluation and probe planning.
     *
     * @param {{ includeImportRuns?: boolean }} [options]
     * @returns {Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>}
     */
    async readRoutingSnapshot(options = {}) {
        const meta = /** @type {{ payload_json: string } | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT payload_json
                        FROM copilot_model_gateway_snapshots
                        WHERE snapshot_id = ?
                        LIMIT 1
                    `,
                )
                .get(ACTIVE_SNAPSHOT_ID)
        );
        const base = meta ? parsePayload(meta.payload_json) : {};
        return normalizeStoredCatalogSnapshot({
            ...base,
            sources: readPayloadRows(this.#db, 'copilot_model_gateway_catalog_sources', 'source_id'),
            routeOptions: readPayloadRows(this.#db, 'copilot_model_gateway_route_options', 'route_key'),
            accountOverlays: readPayloadRows(this.#db, 'copilot_model_gateway_account_overlays', 'account_overlay_id'),
            providerProjections: readPayloadRows(
                this.#db,
                'copilot_model_gateway_provider_projections',
                'projection_key',
            ),
            projections: readPayloadRows(this.#db, 'copilot_model_gateway_model_projections', 'projection_key'),
            importRuns: options.includeImportRuns
                ? readPayloadRows(this.#db, 'copilot_model_gateway_import_runs', 'run_id')
                : [],
            modelEligibilityDecisions: readPayloadRows(
                this.#db,
                'copilot_model_gateway_eligibility_decisions',
                'decision_key',
            ),
        });
    }

    /**
     * @returns {Promise<ReturnType<typeof toOpenAIModelCatalogList>>}
     */
    async readOpenAIModelCatalogList() {
        const snapshot = await this.readSnapshot();
        return toOpenAIModelCatalogList(snapshot.projections, {
            providerProjections: snapshot.providerProjections,
            eligibilityDecisions: snapshot.modelEligibilityDecisions,
            routeOptions: snapshot.routeOptions,
        });
    }

    /**
     * @returns {Promise<{
     *     schemaVersion: number;
     *     userVersion: number;
     *     tableCounts: Record<string, number>;
     *     activeSnapshot: { exists: boolean; source: string | null; generatedAtMs: number | null };
     *     catalogRows: number;
     *     accountHistoryRows: number;
     *     runtimeRows: number;
     *     runtime: {
     *         probeRuns: number;
     *         probeResults: number;
     *         healthObservations: number;
     *         latestProbeRunCompletedAtMs: number | null;
     *         latestProbeResultObservedAtMs: number | null;
     *         latestHealthObservedAtMs: number | null;
     *         healthStatusCounts: Record<string, number>;
     *         probeStatusCounts: Record<string, number>;
     *     };
     *     routeDecisionRows: number;
     *     automationDecisionRows: number;
     *     automationPolicySnapshotRows: number;
     *     automationEffectApplicationRows: number;
     *     recoveryAttemptRows: number;
     *     sdkSessionHandoffRows: number;
     *     sdkSessionDeferredHandoffRows: number;
     *     sdkSessionConfirmationRows: number;
     *     standbyPlanRows: number;
     *     liveScenarioRunRows: number;
     *     latestAutomationDecision: {
     *         action: string | null;
     *         status: string | null;
     *         ok: boolean | null;
     *         selectedRouteKey: string | null;
     *         decidedAtMs: number | null;
     *     };
     *     latestAutomationPolicySnapshot: {
     *         enabled: boolean | null;
     *         policy: string | null;
     *         routeProfile: string | null;
     *         observedAtMs: number | null;
     *     };
     *     latestAutomationEffectApplication: {
     *         effectKind: string | null;
     *         status: string | null;
     *         applied: boolean | null;
     *         observedAtMs: number | null;
     *     };
     *     latestRecoveryAttempt: {
     *         recoveryAttemptId: string | null;
     *         decisionId: string | null;
     *         routeProfile: string | null;
     *         selectedRouteKey: string | null;
     *         recoveryScope: string | null;
     *         failureKind: string | null;
     *         status: string | null;
     *         applied: boolean | null;
     *         observedAtMs: number | null;
     *     };
     *     latestSdkSessionHandoff: {
     *         handoffId: string | null;
     *         status: string | null;
     *         routeProfile: string | null;
     *         selectedRouteKey: string | null;
     *         sessionId: string | null;
     *         targetModel: string | null;
     *         providerId: string | null;
     *         providerModel: string | null;
     *         promotionAuthorized: boolean | null;
     *         expiresAtMs: number | null;
     *         requestedAtMs: number | null;
     *         confirmedAtMs: number | null;
     *     };
     *     latestDeferredSdkSessionHandoff: {
     *         handoffId: string | null;
     *         status: string | null;
     *         routeProfile: string | null;
     *         selectedRouteKey: string | null;
     *         sessionId: string | null;
     *         targetModel: string | null;
     *         providerId: string | null;
     *         providerModel: string | null;
     *         promotionAuthorized: boolean | null;
     *         expiresAtMs: number | null;
     *         requestedAtMs: number | null;
     *         confirmedAtMs: number | null;
     *     } | null;
     *     latestSdkSessionConfirmation: {
     *         status: string | null;
     *         handoffId: string | null;
     *         decisionId: string | null;
     *         sessionId: string | null;
     *         previousModel: string | null;
     *         confirmedModel: string | null;
     *         observedAtMs: number | null;
     *     };
     *     latestStandbyPlan: {
     *         standbyPlanId: string | null;
     *         status: string | null;
     *         routeProfile: string | null;
     *         routeCount: number | null;
     *         providerCount: number | null;
     *         runtimeProofCount: number | null;
     *         selectedRouteKey: string | null;
     *         source: string | null;
     *         generatedAtMs: number | null;
     *     };
     *     latestLiveScenarioRun: {
     *         runId: string | null;
     *         scenarioKind: string | null;
     *         status: string | null;
     *         ok: boolean | null;
     *         completedAtMs: number | null;
     *         summaryPath: string | null;
     *     };
     *     refreshLogRows: number;
     * }>}
     */
    async readStorageDiagnostics() {
        const nowMs = Date.now();
        /** @type {Record<string, number>} */
        const tableCounts = {};
        for (const table of MODEL_GATEWAY_SQLITE_TABLES) {
            const row = /** @type {{ count: number } | undefined} */ (
                this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            );
            tableCounts[table] = optionalInteger(row?.count) ?? 0;
        }
        const active = /** @type {{ source: string; generated_at_ms: number } | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT source, generated_at_ms
                        FROM copilot_model_gateway_snapshots
                        WHERE snapshot_id = ?
                        LIMIT 1
                    `,
                )
                .get(ACTIVE_SNAPSHOT_ID)
        );
        const catalogTables = [
            'copilot_model_gateway_catalog_sources',
            'copilot_model_gateway_model_evidence',
            'copilot_model_gateway_provider_evidence',
            'copilot_model_gateway_model_projections',
            'copilot_model_gateway_provider_projections',
            'copilot_model_gateway_route_options',
            'copilot_model_gateway_account_overlays',
            'copilot_model_gateway_import_runs',
            'copilot_model_gateway_raw_payload_refs',
            'copilot_model_gateway_conflicts',
            'copilot_model_gateway_eligibility_runs',
            'copilot_model_gateway_eligibility_decisions',
        ];
        const accountHistoryTables = [
            'copilot_model_gateway_account_quota_snapshots',
            'copilot_model_gateway_account_rate_limit_snapshots',
            'copilot_model_gateway_account_spending_snapshots',
        ];
        const runtimeTables = [
            'copilot_model_gateway_runtime_probe_runs',
            'copilot_model_gateway_runtime_probe_results',
            'copilot_model_gateway_health_observations',
        ];
        const latestRuntime = /** @type {{
          latest_probe_run_completed_at_ms: number | null;
          latest_probe_result_observed_at_ms: number | null;
          latest_health_observed_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT
                            (SELECT MAX(completed_at_ms) FROM copilot_model_gateway_runtime_probe_runs) AS latest_probe_run_completed_at_ms,
                            (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_runtime_probe_results) AS latest_probe_result_observed_at_ms,
                            (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_health_observations) AS latest_health_observed_at_ms
                    `,
                )
                .get()
        );
        const healthStatusCounts = Object.fromEntries(
            this.#db
                .prepare(
                    'SELECT status, COUNT(*) AS count FROM copilot_model_gateway_health_observations GROUP BY status',
                )
                .all()
                .map((row) => {
                    const item = /** @type {{ status: string; count: number }} */ (row);
                    return [item.status, optionalInteger(item.count) ?? 0];
                }),
        );
        const probeStatusCounts = Object.fromEntries(
            this.#db
                .prepare(
                    'SELECT status, COUNT(*) AS count FROM copilot_model_gateway_runtime_probe_results GROUP BY status',
                )
                .all()
                .map((row) => {
                    const item = /** @type {{ status: string; count: number }} */ (row);
                    return [item.status, optionalInteger(item.count) ?? 0];
                }),
        );
        const latestAutomationDecision = /** @type {{
          action: string | null;
          status: string | null;
          ok: number | null;
          selected_route_key: string | null;
          decided_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT action, status, ok, selected_route_key, decided_at_ms
                        FROM copilot_model_gateway_automation_decisions
                        ORDER BY decided_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        const latestAutomationPolicySnapshot =
            /** @type {{ enabled: number | null; policy: string | null; route_profile: string | null; observed_at_ms: number | null }
    | undefined} */ (
                this.#db
                    .prepare(
                        `
                        SELECT enabled, policy, route_profile, observed_at_ms
                        FROM copilot_model_gateway_automation_policy_snapshots
                        ORDER BY observed_at_ms DESC
                        LIMIT 1
                    `,
                    )
                    .get()
            );
        const latestAutomationEffectApplication =
            /** @type {{ effect_kind: string | null; status: string | null; applied: number | null; observed_at_ms: number | null }
    | undefined} */ (
                this.#db
                    .prepare(
                        `
                        SELECT effect_kind, status, applied, observed_at_ms
                        FROM copilot_model_gateway_automation_effect_applications
                        ORDER BY observed_at_ms DESC
                        LIMIT 1
                    `,
                    )
                    .get()
            );
        const latestRecoveryAttempt = /** @type {{
          recovery_attempt_id: string | null;
          decision_id: string | null;
          route_profile: string | null;
          selected_route_key: string | null;
          recovery_scope: string | null;
          failure_kind: string | null;
          status: string | null;
          applied: number | null;
          observed_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT recovery_attempt_id, decision_id, route_profile, selected_route_key,
                               recovery_scope, failure_kind, status, applied, observed_at_ms
                        FROM copilot_model_gateway_recovery_attempts
                        ORDER BY observed_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        const latestSdkSessionHandoff = /** @type {{
          handoff_id: string | null;
          status: string | null;
          route_profile: string | null;
          selected_route_key: string | null;
          session_id: string | null;
          target_model: string | null;
          provider_id: string | null;
          provider_model: string | null;
          promotion_authorized: number | null;
          expires_at_ms: number | null;
          requested_at_ms: number | null;
          confirmed_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT handoff_id, status, route_profile, selected_route_key, session_id, target_model,
                               provider_id, provider_model, promotion_authorized, expires_at_ms,
                               requested_at_ms, confirmed_at_ms
                        FROM copilot_model_gateway_sdk_session_handoffs
                        ORDER BY requested_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        const sdkSessionDeferredHandoffRows = /** @type {{ count: number } | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM copilot_model_gateway_sdk_session_handoffs
                        WHERE status = 'deferred_until_turn_boundary'
                          AND (expires_at_ms IS NULL OR expires_at_ms > ?)
                    `,
                )
                .get(nowMs)
        );
        const latestDeferredSdkSessionHandoff = /** @type {{
          handoff_id: string | null;
          status: string | null;
          route_profile: string | null;
          selected_route_key: string | null;
          session_id: string | null;
          target_model: string | null;
          provider_id: string | null;
          provider_model: string | null;
          promotion_authorized: number | null;
          expires_at_ms: number | null;
          requested_at_ms: number | null;
          confirmed_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT handoff_id, status, route_profile, selected_route_key, session_id, target_model,
                               provider_id, provider_model, promotion_authorized, expires_at_ms,
                               requested_at_ms, confirmed_at_ms
                        FROM copilot_model_gateway_sdk_session_handoffs
                        WHERE status = 'deferred_until_turn_boundary'
                          AND (expires_at_ms IS NULL OR expires_at_ms > ?)
                        ORDER BY requested_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get(nowMs)
        );
        const latestSdkSessionConfirmation = /** @type {{
          status: string | null;
          handoff_id: string | null;
          decision_id: string | null;
          session_id: string | null;
          previous_model: string | null;
          confirmed_model: string | null;
          observed_at_ms: number | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT status, handoff_id, decision_id, session_id, previous_model, confirmed_model, observed_at_ms
                        FROM copilot_model_gateway_sdk_session_confirmations
                        ORDER BY observed_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        const latestStandbyPlan = /** @type {{
          standby_plan_id: string | null;
          route_profile: string | null;
          status: string | null;
          route_count: number | null;
          provider_count: number | null;
          runtime_proof_count: number | null;
          selected_route_key: string | null;
          generated_at_ms: number | null;
          source: string | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT standby_plan_id, route_profile, status, route_count, provider_count,
                               runtime_proof_count, selected_route_key, generated_at_ms, source
                        FROM copilot_model_gateway_standby_plans
                        ORDER BY generated_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        const latestLiveScenarioRun = /** @type {{
          run_id: string | null;
          scenario_kind: string | null;
          status: string | null;
          ok: number | null;
          completed_at_ms: number | null;
          summary_path: string | null;
      }
    | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT run_id, scenario_kind, status, ok, completed_at_ms, summary_path
                        FROM copilot_model_gateway_live_scenario_runs
                        ORDER BY completed_at_ms DESC
                        LIMIT 1
                    `,
                )
                .get()
        );
        /**
         * @param {string[]} tables
         * @returns {number}
         */
        const sum = (tables) => tables.reduce((total, table) => total + (tableCounts[table] ?? 0), 0);
        return {
            schemaVersion: MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
            userVersion: sqliteUserVersion(this.#db),
            tableCounts,
            activeSnapshot: {
                exists: Boolean(active),
                source: active?.source ?? null,
                generatedAtMs: optionalInteger(active?.generated_at_ms),
            },
            catalogRows: sum(catalogTables),
            accountHistoryRows: sum(accountHistoryTables),
            runtimeRows: sum(runtimeTables),
            runtime: {
                probeRuns: tableCounts['copilot_model_gateway_runtime_probe_runs'] ?? 0,
                probeResults: tableCounts['copilot_model_gateway_runtime_probe_results'] ?? 0,
                healthObservations: tableCounts['copilot_model_gateway_health_observations'] ?? 0,
                latestProbeRunCompletedAtMs: optionalInteger(latestRuntime?.latest_probe_run_completed_at_ms),
                latestProbeResultObservedAtMs: optionalInteger(latestRuntime?.latest_probe_result_observed_at_ms),
                latestHealthObservedAtMs: optionalInteger(latestRuntime?.latest_health_observed_at_ms),
                healthStatusCounts,
                probeStatusCounts,
            },
            routeDecisionRows: tableCounts['copilot_model_gateway_route_decisions'] ?? 0,
            automationDecisionRows: tableCounts['copilot_model_gateway_automation_decisions'] ?? 0,
            automationPolicySnapshotRows: tableCounts['copilot_model_gateway_automation_policy_snapshots'] ?? 0,
            automationEffectApplicationRows: tableCounts['copilot_model_gateway_automation_effect_applications'] ?? 0,
            recoveryAttemptRows: tableCounts['copilot_model_gateway_recovery_attempts'] ?? 0,
            sdkSessionHandoffRows: tableCounts['copilot_model_gateway_sdk_session_handoffs'] ?? 0,
            sdkSessionDeferredHandoffRows: optionalInteger(sdkSessionDeferredHandoffRows?.count) ?? 0,
            sdkSessionConfirmationRows: tableCounts['copilot_model_gateway_sdk_session_confirmations'] ?? 0,
            standbyPlanRows: tableCounts['copilot_model_gateway_standby_plans'] ?? 0,
            liveScenarioRunRows: tableCounts['copilot_model_gateway_live_scenario_runs'] ?? 0,
            latestAutomationDecision: {
                action: optionalString(latestAutomationDecision?.action),
                status: optionalString(latestAutomationDecision?.status),
                ok: latestAutomationDecision?.ok === 1 ? true : latestAutomationDecision?.ok === 0 ? false : null,
                selectedRouteKey: optionalString(latestAutomationDecision?.selected_route_key),
                decidedAtMs: optionalInteger(latestAutomationDecision?.decided_at_ms),
            },
            latestAutomationPolicySnapshot: {
                enabled:
                    latestAutomationPolicySnapshot?.enabled === 1
                        ? true
                        : latestAutomationPolicySnapshot?.enabled === 0
                          ? false
                          : null,
                policy: optionalString(latestAutomationPolicySnapshot?.policy),
                routeProfile: optionalString(latestAutomationPolicySnapshot?.route_profile),
                observedAtMs: optionalInteger(latestAutomationPolicySnapshot?.observed_at_ms),
            },
            latestAutomationEffectApplication: {
                effectKind: optionalString(latestAutomationEffectApplication?.effect_kind),
                status: optionalString(latestAutomationEffectApplication?.status),
                applied:
                    latestAutomationEffectApplication?.applied === 1
                        ? true
                        : latestAutomationEffectApplication?.applied === 0
                          ? false
                          : null,
                observedAtMs: optionalInteger(latestAutomationEffectApplication?.observed_at_ms),
            },
            latestRecoveryAttempt: {
                recoveryAttemptId: optionalString(latestRecoveryAttempt?.recovery_attempt_id),
                decisionId: optionalString(latestRecoveryAttempt?.decision_id),
                routeProfile: optionalString(latestRecoveryAttempt?.route_profile),
                selectedRouteKey: optionalString(latestRecoveryAttempt?.selected_route_key),
                recoveryScope: optionalString(latestRecoveryAttempt?.recovery_scope),
                failureKind: optionalString(latestRecoveryAttempt?.failure_kind),
                status: optionalString(latestRecoveryAttempt?.status),
                applied:
                    latestRecoveryAttempt?.applied === 1 ? true : latestRecoveryAttempt?.applied === 0 ? false : null,
                observedAtMs: optionalInteger(latestRecoveryAttempt?.observed_at_ms),
            },
            latestSdkSessionHandoff: {
                handoffId: optionalString(latestSdkSessionHandoff?.handoff_id),
                status: optionalString(latestSdkSessionHandoff?.status),
                routeProfile: optionalString(latestSdkSessionHandoff?.route_profile),
                selectedRouteKey: optionalString(latestSdkSessionHandoff?.selected_route_key),
                sessionId: optionalString(latestSdkSessionHandoff?.session_id),
                targetModel: optionalString(latestSdkSessionHandoff?.target_model),
                providerId: optionalString(latestSdkSessionHandoff?.provider_id),
                providerModel: optionalString(latestSdkSessionHandoff?.provider_model),
                promotionAuthorized:
                    latestSdkSessionHandoff?.promotion_authorized === 1
                        ? true
                        : latestSdkSessionHandoff?.promotion_authorized === 0
                          ? false
                          : null,
                expiresAtMs: optionalInteger(latestSdkSessionHandoff?.expires_at_ms),
                requestedAtMs: optionalInteger(latestSdkSessionHandoff?.requested_at_ms),
                confirmedAtMs: optionalInteger(latestSdkSessionHandoff?.confirmed_at_ms),
            },
            latestDeferredSdkSessionHandoff: latestDeferredSdkSessionHandoff
                ? {
                      handoffId: optionalString(latestDeferredSdkSessionHandoff.handoff_id),
                      status: optionalString(latestDeferredSdkSessionHandoff.status),
                      routeProfile: optionalString(latestDeferredSdkSessionHandoff.route_profile),
                      selectedRouteKey: optionalString(latestDeferredSdkSessionHandoff.selected_route_key),
                      sessionId: optionalString(latestDeferredSdkSessionHandoff.session_id),
                      targetModel: optionalString(latestDeferredSdkSessionHandoff.target_model),
                      providerId: optionalString(latestDeferredSdkSessionHandoff.provider_id),
                      providerModel: optionalString(latestDeferredSdkSessionHandoff.provider_model),
                      promotionAuthorized:
                          latestDeferredSdkSessionHandoff.promotion_authorized === 1
                              ? true
                              : latestDeferredSdkSessionHandoff.promotion_authorized === 0
                                ? false
                                : null,
                      expiresAtMs: optionalInteger(latestDeferredSdkSessionHandoff.expires_at_ms),
                      requestedAtMs: optionalInteger(latestDeferredSdkSessionHandoff.requested_at_ms),
                      confirmedAtMs: optionalInteger(latestDeferredSdkSessionHandoff.confirmed_at_ms),
                  }
                : null,
            latestSdkSessionConfirmation: {
                status: optionalString(latestSdkSessionConfirmation?.status),
                handoffId: optionalString(latestSdkSessionConfirmation?.handoff_id),
                decisionId: optionalString(latestSdkSessionConfirmation?.decision_id),
                sessionId: optionalString(latestSdkSessionConfirmation?.session_id),
                previousModel: optionalString(latestSdkSessionConfirmation?.previous_model),
                confirmedModel: optionalString(latestSdkSessionConfirmation?.confirmed_model),
                observedAtMs: optionalInteger(latestSdkSessionConfirmation?.observed_at_ms),
            },
            latestStandbyPlan: {
                standbyPlanId: optionalString(latestStandbyPlan?.standby_plan_id),
                routeProfile: optionalString(latestStandbyPlan?.route_profile),
                status: optionalString(latestStandbyPlan?.status),
                routeCount: optionalInteger(latestStandbyPlan?.route_count),
                providerCount: optionalInteger(latestStandbyPlan?.provider_count),
                runtimeProofCount: optionalInteger(latestStandbyPlan?.runtime_proof_count),
                selectedRouteKey: optionalString(latestStandbyPlan?.selected_route_key),
                source: optionalString(latestStandbyPlan?.source),
                generatedAtMs: optionalInteger(latestStandbyPlan?.generated_at_ms),
            },
            latestLiveScenarioRun: {
                runId: optionalString(latestLiveScenarioRun?.run_id),
                scenarioKind: optionalString(latestLiveScenarioRun?.scenario_kind),
                status: optionalString(latestLiveScenarioRun?.status),
                ok: latestLiveScenarioRun?.ok === 1 ? true : latestLiveScenarioRun?.ok === 0 ? false : null,
                completedAtMs: optionalInteger(latestLiveScenarioRun?.completed_at_ms),
                summaryPath: optionalString(latestLiveScenarioRun?.summary_path),
            },
            refreshLogRows: tableCounts['copilot_model_gateway_refresh_log_events'] ?? 0,
        };
    }

    /**
     * @param {{ additionalSecrets?: readonly string[]; maxSamples?: number; maxRowsPerTable?: number }} [options]
     * @returns {Promise<{
     *     schema: 'model-gateway-sqlite-redaction-audit';
     *     ok: boolean;
     *     tableCount: number;
     *     leakCount: number;
     *     scannedStringCount: number;
     *     sampleCount: number;
     *     tables: Record<
     *         string,
     *         {
     *             ok: boolean;
     *             rowCount: number;
     *             scannedStringCount: number;
     *             leakCount: number;
     *             sampleCount: number;
     *             samples: { path: string; redactedSnippet: string }[];
     *         }
     *     >;
     * }>}
     */
    async auditStoredPayloadRedaction(options = {}) {
        const maxRowsPerTable = Math.max(1, Math.min(optionalInteger(options.maxRowsPerTable) ?? 100_000, 1_000_000));
        /** @type {Record<
    string,
    {
        ok: boolean;
        rowCount: number;
        scannedStringCount: number;
        leakCount: number;
        sampleCount: number;
        samples: { path: string; redactedSnippet: string }[];
    }
>} */
        const tables = {};
        /** @type {{ ok: boolean; leakCount: number; scannedStringCount: number; sampleCount: number }[]} */
        const audits = [];
        for (const table of MODEL_GATEWAY_SQLITE_TABLES) {
            if (!sqliteTableHasColumn(this.#db, table, 'payload_json')) continue;
            const rows = /** @type {{ payload_json: string }[]} */ (
                this.#db.prepare(`SELECT payload_json FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(maxRowsPerTable)
            );
            const audit = auditModelGatewayValueRedaction(
                rows.map((row) => parsePayload(row.payload_json)),
                {
                    surface: `sqlite:${table}`,
                    rootPath: table,
                    ...(options.additionalSecrets === undefined
                        ? {}
                        : { additionalSecrets: options.additionalSecrets }),
                    ...(options.maxSamples === undefined ? {} : { maxSamples: options.maxSamples }),
                },
            );
            tables[table] = {
                ok: audit.ok,
                rowCount: rows.length,
                scannedStringCount: audit.scannedStringCount,
                leakCount: audit.leakCount,
                sampleCount: audit.sampleCount,
                samples: audit.samples,
            };
            audits.push(audit);
        }
        const summary = summarizeModelGatewayRedactionAudits(audits);
        return {
            schema: 'model-gateway-sqlite-redaction-audit',
            ok: summary.ok,
            tableCount: Object.keys(tables).length,
            leakCount: summary.leakCount,
            scannedStringCount: summary.scannedStringCount,
            sampleCount: summary.sampleCount,
            tables,
        };
    }

    /**
     * @param {{ additionalSecrets?: readonly string[]; maxRowsPerTable?: number }} [options]
     * @returns {Promise<{
     *     schema: 'model-gateway-sqlite-redaction-repair';
     *     updatedRows: number;
     *     tables: Record<string, { scannedRows: number; updatedRows: number }>;
     * }>}
     */
    async redactStoredPayloadLeaks(options = {}) {
        const maxRowsPerTable = Math.max(1, Math.min(optionalInteger(options.maxRowsPerTable) ?? 100_000, 1_000_000));
        /** @type {Record<string, { scannedRows: number; updatedRows: number }>} */
        const tables = {};
        let updatedRows = 0;
        const tx = this.#db.transaction(() => {
            for (const table of MODEL_GATEWAY_SQLITE_TABLES) {
                if (!sqliteTableHasColumn(this.#db, table, 'payload_json')) continue;
                const rows = /** @type {{ rowid: number; payload_json: string }[]} */ (
                    this.#db
                        .prepare(`SELECT rowid, payload_json FROM ${table} ORDER BY rowid DESC LIMIT ?`)
                        .all(maxRowsPerTable)
                );
                const update = this.#db.prepare(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`);
                let tableUpdatedRows = 0;
                for (const row of rows) {
                    const redactedValue = redactModelGatewayAuditedValue(parsePayload(row.payload_json), {
                        ...(options.additionalSecrets === undefined
                            ? {}
                            : { additionalSecrets: options.additionalSecrets }),
                    });
                    const nextPayload = JSON.stringify(redactedValue);
                    if (nextPayload === row.payload_json) continue;
                    update.run(nextPayload, row.rowid);
                    tableUpdatedRows += 1;
                    updatedRows += 1;
                }
                tables[table] = { scannedRows: rows.length, updatedRows: tableUpdatedRows };
            }
        });
        tx();
        return {
            schema: 'model-gateway-sqlite-redaction-repair',
            updatedRows,
            tables,
        };
    }

    /**
     * @param {Record<string, unknown>[]} events
     * @param {{ runId?: string; logPath?: string }} [options]
     * @returns {Promise<{ runId: string; refreshLogEvents: number }>}
     */
    async writeRefreshLogEvents(events, options = {}) {
        const cleanEvents = events.filter(isRecord);
        const runId = refreshLogRunId(cleanEvents, options.runId ?? options.logPath);
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_refresh_log_events
                (event_key, run_id, phase, status, provider_id, importer_id, source_id, progress_pct,
                 observed_at_ms, elapsed_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_key) DO UPDATE SET
                run_id = excluded.run_id,
                phase = excluded.phase,
                status = excluded.status,
                provider_id = excluded.provider_id,
                importer_id = excluded.importer_id,
                source_id = excluded.source_id,
                progress_pct = excluded.progress_pct,
                observed_at_ms = excluded.observed_at_ms,
                elapsed_ms = excluded.elapsed_ms,
                payload_json = excluded.payload_json
        `);
        const tx = this.#db.transaction(() => {
            cleanEvents.forEach((event, index) => {
                const importer = refreshLogImporter(event);
                insert.run(
                    refreshLogEventKey(event, index, runId),
                    runId,
                    refreshLogPhase(event),
                    refreshLogStatus(event),
                    optionalString(event['providerId']) ?? optionalString(importer['providerId']),
                    optionalString(event['importerId']) ?? optionalString(importer['importerId']),
                    optionalString(event['sourceId']) ?? optionalString(importer['sourceId']),
                    refreshLogProgressPct(event),
                    dateMs(event['ts']) ?? dateMs(event['timestamp']) ?? Date.now(),
                    optionalInteger(event['elapsedMs']),
                    operationalPayloadJson(event),
                );
            });
        });
        tx();
        return { runId, refreshLogEvents: cleanEvents.length };
    }

    /**
     * @param {string} text
     * @param {{ runId?: string; logPath?: string }} [options]
     * @returns {Promise<
     *     ReturnType<typeof summarizeModelGatewayRefreshLogEvents> & { runId: string; refreshLogEvents: number }
     * >}
     */
    async writeRefreshLogText(text, options = {}) {
        const parsed = parseModelGatewayRefreshLogText(text);
        const write = await this.writeRefreshLogEvents(parsed.events, options);
        const summary = summarizeModelGatewayRefreshLogEvents(parsed.events, {
            invalidLineCount: parsed.invalidLineCount,
            logPath: options.logPath,
        });
        return { ...summary, ...write };
    }

    /**
     * @param {{ runId?: string; limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readRefreshLogEvents(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 1_000, 50_000));
        const runId = optionalString(options.runId);
        const rows = runId
            ? this.#db
                  .prepare(
                      `
                          SELECT payload_json
                          FROM copilot_model_gateway_refresh_log_events
                          WHERE run_id = ?
                          ORDER BY observed_at_ms ASC
                          LIMIT ?
                      `,
                  )
                  .all(runId, limit)
            : this.#db
                  .prepare(
                      `
                          SELECT payload_json
                          FROM copilot_model_gateway_refresh_log_events
                          ORDER BY observed_at_ms DESC
                          LIMIT ?
                      `,
                  )
                  .all(limit);
        return rows.map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {{
     *     accountHistoryMaxRowsPerTable?: number;
     *     accountQuotaSnapshotMaxRows?: number;
     *     accountRateLimitSnapshotMaxRows?: number;
     *     accountSpendingSnapshotMaxRows?: number;
     *     routeDecisionMaxRows?: number;
     *     refreshLogMaxRows?: number;
     *     runtimeProbeRunMaxRows?: number;
     *     runtimeProbeResultMaxRows?: number;
     *     healthObservationMaxRows?: number;
     *     automationDecisionMaxRows?: number;
     *     automationPolicySnapshotMaxRows?: number;
     *     automationEffectApplicationMaxRows?: number;
     *     recoveryAttemptMaxRows?: number;
     *     sdkSessionHandoffMaxRows?: number;
     *     sdkSessionConfirmationMaxRows?: number;
     *     standbyPlanMaxRows?: number;
     *     liveScenarioRunMaxRows?: number;
     * }} [policy]
     * @returns {Promise<{
     *     schema: string;
     *     deletedRows: number;
     *     tables: Record<string, { deletedRows: number; maxRows: number }>;
     * }>}
     */
    async applyOperationalRetention(policy = {}) {
        const accountHistoryMaxRowsPerTable = retentionLimit(
            policy.accountHistoryMaxRowsPerTable,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountHistoryMaxRowsPerTable,
        );
        const accountHistoryFallback =
            policy.accountHistoryMaxRowsPerTable === undefined ? null : accountHistoryMaxRowsPerTable;
        const accountQuotaSnapshotMaxRows = retentionLimit(
            policy.accountQuotaSnapshotMaxRows,
            accountHistoryFallback ?? DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountQuotaSnapshotMaxRows,
        );
        const accountRateLimitSnapshotMaxRows = retentionLimit(
            policy.accountRateLimitSnapshotMaxRows,
            accountHistoryFallback ??
                DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountRateLimitSnapshotMaxRows,
        );
        const accountSpendingSnapshotMaxRows = retentionLimit(
            policy.accountSpendingSnapshotMaxRows,
            accountHistoryFallback ?? DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountSpendingSnapshotMaxRows,
        );
        const routeDecisionMaxRows = retentionLimit(
            policy.routeDecisionMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.routeDecisionMaxRows,
        );
        const refreshLogMaxRows = retentionLimit(
            policy.refreshLogMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.refreshLogMaxRows,
        );
        const runtimeProbeRunMaxRows = retentionLimit(
            policy.runtimeProbeRunMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeRunMaxRows,
        );
        const runtimeProbeResultMaxRows = retentionLimit(
            policy.runtimeProbeResultMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeResultMaxRows,
        );
        const healthObservationMaxRows = retentionLimit(
            policy.healthObservationMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.healthObservationMaxRows,
        );
        const automationDecisionMaxRows = retentionLimit(
            policy.automationDecisionMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationDecisionMaxRows,
        );
        const automationPolicySnapshotMaxRows = retentionLimit(
            policy.automationPolicySnapshotMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationPolicySnapshotMaxRows,
        );
        const automationEffectApplicationMaxRows = retentionLimit(
            policy.automationEffectApplicationMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.automationEffectApplicationMaxRows,
        );
        const recoveryAttemptMaxRows = retentionLimit(
            policy.recoveryAttemptMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.recoveryAttemptMaxRows,
        );
        const sdkSessionHandoffMaxRows = retentionLimit(
            policy.sdkSessionHandoffMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.sdkSessionHandoffMaxRows,
        );
        const sdkSessionConfirmationMaxRows = retentionLimit(
            policy.sdkSessionConfirmationMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.sdkSessionConfirmationMaxRows,
        );
        const standbyPlanMaxRows = retentionLimit(
            policy.standbyPlanMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.standbyPlanMaxRows,
        );
        const liveScenarioRunMaxRows = retentionLimit(
            policy.liveScenarioRunMaxRows,
            DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.liveScenarioRunMaxRows,
        );
        /** @type {Record<string, { deletedRows: number; maxRows: number }>} */
        const tables = {};
        const tx = this.#db.transaction(() => {
            const accountRetentionTables = /** @type {[string, number][]} */ ([
                ['copilot_model_gateway_account_quota_snapshots', accountQuotaSnapshotMaxRows],
                ['copilot_model_gateway_account_rate_limit_snapshots', accountRateLimitSnapshotMaxRows],
                ['copilot_model_gateway_account_spending_snapshots', accountSpendingSnapshotMaxRows],
            ]);
            for (const [table, maxRows] of accountRetentionTables) {
                const deletedRows = deleteRowsKeepingLatest(this.#db, {
                    table,
                    keyColumn: 'snapshot_key',
                    orderColumn: 'observed_at_ms',
                    maxRows,
                });
                tables[table] = { deletedRows, maxRows };
            }
            tables['copilot_model_gateway_route_decisions'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_route_decisions',
                    keyColumn: 'decision_id',
                    orderColumn: 'decided_at_ms',
                    maxRows: routeDecisionMaxRows,
                }),
                maxRows: routeDecisionMaxRows,
            };
            tables['copilot_model_gateway_refresh_log_events'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_refresh_log_events',
                    keyColumn: 'event_key',
                    orderColumn: 'observed_at_ms',
                    maxRows: refreshLogMaxRows,
                }),
                maxRows: refreshLogMaxRows,
            };
            tables['copilot_model_gateway_automation_decisions'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_automation_decisions',
                    keyColumn: 'decision_id',
                    orderColumn: 'decided_at_ms',
                    maxRows: automationDecisionMaxRows,
                }),
                maxRows: automationDecisionMaxRows,
            };
            tables['copilot_model_gateway_automation_policy_snapshots'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_automation_policy_snapshots',
                    keyColumn: 'policy_snapshot_id',
                    orderColumn: 'observed_at_ms',
                    maxRows: automationPolicySnapshotMaxRows,
                }),
                maxRows: automationPolicySnapshotMaxRows,
            };
            tables['copilot_model_gateway_automation_effect_applications'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_automation_effect_applications',
                    keyColumn: 'effect_id',
                    orderColumn: 'observed_at_ms',
                    maxRows: automationEffectApplicationMaxRows,
                }),
                maxRows: automationEffectApplicationMaxRows,
            };
            tables['copilot_model_gateway_recovery_attempts'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_recovery_attempts',
                    keyColumn: 'recovery_attempt_id',
                    orderColumn: 'observed_at_ms',
                    maxRows: recoveryAttemptMaxRows,
                }),
                maxRows: recoveryAttemptMaxRows,
            };
            tables['copilot_model_gateway_sdk_session_handoffs'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_sdk_session_handoffs',
                    keyColumn: 'handoff_id',
                    orderColumn: 'requested_at_ms',
                    maxRows: sdkSessionHandoffMaxRows,
                }),
                maxRows: sdkSessionHandoffMaxRows,
            };
            const sdkSessionHandoffTransitionMaxRows = Math.max(1, sdkSessionHandoffMaxRows * 5);
            const orphanTransitionRows = Number(
                this.#db
                    .prepare(
                        `
                    DELETE FROM copilot_model_gateway_sdk_session_handoff_transitions
                    WHERE handoff_id NOT IN (
                        SELECT handoff_id FROM copilot_model_gateway_sdk_session_handoffs
                    )
                `,
                    )
                    .run().changes ?? 0,
            );
            tables['copilot_model_gateway_sdk_session_handoff_transitions'] = {
                deletedRows:
                    orphanTransitionRows +
                    deleteRowsKeepingLatest(this.#db, {
                        table: 'copilot_model_gateway_sdk_session_handoff_transitions',
                        keyColumn: 'transition_id',
                        orderColumn: 'occurred_at_ms',
                        maxRows: sdkSessionHandoffTransitionMaxRows,
                    }),
                maxRows: sdkSessionHandoffTransitionMaxRows,
            };
            tables['copilot_model_gateway_sdk_session_confirmations'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_sdk_session_confirmations',
                    keyColumn: 'confirmation_id',
                    orderColumn: 'observed_at_ms',
                    maxRows: sdkSessionConfirmationMaxRows,
                }),
                maxRows: sdkSessionConfirmationMaxRows,
            };
            tables['copilot_model_gateway_standby_plans'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_standby_plans',
                    keyColumn: 'standby_plan_id',
                    orderColumn: 'generated_at_ms',
                    maxRows: standbyPlanMaxRows,
                }),
                maxRows: standbyPlanMaxRows,
            };
            tables['copilot_model_gateway_live_scenario_runs'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_live_scenario_runs',
                    keyColumn: 'run_id',
                    orderColumn: 'completed_at_ms',
                    maxRows: liveScenarioRunMaxRows,
                }),
                maxRows: liveScenarioRunMaxRows,
            };
            tables['copilot_model_gateway_runtime_probe_results'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_runtime_probe_results',
                    keyColumn: 'result_key',
                    orderColumn: 'observed_at_ms',
                    maxRows: runtimeProbeResultMaxRows,
                }),
                maxRows: runtimeProbeResultMaxRows,
            };
            tables['copilot_model_gateway_runtime_probe_runs'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_runtime_probe_runs',
                    keyColumn: 'run_id',
                    orderColumn: 'completed_at_ms',
                    maxRows: runtimeProbeRunMaxRows,
                }),
                maxRows: runtimeProbeRunMaxRows,
            };
            tables['copilot_model_gateway_health_observations'] = {
                deletedRows: deleteRowsKeepingLatest(this.#db, {
                    table: 'copilot_model_gateway_health_observations',
                    keyColumn: 'observation_key',
                    orderColumn: 'observed_at_ms',
                    maxRows: healthObservationMaxRows,
                }),
                maxRows: healthObservationMaxRows,
            };
        });
        tx();
        const deletedRows = Object.values(tables).reduce((total, table) => total + table.deletedRows, 0);
        return {
            schema: 'model-gateway-sqlite-operational-retention',
            deletedRows,
            tables,
        };
    }

    /**
     * @param {readonly unknown[]} records
     * @param {{ runId?: string; observedAt?: string | number | Date }} [options]
     * @returns {Promise<{ runId: string; healthObservations: number; probeResults: number; skippedRecords: number }>}
     */
    async writeRuntimeHealthRecords(records, options = {}) {
        const observedAtMs = dateMs(options.observedAt) ?? Date.now();
        const runId = optionalString(options.runId) ?? createRuntimeHealthRunId(observedAtMs);
        const cleanRecords = records.filter(isRecord);
        const writableRecords = cleanRecords.filter(isWritableRuntimeHealthRecord);
        const skippedRecords = records.length - writableRecords.length;
        let healthObservations = 0;
        let probeResults = 0;
        const tx = this.#db.transaction(() => {
            const insertRun = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_runs
                    (run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                     model_count, success_count, failure_count, skipped_count, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    probe_profile = excluded.probe_profile,
                    account_scope = excluded.account_scope,
                    status = excluded.status,
                    started_at_ms = excluded.started_at_ms,
                    completed_at_ms = excluded.completed_at_ms,
                    model_count = excluded.model_count,
                    success_count = excluded.success_count,
                    failure_count = excluded.failure_count,
                    skipped_count = excluded.skipped_count,
                    payload_json = excluded.payload_json
            `);
            const insertHealth = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_health_observations
                    (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                     classified_failure, observed_at_ms, expires_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(observation_key) DO UPDATE SET
                    provider_id = excluded.provider_id,
                    provider_model = excluded.provider_model,
                    route_profile = excluded.route_profile,
                    health_scope = excluded.health_scope,
                    status = excluded.status,
                    classified_failure = excluded.classified_failure,
                    observed_at_ms = excluded.observed_at_ms,
                    expires_at_ms = excluded.expires_at_ms,
                    payload_json = excluded.payload_json
            `);
            const insertProbe = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_results
                    (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                     ok, status, observed_at_ms, expires_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(result_key) DO UPDATE SET
                    run_id = excluded.run_id,
                    provider_id = excluded.provider_id,
                    provider_model = excluded.provider_model,
                    route_profile = excluded.route_profile,
                    probe_kind = excluded.probe_kind,
                    wire_api = excluded.wire_api,
                    ok = excluded.ok,
                    status = excluded.status,
                    observed_at_ms = excluded.observed_at_ms,
                    expires_at_ms = excluded.expires_at_ms,
                    payload_json = excluded.payload_json
            `);
            let probeSuccessCount = 0;
            let probeFailureCount = 0;
            insertRun.run(
                runId,
                'byok-operational-health',
                DEFAULT_ACCOUNT_SCOPE,
                'completed',
                observedAtMs,
                observedAtMs,
                writableRecords.length,
                0,
                0,
                skippedRecords,
                operationalPayloadJson({
                    source: 'byok-provider-health',
                    records: writableRecords.length,
                    skippedRecords,
                }),
            );
            for (const record of writableRecords) {
                const observed = latestRuntimeAt(record) || observedAtMs;
                const status = runtimeHealthStatus(record);
                const healthKey =
                    optionalString(record['key']) ??
                    `${routeProfile(record)}|${providerId(record)}|${providerModel(record)}`;
                insertHealth.run(
                    runtimeObservationKey(runId, healthKey),
                    providerId(record),
                    providerModel(record),
                    routeProfile(record),
                    'runtime',
                    status,
                    runtimeFailureContext(record),
                    observed,
                    null,
                    operationalPayloadJson(record),
                );
                healthObservations += 1;
                const probes = isRecord(record['probes']) ? record['probes'] : {};
                for (const [probeKind, probeValue] of Object.entries(probes)) {
                    if (!isRecord(probeValue)) continue;
                    const ok = probeValue['ok'] === true;
                    if (ok) probeSuccessCount += 1;
                    else probeFailureCount += 1;
                    insertProbe.run(
                        runtimeProbeResultKey(runId, healthKey, probeKind),
                        runId,
                        providerId(record),
                        providerModel(record),
                        routeProfile(record),
                        probeKind,
                        optionalString(probeValue['wireApi']),
                        ok ? 1 : 0,
                        optionalString(probeValue['status']) ?? 'unknown',
                        dateMs(probeValue['lastAt']) ?? observed,
                        null,
                        operationalPayloadJson({
                            ...probeValue,
                            providerId: providerId(record),
                            providerModel: providerModel(record),
                            routeProfile: routeProfile(record),
                        }),
                    );
                    probeResults += 1;
                }
            }
            this.#db
                .prepare(
                    `
                        UPDATE copilot_model_gateway_runtime_probe_runs
                        SET success_count = ?, failure_count = ?, payload_json = ?
                        WHERE run_id = ?
                    `,
                )
                .run(
                    probeSuccessCount,
                    probeFailureCount,
                    operationalPayloadJson({
                        source: 'byok-provider-health',
                        records: writableRecords.length,
                        skippedRecords,
                        probeResults,
                    }),
                    runId,
                );
        });
        tx();
        return { runId, healthObservations, probeResults, skippedRecords };
    }

    /**
     * Delete already-observed operational runtime health facts by canonical identity.
     *
     * Probe runs remain as append-only audit history. Health observations and per-probe result rows are the current
     * operational facts read by selectors, so scoped clears must remove them from SQLite as well as from the JSON
     * provider-health ledger.
     *
     * @param {{
     *     providerId?: string | null;
     *     providerModel?: string | null;
     *     routeProfile?: string | null;
     *     all?: boolean;
     * }} scope
     * @returns {Promise<{ healthObservations: number; probeResults: number }>}
     */
    async deleteRuntimeHealthRecords(scope) {
        const all = scope.all === true;
        const provider = optionalString(scope.providerId);
        const model = optionalString(scope.providerModel);
        const route = optionalString(scope.routeProfile);
        if (!all && !provider && !model && !route) return { healthObservations: 0, probeResults: 0 };
        /** @type {string[]} */
        const clauses = [];
        /** @type {string[]} */
        const params = [];
        if (!all) {
            if (provider) {
                clauses.push('provider_id = ?');
                params.push(provider);
            }
            if (model) {
                clauses.push('provider_model = ?');
                params.push(model);
            }
            if (route) {
                clauses.push('route_profile = ?');
                params.push(route);
            }
        }
        const where = all ? '1 = 1' : clauses.join(' AND ');
        /** @type {{ healthObservations: number; probeResults: number }} */
        const deleted = { healthObservations: 0, probeResults: 0 };
        const tx = this.#db.transaction(() => {
            deleted.healthObservations =
                optionalInteger(
                    this.#db
                        .prepare(`DELETE FROM copilot_model_gateway_health_observations WHERE ${where}`)
                        .run(...params).changes,
                ) ?? 0;
            deleted.probeResults =
                optionalInteger(
                    this.#db
                        .prepare(`DELETE FROM copilot_model_gateway_runtime_probe_results WHERE ${where}`)
                        .run(...params).changes,
                ) ?? 0;
        });
        tx();
        return deleted;
    }

    /**
     * Persist a direct runtime probe run without relying on the operational health mirror.
     *
     * This is the append-only runtime proof lane for explicit probe executors. It intentionally writes only the runtime
     * probe tables and leaves catalog projections, account overlays and health observations untouched.
     *
     * @param {{
     *     runId?: string;
     *     probeProfile?: string | null;
     *     accountScope?: string | null;
     *     status?: string | null;
     *     startedAt?: string | number | Date;
     *     completedAt?: string | number | Date;
     *     skippedCount?: number;
     *     payload?: Record<string, unknown>;
     *     results?: Record<string, unknown>[];
     * }} input
     * @returns {Promise<{
     *     runId: string;
     *     probeResults: number;
     *     skippedResults: number;
     *     successCount: number;
     *     failureCount: number;
     * }>}
     */
    async writeRuntimeProbeRun(input) {
        const completedAtMs = dateMs(input.completedAt) ?? Date.now();
        const startedAtMs = dateMs(input.startedAt) ?? completedAtMs;
        const runId = optionalString(input.runId) ?? createRuntimeProbeRunId(completedAtMs);
        const allResults = Array.isArray(input.results) ? input.results.filter(isRecord) : [];
        const writableResults = allResults.filter(isWritableRuntimeProbeResult);
        const skippedResults =
            Math.max(0, optionalInteger(input.skippedCount) ?? 0) + (allResults.length - writableResults.length);
        let successCount = 0;
        let failureCount = 0;
        const modelKeys = new Set();
        const tx = this.#db.transaction(() => {
            const insertRun = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_runs
                    (run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                     model_count, success_count, failure_count, skipped_count, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    probe_profile = excluded.probe_profile,
                    account_scope = excluded.account_scope,
                    status = excluded.status,
                    started_at_ms = excluded.started_at_ms,
                    completed_at_ms = excluded.completed_at_ms,
                    model_count = excluded.model_count,
                    success_count = excluded.success_count,
                    failure_count = excluded.failure_count,
                    skipped_count = excluded.skipped_count,
                    payload_json = excluded.payload_json
            `);
            const insertProbe = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_results
                    (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                     ok, status, observed_at_ms, expires_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(result_key) DO UPDATE SET
                    run_id = excluded.run_id,
                    provider_id = excluded.provider_id,
                    provider_model = excluded.provider_model,
                    route_profile = excluded.route_profile,
                    probe_kind = excluded.probe_kind,
                    wire_api = excluded.wire_api,
                    ok = excluded.ok,
                    status = excluded.status,
                    observed_at_ms = excluded.observed_at_ms,
                    expires_at_ms = excluded.expires_at_ms,
                    payload_json = excluded.payload_json
            `);
            insertRun.run(
                runId,
                optionalString(input.probeProfile) ?? DEFAULT_TASK_PROFILE,
                optionalString(input.accountScope) ?? DEFAULT_ACCOUNT_SCOPE,
                'running',
                startedAtMs,
                completedAtMs,
                0,
                0,
                0,
                skippedResults,
                operationalPayloadJson({
                    ...(isRecord(input.payload) ? input.payload : {}),
                    source: optionalString(input.payload?.['source']) ?? 'direct-runtime-probe',
                    resultCount: 0,
                    skippedResults,
                }),
            );
            writableResults.forEach((result, index) => {
                const probeKind = runtimeProbeKind(result) ?? 'unknown';
                const provider = runtimeProbeProviderId(result) ?? 'unknown-provider';
                const model = runtimeProbeProviderModel(result) ?? 'unknown-model';
                const route = runtimeProbeRouteProfile(result);
                const ok = result['ok'] === true;
                const observedAtMs =
                    dateMs(result['observedAt']) ?? optionalInteger(result['observedAtMs']) ?? completedAtMs;
                if (ok) successCount += 1;
                else failureCount += 1;
                modelKeys.add(`${provider}:${model}:${route}`);
                insertProbe.run(
                    optionalString(result['resultKey']) ??
                        runtimeProbeResultKey(runId, `${route}|${provider}|${model}|${probeKind}|${index}`, probeKind),
                    runId,
                    provider,
                    model,
                    route,
                    probeKind,
                    optionalString(result['wireApi']),
                    ok ? 1 : 0,
                    optionalString(result['status']) ?? 'unknown',
                    observedAtMs,
                    dateMs(result['expiresAt']) ?? optionalInteger(result['expiresAtMs']),
                    operationalPayloadJson({
                        ...result,
                        providerId: provider,
                        providerModel: model,
                        routeProfile: route,
                        kind: probeKind,
                    }),
                );
            });
            insertRun.run(
                runId,
                optionalString(input.probeProfile) ?? DEFAULT_TASK_PROFILE,
                optionalString(input.accountScope) ?? DEFAULT_ACCOUNT_SCOPE,
                optionalString(input.status) ?? (failureCount > 0 ? 'failed' : 'completed'),
                startedAtMs,
                completedAtMs,
                modelKeys.size,
                successCount,
                failureCount,
                skippedResults,
                operationalPayloadJson({
                    ...(isRecord(input.payload) ? input.payload : {}),
                    source: optionalString(input.payload?.['source']) ?? 'direct-runtime-probe',
                    resultCount: writableResults.length,
                    skippedResults,
                }),
            );
        });
        tx();
        return {
            runId,
            probeResults: writableResults.length,
            skippedResults,
            successCount,
            failureCount,
        };
    }

    /**
     * @param {string} runId
     * @returns {Promise<Record<string, unknown> | null>}
     */
    async readRuntimeProbeRunRecord(runId) {
        const row = /** @type {Record<string, unknown> | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                               model_count, success_count, failure_count, skipped_count, payload_json
                        FROM copilot_model_gateway_runtime_probe_runs
                        WHERE run_id = ?
                        LIMIT 1
                    `,
                )
                .get(runId)
        );
        if (!row) return null;
        const results = this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_runtime_probe_results
                    WHERE run_id = ?
                    ORDER BY observed_at_ms ASC, result_key ASC
                `,
            )
            .all(runId)
            .map((result) => parsePayload(/** @type {{ payload_json: string }} */ (result).payload_json));
        return {
            runId: optionalString(row['run_id']),
            probeProfile: optionalString(row['probe_profile']),
            accountScope: optionalString(row['account_scope']),
            status: optionalString(row['status']),
            startedAtMs: optionalInteger(row['started_at_ms']),
            completedAtMs: optionalInteger(row['completed_at_ms']),
            modelCount: optionalInteger(row['model_count']) ?? 0,
            successCount: optionalInteger(row['success_count']) ?? 0,
            failureCount: optionalInteger(row['failure_count']) ?? 0,
            skippedCount: optionalInteger(row['skipped_count']) ?? 0,
            payload: parsePayload(String(row['payload_json'] ?? '{}')),
            results,
        };
    }

    /**
     * @param {{ providerId?: string | null; providerModel?: string | null; routeProfile?: string | null }} input
     * @returns {Promise<{ health: Record<string, unknown> | null; probes: Record<string, unknown>[] }>}
     */
    async readRuntimeHealthForModel(input) {
        const provider = optionalString(input.providerId);
        const model = optionalString(input.providerModel);
        if (!provider || !model) return { health: null, probes: [] };
        const route = optionalString(input.routeProfile) ?? DEFAULT_ROUTE_PROFILE;
        const healthRows = this.#db
            .prepare(
                `
                    SELECT provider_id, provider_model, route_profile, status, classified_failure,
                           observed_at_ms, expires_at_ms, payload_json
                    FROM copilot_model_gateway_health_observations
                    WHERE provider_id = ?
                      AND provider_model = ?
                      AND (route_profile = ? OR ? = ?)
                    ORDER BY observed_at_ms DESC
                    LIMIT 1
                `,
            )
            .all(provider, model, route, route, DEFAULT_ROUTE_PROFILE)
            .map((row) =>
                parseRuntimeHealthRow(
                    /** @type {{
    provider_id: string;
    provider_model: string;
    route_profile: string;
    status: string;
    classified_failure: string | null;
    observed_at_ms: number;
    expires_at_ms: number | null;
    payload_json: string;
}} */ (row),
                ),
            );
        const probes = this.#db
            .prepare(
                `
                    SELECT provider_id, provider_model, route_profile, probe_kind, wire_api, ok,
                           status, observed_at_ms, expires_at_ms, payload_json
                    FROM copilot_model_gateway_runtime_probe_results
                    WHERE provider_id = ?
                      AND provider_model = ?
                      AND (route_profile = ? OR ? = ?)
                    ORDER BY observed_at_ms DESC, probe_kind ASC
                `,
            )
            .all(provider, model, route, route, DEFAULT_ROUTE_PROFILE)
            .map((row) =>
                parseRuntimeProbeRow(
                    /** @type {{
    provider_id: string;
    provider_model: string;
    route_profile: string;
    probe_kind: string;
    wire_api: string | null;
    ok: number;
    status: string;
    observed_at_ms: number;
    expires_at_ms: number | null;
    payload_json: string;
}} */ (row),
                ),
            );
        return {
            health: healthRows[0] ?? null,
            probes: latestProbePerKind(probes),
        };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async listRuntimeHealthRecords(options = {}) {
        const limit = Math.max(1, optionalInteger(options.limit) ?? 10_000);
        return this.#db
            .prepare(
                `
                    SELECT provider_id, provider_model, route_profile, status, classified_failure,
                           observed_at_ms, expires_at_ms, payload_json
                    FROM copilot_model_gateway_health_observations
                    ORDER BY observed_at_ms DESC, observation_key ASC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) =>
                parseRuntimeHealthRow(
                    /** @type {{
    provider_id: string;
    provider_model: string;
    route_profile: string;
    status: string;
    classified_failure: string | null;
    observed_at_ms: number;
    expires_at_ms: number | null;
    payload_json: string;
}} */ (row),
                ),
            )
            .filter(isRecord);
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async listLatestRuntimeHealthRecords(options = {}) {
        const limit = Math.max(1, optionalInteger(options.limit) ?? 10_000);
        const healthRecords = this.#db
            .prepare(
                `
                    SELECT provider_id, provider_model, route_profile, status, classified_failure,
                           observed_at_ms, expires_at_ms, payload_json
                    FROM (
                        SELECT provider_id, provider_model, route_profile, status, classified_failure,
                               observed_at_ms, expires_at_ms, payload_json, observation_key,
                               ROW_NUMBER() OVER (
                                   PARTITION BY provider_id, provider_model, route_profile
                                   ORDER BY observed_at_ms DESC, observation_key DESC
                               ) AS row_number
                        FROM copilot_model_gateway_health_observations
                    )
                    WHERE row_number = 1
                    ORDER BY observed_at_ms DESC, observation_key ASC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) =>
                parseRuntimeHealthRow(
                    /** @type {{
    provider_id: string;
    provider_model: string;
    route_profile: string;
    status: string;
    classified_failure: string | null;
    observed_at_ms: number;
    expires_at_ms: number | null;
    payload_json: string;
}} */ (row),
                ),
            )
            .filter(isRecord);
        const latestProbes = this.#db
            .prepare(
                `
                    SELECT provider_id, provider_model, route_profile, probe_kind, wire_api, ok,
                           status, observed_at_ms, expires_at_ms, payload_json
                    FROM (
                        SELECT provider_id, provider_model, route_profile, probe_kind, wire_api, ok,
                               status, observed_at_ms, expires_at_ms, payload_json, result_key,
                               ROW_NUMBER() OVER (
                                   PARTITION BY provider_id, provider_model, route_profile, probe_kind
                                   ORDER BY observed_at_ms DESC, result_key DESC
                               ) AS row_number
                        FROM copilot_model_gateway_runtime_probe_results
                    )
                    WHERE row_number = 1
                    ORDER BY observed_at_ms DESC, result_key ASC
                    LIMIT ?
                `,
            )
            .all(limit * 8)
            .map((row) =>
                parseRuntimeProbeRow(
                    /** @type {{
    provider_id: string;
    provider_model: string;
    route_profile: string;
    probe_kind: string;
    wire_api: string | null;
    ok: number;
    status: string;
    observed_at_ms: number;
    expires_at_ms: number | null;
    payload_json: string;
}} */ (row),
                ),
            )
            .filter(isRecord);
        /** @type {Map<string, Record<string, unknown>>} */
        const byKey = new Map();
        for (const record of healthRecords) {
            const key = runtimeRecordKey(record);
            if (key) byKey.set(key, record);
        }
        for (const probe of latestProbes) {
            const key = runtimeRecordKey(probe);
            if (!key) continue;
            const current = byKey.get(key) ?? {
                key,
                providerId: optionalString(probe['providerId']),
                providerModel: optionalString(probe['providerModel']),
                routeProfile: optionalString(probe['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                runtimeHealthStatus: 'probe-only',
            };
            byKey.set(key, mergeRuntimeProbeIntoHealthRecord(current, probe));
        }
        return [...byKey.values()]
            .sort((left, right) => latestRuntimeAt(right) - latestRuntimeAt(left))
            .slice(0, limit);
    }

    /**
     * @param {Record<string, unknown>[]} events
     * @returns {Promise<{ routeDecisions: number }>}
     */
    async writeRouteDecisionEvents(events) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_route_decisions
                (decision_id, task_profile, route_profile, policy_profile, provider_id, provider_model,
                 selected, decided_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(decision_id) DO UPDATE SET
                task_profile = excluded.task_profile,
                route_profile = excluded.route_profile,
                policy_profile = excluded.policy_profile,
                provider_id = excluded.provider_id,
                provider_model = excluded.provider_model,
                selected = excluded.selected,
                decided_at_ms = excluded.decided_at_ms,
                payload_json = excluded.payload_json
        `);
        const tx = this.#db.transaction(() => {
            for (const event of events.filter(isRecord)) {
                insert.run(
                    optionalString(event['decisionId']) ?? `route-decision:${dateMs(event['timestamp']) ?? Date.now()}`,
                    optionalString(event['taskProfile']) ?? DEFAULT_TASK_PROFILE,
                    optionalString(event['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    optionalString(event['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
                    optionalString(event['providerId']),
                    optionalString(event['modelId']),
                    event['selected'] === true ? 1 : 0,
                    dateMs(event['timestamp']) ?? Date.now(),
                    operationalPayloadJson(event),
                );
            }
        });
        tx();
        return { routeDecisions: events.filter(isRecord).length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readRouteDecisionEvents(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_route_decisions
                    ORDER BY decided_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} decisions
     * @returns {Promise<{ automationDecisions: number }>}
     */
    async writeAutomationDecisionRecords(decisions) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_automation_decisions
                (decision_id, route_profile, selected_route_key, action, status, ok, decided_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(decision_id) DO UPDATE SET
                route_profile = excluded.route_profile,
                selected_route_key = excluded.selected_route_key,
                action = excluded.action,
                status = excluded.status,
                ok = excluded.ok,
                decided_at_ms = excluded.decided_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = decisions.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const decision of writable) {
                const decidedAtMs = dateMs(decision['timestamp']) ?? Date.now();
                insert.run(
                    optionalString(decision['decisionId']) ?? createAutomationDecisionId(decidedAtMs),
                    optionalString(decision['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    optionalString(decision['selectedRouteKey']),
                    optionalString(decision['action']) ?? 'manual_intervention',
                    optionalString(decision['status']) ?? (decision['ok'] === true ? 'ready' : 'blocked'),
                    decision['ok'] === true ? 1 : 0,
                    decidedAtMs,
                    operationalPayloadJson(decision),
                );
            }
        });
        tx();
        return { automationDecisions: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readAutomationDecisionRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_automation_decisions
                    ORDER BY decided_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} snapshots
     * @returns {Promise<{ automationPolicySnapshots: number }>}
     */
    async writeAutomationPolicySnapshotRecords(snapshots) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_automation_policy_snapshots
                (policy_snapshot_id, decision_id, route_profile, enabled, policy, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(policy_snapshot_id) DO UPDATE SET
                decision_id = excluded.decision_id,
                route_profile = excluded.route_profile,
                enabled = excluded.enabled,
                policy = excluded.policy,
                observed_at_ms = excluded.observed_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = snapshots.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const snapshot of writable) {
                const observedAtMs = dateMs(snapshot['timestamp']) ?? dateMs(snapshot['observedAt']) ?? Date.now();
                insert.run(
                    optionalString(snapshot['policySnapshotId']) ?? createAutomationPolicySnapshotId(observedAtMs),
                    optionalString(snapshot['decisionId']),
                    optionalString(snapshot['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    snapshot['enabled'] === true ? 1 : 0,
                    optionalString(snapshot['policy']) ?? 'prefer_runtime_proved',
                    observedAtMs,
                    operationalPayloadJson(snapshot),
                );
            }
        });
        tx();
        return { automationPolicySnapshots: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readAutomationPolicySnapshotRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_automation_policy_snapshots
                    ORDER BY observed_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} applications
     * @returns {Promise<{ automationEffectApplications: number }>}
     */
    async writeAutomationEffectApplicationRecords(applications) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_automation_effect_applications
                (effect_id, decision_id, route_profile, selected_route_key, effect_kind, status,
                 applied, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(effect_id) DO UPDATE SET
                decision_id = excluded.decision_id,
                route_profile = excluded.route_profile,
                selected_route_key = excluded.selected_route_key,
                effect_kind = excluded.effect_kind,
                status = excluded.status,
                applied = excluded.applied,
                observed_at_ms = excluded.observed_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = applications.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const application of writable) {
                const observedAtMs =
                    dateMs(application['timestamp']) ?? dateMs(application['observedAt']) ?? Date.now();
                insert.run(
                    optionalString(application['effectId']) ?? createAutomationEffectId(observedAtMs),
                    optionalString(application['decisionId']),
                    optionalString(application['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    optionalString(application['selectedRouteKey']) ?? optionalString(application['routeKey']),
                    optionalString(application['effectKind']) ??
                        optionalString(application['kind']) ??
                        'unknown_effect',
                    optionalString(application['status']) ?? (application['applied'] === true ? 'applied' : 'skipped'),
                    application['applied'] === true ? 1 : 0,
                    observedAtMs,
                    operationalPayloadJson(application),
                );
            }
        });
        tx();
        return { automationEffectApplications: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readAutomationEffectApplicationRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_automation_effect_applications
                    ORDER BY observed_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} attempts
     * @returns {Promise<{ recoveryAttempts: number }>}
     */
    async writeRecoveryAttemptRecords(attempts) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_recovery_attempts
                (recovery_attempt_id, decision_id, effect_id, route_profile, selected_route_key,
                 recovery_scope, failure_kind, account_wide, status, applied, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(recovery_attempt_id) DO UPDATE SET
                decision_id = excluded.decision_id,
                effect_id = excluded.effect_id,
                route_profile = excluded.route_profile,
                selected_route_key = excluded.selected_route_key,
                recovery_scope = excluded.recovery_scope,
                failure_kind = excluded.failure_kind,
                account_wide = excluded.account_wide,
                status = excluded.status,
                applied = excluded.applied,
                observed_at_ms = excluded.observed_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = attempts.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const attempt of writable) {
                const observedAtMs = dateMs(attempt['timestamp']) ?? dateMs(attempt['observedAt']) ?? Date.now();
                const applied = attempt['applied'] === true;
                const accountWide = attempt['accountWideFailure'] === true || attempt['accountWide'] === true;
                insert.run(
                    optionalString(attempt['recoveryAttemptId']) ?? createRecoveryAttemptId(observedAtMs),
                    optionalString(attempt['decisionId']),
                    optionalString(attempt['effectId']),
                    optionalString(attempt['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    optionalString(attempt['selectedRouteKey']) ?? optionalString(attempt['routeKey']),
                    optionalString(attempt['recoveryScope']) ?? (accountWide ? 'account' : 'route'),
                    optionalString(attempt['failureKind']) ?? 'unknown_failure',
                    accountWide ? 1 : 0,
                    optionalString(attempt['status']) ?? (applied ? 'applied' : 'skipped'),
                    applied ? 1 : 0,
                    observedAtMs,
                    operationalPayloadJson({
                        ...attempt,
                        accountWideFailure: accountWide,
                        applied,
                        observedAtMs,
                    }),
                );
            }
        });
        tx();
        return { recoveryAttempts: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readRecoveryAttemptRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_recovery_attempts
                    ORDER BY observed_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} handoffs
     * @returns {Promise<{ sdkSessionHandoffs: number }>}
     */
    async writeSdkSessionHandoffRecords(handoffs) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_sdk_session_handoffs
                (handoff_id, decision_id, route_profile, selected_route_key, status, session_id, target_model,
                 operation_kind, idempotency_key, provider_id, provider_model, defer_reason, promotion_policy,
                 promotion_authorized, expires_at_ms, requested_at_ms, confirmed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(handoff_id) DO UPDATE SET
                decision_id = excluded.decision_id,
                route_profile = excluded.route_profile,
                selected_route_key = excluded.selected_route_key,
                status = excluded.status,
                session_id = excluded.session_id,
                target_model = excluded.target_model,
                operation_kind = excluded.operation_kind,
                idempotency_key = excluded.idempotency_key,
                provider_id = excluded.provider_id,
                provider_model = excluded.provider_model,
                defer_reason = excluded.defer_reason,
                promotion_policy = excluded.promotion_policy,
                promotion_authorized = excluded.promotion_authorized,
                expires_at_ms = excluded.expires_at_ms,
                requested_at_ms = excluded.requested_at_ms,
                confirmed_at_ms = excluded.confirmed_at_ms,
                payload_json = excluded.payload_json
        `);
        const insertTransition = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_sdk_session_handoff_transitions
                (transition_id, handoff_id, session_id, state, occurred_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(transition_id) DO UPDATE SET
                session_id = excluded.session_id,
                state = excluded.state,
                occurred_at_ms = excluded.occurred_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = handoffs.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const handoff of writable) {
                const requestedAtMs = dateMs(handoff['requestedAt']) ?? dateMs(handoff['timestamp']) ?? Date.now();
                const handoffId = optionalString(handoff['handoffId']) ?? createSdkSessionHandoffId(requestedAtMs);
                const operation = isRecord(handoff['operation']) ? handoff['operation'] : {};
                const targetRoute = isRecord(operation['targetRoute']) ? operation['targetRoute'] : {};
                const deferDetails = isRecord(operation['deferDetails']) ? operation['deferDetails'] : {};
                const promotionAuthorization = isRecord(operation['promotionAuthorization'])
                    ? operation['promotionAuthorization']
                    : isRecord(deferDetails['promotionAuthorization'])
                      ? deferDetails['promotionAuthorization']
                      : {};
                const sessionId = optionalString(handoff['sessionId']) ?? optionalString(operation['sessionId']);
                insert.run(
                    handoffId,
                    optionalString(handoff['decisionId']),
                    optionalString(handoff['routeProfile']) ?? DEFAULT_ROUTE_PROFILE,
                    optionalString(handoff['selectedRouteKey']) ?? optionalString(handoff['routeKey']),
                    optionalString(handoff['status']) ?? 'prepared',
                    sessionId,
                    optionalString(handoff['targetModel']) ?? optionalString(handoff['model']),
                    optionalString(operation['schemaVersion']) ?? 'unknown',
                    optionalString(operation['idempotencyKey']),
                    optionalString(targetRoute['providerId']),
                    optionalString(targetRoute['providerModel']) ?? optionalString(targetRoute['selectorSyntax']),
                    optionalString(operation['deferReason']),
                    optionalString(promotionAuthorization['policy']) ?? 'manual_review',
                    promotionAuthorization['authorized'] === true ? 1 : 0,
                    dateMs(promotionAuthorization['expiresAt']),
                    requestedAtMs,
                    dateMs(handoff['confirmedAt']),
                    operationalPayloadJson(handoff),
                );
                const transitions = Array.isArray(operation['transitions'])
                    ? operation['transitions'].filter(isRecord)
                    : [];
                transitions.forEach((transition, index) => {
                    const state = optionalString(transition['state']) ?? 'unknown';
                    insertTransition.run(
                        `${handoffId}:${index}:${state}`,
                        handoffId,
                        sessionId,
                        state,
                        dateMs(transition['timestamp']) ?? requestedAtMs,
                        operationalPayloadJson(transition),
                    );
                });
            }
        });
        tx();
        return { sdkSessionHandoffs: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readSdkSessionHandoffRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_sdk_session_handoffs
                    ORDER BY requested_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * Indexed lookup for deferred same-session route operations. Automatic callers should always provide sessionId.
     *
     * @param {{ sessionId?: string | null; limit?: number; now?: number; includeExpired?: boolean }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readDeferredSdkSessionHandoffRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        const sessionId = optionalString(options.sessionId);
        const now = optionalInteger(options.now) ?? Date.now();
        const includeExpired = options.includeExpired !== false;
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_sdk_session_handoffs
                    WHERE status = 'deferred_until_turn_boundary'
                      AND (? IS NULL OR session_id = ?)
                      AND (? = 1 OR expires_at_ms IS NULL OR expires_at_ms > ?)
                    ORDER BY requested_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(sessionId, sessionId, includeExpired ? 1 : 0, now, limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * Marks older deferred route intents for one session as superseded by the newest intent.
     *
     * @param {{ sessionId: string; exceptHandoffId: string; supersededBy: string; observedAt?: number }} input
     * @returns {Promise<{ superseded: number }>}
     */
    async supersedeDeferredSdkSessionHandoffRecords(input) {
        const sessionId = optionalString(input.sessionId);
        const exceptHandoffId = optionalString(input.exceptHandoffId);
        const supersededBy = optionalString(input.supersededBy);
        if (!sessionId || !exceptHandoffId || !supersededBy) return { superseded: 0 };
        const observedAt = optionalInteger(input.observedAt) ?? Date.now();
        const observedAtIso = new Date(observedAt).toISOString();
        const rows = /** @type {{ handoff_id: string; payload_json: string }[]} */ (
            this.#db
                .prepare(
                    `
                        SELECT handoff_id, payload_json
                        FROM copilot_model_gateway_sdk_session_handoffs
                        WHERE session_id = ?
                          AND status = 'deferred_until_turn_boundary'
                          AND handoff_id <> ?
                        ORDER BY requested_at_ms DESC
                    `,
                )
                .all(sessionId, exceptHandoffId)
        );
        const update = this.#db.prepare(`
            UPDATE copilot_model_gateway_sdk_session_handoffs
            SET status = 'superseded', payload_json = ?
            WHERE handoff_id = ? AND status = 'deferred_until_turn_boundary'
        `);
        const insertTransition = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_sdk_session_handoff_transitions
                (transition_id, handoff_id, session_id, state, occurred_at_ms, payload_json)
            VALUES (?, ?, ?, 'superseded', ?, ?)
            ON CONFLICT(transition_id) DO NOTHING
        `);
        let superseded = 0;
        const tx = this.#db.transaction(() => {
            for (const row of rows) {
                const payload = parsePayload(row.payload_json);
                const operation = isRecord(payload['operation']) ? payload['operation'] : {};
                const transition = {
                    state: 'superseded',
                    timestamp: observedAtIso,
                    supersededBy,
                    retryable: false,
                };
                const transitions = Array.isArray(operation['transitions'])
                    ? [...operation['transitions'].filter(isRecord), transition]
                    : [transition];
                const nextPayload = {
                    ...payload,
                    status: 'superseded',
                    operation: {
                        ...operation,
                        state: 'superseded',
                        supersededBy,
                        retryable: false,
                        updatedAt: observedAtIso,
                        transitions,
                    },
                };
                const result = update.run(operationalPayloadJson(nextPayload), row.handoff_id);
                if (result.changes === 0) continue;
                insertTransition.run(
                    `${row.handoff_id}:superseded:${supersededBy}`,
                    row.handoff_id,
                    sessionId,
                    observedAt,
                    operationalPayloadJson(transition),
                );
                superseded += 1;
            }
        });
        tx();
        return { superseded };
    }

    /**
     * @param {string} handoffId
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readSdkSessionHandoffTransitionRecords(handoffId, options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 100, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_sdk_session_handoff_transitions
                    WHERE handoff_id = ?
                    ORDER BY occurred_at_ms ASC, transition_id ASC
                    LIMIT ?
                `,
            )
            .all(handoffId, limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {string} handoffId
     * @returns {Promise<Record<string, unknown> | null>}
     */
    async readSdkSessionHandoffRecord(handoffId) {
        const row = /** @type {{ payload_json: string } | undefined} */ (
            this.#db
                .prepare(
                    `
                        SELECT payload_json
                        FROM copilot_model_gateway_sdk_session_handoffs
                        WHERE handoff_id = ?
                        LIMIT 1
                    `,
                )
                .get(handoffId)
        );
        return row ? parsePayload(row.payload_json) : null;
    }

    /**
     * @param {Record<string, unknown>[]} confirmations
     * @returns {Promise<{ sdkSessionConfirmations: number }>}
     */
    async writeSdkSessionConfirmationRecords(confirmations) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_sdk_session_confirmations
                (confirmation_id, handoff_id, decision_id, session_id, previous_provider_id, provider_id,
                 previous_model, confirmed_model, binding_strategy, wire_api, selected_route_key, operation_state,
                 reasoning_effort, status, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(confirmation_id) DO UPDATE SET
                handoff_id = excluded.handoff_id,
                decision_id = excluded.decision_id,
                session_id = excluded.session_id,
                previous_provider_id = excluded.previous_provider_id,
                provider_id = excluded.provider_id,
                previous_model = excluded.previous_model,
                confirmed_model = excluded.confirmed_model,
                binding_strategy = excluded.binding_strategy,
                wire_api = excluded.wire_api,
                selected_route_key = excluded.selected_route_key,
                operation_state = excluded.operation_state,
                reasoning_effort = excluded.reasoning_effort,
                status = excluded.status,
                observed_at_ms = excluded.observed_at_ms,
                payload_json = excluded.payload_json
        `);
        const writable = confirmations.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const confirmation of writable) {
                const observedAtMs =
                    dateMs(confirmation['observedAt']) ?? dateMs(confirmation['timestamp']) ?? Date.now();
                insert.run(
                    optionalString(confirmation['confirmationId']) ?? createSdkSessionConfirmationId(observedAtMs),
                    optionalString(confirmation['handoffId']),
                    optionalString(confirmation['decisionId']),
                    optionalString(confirmation['sessionId']),
                    optionalString(confirmation['previousProviderId']),
                    optionalString(confirmation['providerId']) ??
                        optionalString(confirmation['targetProviderId']) ??
                        optionalString(confirmation['confirmedProviderId']),
                    optionalString(confirmation['previousModel']),
                    optionalString(confirmation['confirmedModel']) ??
                        optionalString(confirmation['newModel']) ??
                        'unknown',
                    optionalString(confirmation['bindingStrategy']) ?? 'unknown',
                    optionalString(confirmation['wireApi']),
                    optionalString(confirmation['selectedRouteKey']),
                    optionalString(confirmation['operationState']),
                    optionalString(confirmation['reasoningEffort']),
                    optionalString(confirmation['status']) ?? 'observed',
                    observedAtMs,
                    operationalPayloadJson(confirmation),
                );
            }
        });
        tx();
        return { sdkSessionConfirmations: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readSdkSessionConfirmationRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_sdk_session_confirmations
                    ORDER BY observed_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * Reads bounded same-session binding evidence without scanning JSON payloads in application memory.
     *
     * @param {{
     *     providerId: string;
     *     previousProviderId?: string | null;
     *     bindingStrategy?: string;
     *     wireApi?: string | null;
     *     selectedRouteKey?: string | null;
     *     limit?: number;
     *     maxAgeMs?: number;
     *     now?: number;
     * }} options
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readSdkSessionBindingEvidenceRecords(options) {
        const providerId = optionalString(options.providerId);
        if (!providerId) throw new Error('MODEL_GATEWAY_BINDING_EVIDENCE_PROVIDER_ID_REQUIRED');
        const previousProviderId = optionalString(options.previousProviderId);
        const bindingStrategy = optionalString(options.bindingStrategy) ?? 'direct';
        const wireApi = optionalString(options.wireApi);
        const selectedRouteKey = optionalString(options.selectedRouteKey);
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 20, 200));
        const now = optionalInteger(options.now) ?? Date.now();
        const maxAgeMs = Math.max(1, optionalInteger(options.maxAgeMs) ?? 30 * 24 * 60 * 60_000);
        const minObservedAtMs = Math.max(0, now - maxAgeMs);
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_sdk_session_confirmations
                    WHERE provider_id = ?
                      AND (? IS NULL OR previous_provider_id = ?)
                      AND binding_strategy = ?
                      AND (? IS NULL OR wire_api = ?)
                      AND (? IS NULL OR selected_route_key = ?)
                      AND observed_at_ms >= ?
                    ORDER BY observed_at_ms DESC, confirmation_id DESC
                    LIMIT ?
                `,
            )
            .all(
                providerId,
                previousProviderId,
                previousProviderId,
                bindingStrategy,
                wireApi,
                wireApi,
                selectedRouteKey,
                selectedRouteKey,
                minObservedAtMs,
                limit,
            )
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} plans
     * @returns {Promise<{ standbyPlans: number }>}
     */
    async writeStandbyPlanRecords(plans) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_standby_plans
                (standby_plan_id, route_profile, status, route_count, provider_count, runtime_proof_count,
                 selected_route_key, generated_at_ms, source, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(standby_plan_id) DO UPDATE SET
                route_profile = excluded.route_profile,
                status = excluded.status,
                route_count = excluded.route_count,
                provider_count = excluded.provider_count,
                runtime_proof_count = excluded.runtime_proof_count,
                selected_route_key = excluded.selected_route_key,
                generated_at_ms = excluded.generated_at_ms,
                source = excluded.source,
                payload_json = excluded.payload_json
        `);
        const writable = plans.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const plan of writable) {
                const summary = isRecord(plan['summary']) ? plan['summary'] : {};
                const routes = Array.isArray(plan['routes']) ? plan['routes'].filter(isRecord) : [];
                const selectedRoute = routes.find((route) => route['source'] === 'selected') ?? routes[0];
                const generatedAtMs =
                    dateMs(plan['generatedAt']) ??
                    optionalInteger(plan['generatedAtMs']) ??
                    dateMs(plan['timestamp']) ??
                    Date.now();
                const routeProfile =
                    optionalString(plan['profileId']) ??
                    optionalString(plan['profile']) ??
                    optionalString(plan['routeProfile']) ??
                    DEFAULT_ROUTE_PROFILE;
                const routeCount = optionalInteger(summary['routeCount']) ?? routes.length;
                const providerCount =
                    optionalInteger(summary['providerCount']) ??
                    new Set(routes.map((route) => optionalString(route['providerId'])).filter(Boolean)).size;
                const runtimeProofCount =
                    optionalInteger(summary['runtimeProofCount']) ??
                    routes.filter((route) => route['hasRuntimeProof'] === true).length;
                const status = optionalString(plan['status']) ?? (plan['ok'] === false ? 'blocked' : 'ready');
                insert.run(
                    optionalString(plan['standbyPlanId']) ?? createStandbyPlanId(generatedAtMs),
                    routeProfile,
                    status,
                    routeCount,
                    providerCount,
                    runtimeProofCount,
                    optionalString(plan['selectedRouteKey']) ?? optionalString(selectedRoute?.['routeKey']),
                    generatedAtMs,
                    optionalString(plan['source']) ?? 'unknown',
                    operationalPayloadJson({
                        ...plan,
                        routeProfile,
                        status,
                        generatedAtMs,
                        summary: {
                            ...summary,
                            routeCount,
                            providerCount,
                            runtimeProofCount,
                        },
                    }),
                );
            }
        });
        tx();
        return { standbyPlans: writable.length };
    }

    /**
     * @param {{ limit?: number; profileId?: string; routeProfile?: string }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readStandbyPlanRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        const profile = optionalString(options.profileId) ?? optionalString(options.routeProfile);
        const statement = profile
            ? this.#db.prepare(
                  `
                    SELECT payload_json
                    FROM copilot_model_gateway_standby_plans
                    WHERE route_profile = ?
                    ORDER BY generated_at_ms DESC
                    LIMIT ?
                `,
              )
            : this.#db.prepare(
                  `
                    SELECT payload_json
                    FROM copilot_model_gateway_standby_plans
                    ORDER BY generated_at_ms DESC
                    LIMIT ?
                `,
              );
        const rows = profile ? statement.all(profile, limit) : statement.all(limit);
        return rows.map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Record<string, unknown>[]} runs
     * @returns {Promise<{ liveScenarioRuns: number }>}
     */
    async writeLiveScenarioRunRecords(runs) {
        const insert = this.#db.prepare(`
            INSERT INTO copilot_model_gateway_live_scenario_runs
                (run_id, scenario_kind, status, ok, started_at_ms, completed_at_ms, duration_ms,
                 exit_code, artifact_dir, summary_path, criteria_total, criteria_failed, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                scenario_kind = excluded.scenario_kind,
                status = excluded.status,
                ok = excluded.ok,
                started_at_ms = excluded.started_at_ms,
                completed_at_ms = excluded.completed_at_ms,
                duration_ms = excluded.duration_ms,
                exit_code = excluded.exit_code,
                artifact_dir = excluded.artifact_dir,
                summary_path = excluded.summary_path,
                criteria_total = excluded.criteria_total,
                criteria_failed = excluded.criteria_failed,
                payload_json = excluded.payload_json
        `);
        const writable = runs.filter(isRecord);
        const tx = this.#db.transaction(() => {
            for (const run of writable) {
                const startedAtMs = dateMs(run['startedAt']) ?? optionalInteger(run['startedAtMs']) ?? Date.now();
                const durationMs = optionalInteger(run['durationMs']) ?? 0;
                const completedAtMs =
                    dateMs(run['completedAt']) ??
                    optionalInteger(run['completedAtMs']) ??
                    Math.max(startedAtMs, startedAtMs + durationMs);
                const criteria = Array.isArray(run['criteria']) ? run['criteria'] : [];
                const criteriaTotal = optionalInteger(run['criteriaTotal']) ?? criteria.length;
                const criteriaFailed =
                    optionalInteger(run['criteriaFailed']) ??
                    criteria.filter(
                        (criterion) =>
                            isRecord(criterion) && criterion['pass'] !== true && criterion['severity'] !== 'warning',
                    ).length;
                const ok = run['ok'] === true || run['requiredOk'] === true;
                const status =
                    optionalString(run['status']) ?? (ok ? 'passed' : run['blocked'] === true ? 'blocked' : 'failed');
                insert.run(
                    optionalString(run['runId']) ?? createLiveScenarioRunId(completedAtMs),
                    optionalString(run['scenarioKind']) ?? optionalString(run['kind']) ?? 'unknown',
                    status,
                    ok ? 1 : 0,
                    startedAtMs,
                    completedAtMs,
                    Math.max(0, durationMs),
                    optionalInteger(run['exitCode']),
                    optionalString(run['artifactDir']),
                    optionalString(run['summaryPath']),
                    criteriaTotal,
                    criteriaFailed,
                    operationalPayloadJson({
                        ...run,
                        status,
                        ok,
                        startedAtMs,
                        completedAtMs,
                        durationMs,
                        criteriaTotal,
                        criteriaFailed,
                    }),
                );
            }
        });
        tx();
        return { liveScenarioRuns: writable.length };
    }

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    async readLiveScenarioRunRecords(options = {}) {
        const limit = Math.max(1, Math.min(optionalInteger(options.limit) ?? 50, 500));
        return this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_live_scenario_runs
                    ORDER BY completed_at_ms DESC
                    LIMIT ?
                `,
            )
            .all(limit)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
    }

    /**
     * @param {Partial<ReturnType<typeof normalizeStoredCatalogSnapshot>> & { source?: string }} snapshot
     * @returns {Promise<void>}
     */
    async writeSnapshot(snapshot) {
        const normalized = normalizeStoredCatalogSnapshot({
            ...snapshot,
            schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            source: snapshot.source ?? 'catalog',
        });
        const generatedAtMs = dateMs(normalized.generatedAt) ?? Date.now();
        const tx = this.#db.transaction(() => {
            for (const table of DELETE_TABLES_IN_ORDER) {
                this.#db.prepare(`DELETE FROM ${table}`).run();
            }
            this.#writeSnapshotMeta(normalized, generatedAtMs);
            this.#writeSources(normalized.sources, generatedAtMs);
            this.#writeModelEvidences(normalized.evidences, generatedAtMs);
            this.#writeProviderEvidences(normalized.providerEvidences, generatedAtMs);
            this.#writeModelProjections(normalized.projections, generatedAtMs);
            this.#writeProviderProjections(normalized.providerProjections, generatedAtMs);
            this.#writeRouteOptions(normalized.routeOptions, generatedAtMs);
            this.#writeAccountOverlays(normalized.accountOverlays, generatedAtMs);
            this.#writeAccountLimitSnapshots(normalized.accountOverlays, generatedAtMs);
            this.#writeImportRuns(normalized.importRuns, generatedAtMs);
            this.#writeRawPayloadRefs(normalized.rawPayloadRefs, generatedAtMs);
            this.#writeConflicts(normalized.conflicts, generatedAtMs);
            this.#writeEligibilityRuns(normalized.modelEligibilityRuns, generatedAtMs);
            this.#writeEligibilityDecisions(normalized.modelEligibilityDecisions, generatedAtMs);
        });
        tx();
    }

    /**
     * @param {ReturnType<typeof normalizeStoredCatalogSnapshot>} snapshot
     * @param {number} generatedAtMs
     */
    #writeSnapshotMeta(snapshot, generatedAtMs) {
        this.#db
            .prepare(
                `
                    INSERT OR REPLACE INTO copilot_model_gateway_snapshots
                        (snapshot_id, schema_version, source, generated_at_ms, active, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                `,
            )
            .run(
                ACTIVE_SNAPSHOT_ID,
                MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
                snapshot.source,
                generatedAtMs,
                1,
                payloadJson(snapshot),
            );
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeSources(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_catalog_sources
                (source_id, provider_id, source_kind, auth_mode, trust_tier, refresh_policy, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `${providerId(row)}:source`),
                providerId(row),
                optionalString(row['kind']) ?? 'unknown',
                optionalString(row['authMode']) ?? 'none',
                optionalString(row['trustTier']) ?? 'unknown',
                optionalString(row['refreshPolicy']) ?? 'manual',
                dateMs(row['updatedAt']) ?? dateMs(row['createdAt']) ?? generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeModelEvidences(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_model_evidence
                (evidence_id, provider_id, provider_model, route_profile, field_path, confidence, source_id,
                 observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `${modelKey(row)}:${optionalString(row['fieldPath']) ?? 'field'}`),
                providerId(row),
                providerModel(row),
                routeProfile(row),
                optionalString(row['fieldPath']) ?? 'unknown',
                optionalString(row['confidence']) ?? 'unknown',
                optionalString(row['sourceId']) ?? 'unknown',
                dateMs(row['observedAt']) ?? generatedAtMs,
                dateMs(row['expiresAt']),
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeProviderEvidences(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_provider_evidence
                (evidence_id, provider_id, subject_provider_id, field_path, confidence, source_id,
                 observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const subjectProviderId = optionalString(row['subjectProviderId']) ?? providerId(row);
            insert.run(
                idOr(row, `${providerId(row)}:${subjectProviderId}:${optionalString(row['fieldPath']) ?? 'field'}`),
                providerId(row),
                subjectProviderId,
                optionalString(row['fieldPath']) ?? 'unknown',
                optionalString(row['confidence']) ?? 'unknown',
                optionalString(row['sourceId']) ?? 'unknown',
                dateMs(row['observedAt']) ?? generatedAtMs,
                dateMs(row['expiresAt']),
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeModelProjections(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_model_projections
                (projection_key, provider_id, provider_model, route_profile, display_name,
                 lifecycle_status, updated_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                modelKey(row),
                providerId(row),
                providerModel(row),
                routeProfile(row),
                optionalString(row['displayName']) ?? providerModel(row),
                lifecycleStatus(row),
                generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeProviderProjections(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_provider_projections
                (projection_key, provider_id, subject_provider_id, display_name, updated_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const subjectProviderId = optionalString(row['subjectProviderId']) ?? providerId(row);
            insert.run(
                [providerId(row), subjectProviderId].join(':'),
                providerId(row),
                subjectProviderId,
                optionalString(row['displayName']) ?? subjectProviderId,
                generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeRouteOptions(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_route_options
                (route_key, provider_id, provider_model, route_profile, selector_kind, selector_syntax,
                 route_layer, wire_api, source_id, updated_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const normalizedPolicy = isRecord(row['normalizedPolicy']) ? row['normalizedPolicy'] : {};
            insert.run(
                routeKey(row),
                providerId(row),
                providerModel(row),
                routeProfile(row),
                selectorKind(row),
                selectorSyntax(row),
                optionalString(normalizedPolicy['routeLayer']),
                optionalString(normalizedPolicy['wireApi']),
                optionalString(row['sourceId']),
                generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeAccountOverlays(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_account_overlays
                (account_overlay_id, provider_id, account_scope, secret_ref, source_id, confidence,
                 observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `${providerId(row)}:${optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE}`),
                providerId(row),
                optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
                optionalString(row['secretRef']),
                optionalString(row['sourceId']),
                optionalString(row['confidence']) ?? 'unknown',
                dateMs(row['observedAt']) ?? generatedAtMs,
                dateMs(row['expiresAt']),
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeAccountLimitSnapshots(rows, generatedAtMs) {
        const insertQuota = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_account_quota_snapshots
                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                 observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertRateLimit = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_account_rate_limit_snapshots
                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                 reset_at_ms, observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertSpending = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_account_spending_snapshots
                (snapshot_key, account_overlay_id, provider_id, account_scope, secret_ref, status,
                 observed_at_ms, expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const overlayId = idOr(
                row,
                `${providerId(row)}:${optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE}`,
            );
            const accountScope = optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE;
            const secretRef = optionalString(row['secretRef']);
            const observedAtMs = dateMs(row['observedAt']) ?? generatedAtMs;
            const expiresAtMs = dateMs(row['expiresAt']);
            const limits = normalizeModelGatewayAccountLimitState(row, { now: observedAtMs });
            insertQuota.run(
                `${overlayId}:quota:${observedAtMs}`,
                overlayId,
                providerId(row),
                accountScope,
                secretRef,
                limits.quotaExhausted ? 'exhausted' : 'ok',
                observedAtMs,
                expiresAtMs,
                payloadJson(limits.quota),
            );
            insertRateLimit.run(
                `${overlayId}:rate-limit:${observedAtMs}`,
                overlayId,
                providerId(row),
                accountScope,
                secretRef,
                limits.rateLimited ? 'limited' : 'ok',
                dateMs(limits.resetAt),
                observedAtMs,
                expiresAtMs,
                payloadJson(limits.rateLimit),
            );
            insertSpending.run(
                `${overlayId}:spending:${observedAtMs}`,
                overlayId,
                providerId(row),
                accountScope,
                secretRef,
                limits.spendingExhausted ? 'exhausted' : 'ok',
                observedAtMs,
                expiresAtMs,
                payloadJson(limits.spending),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeImportRuns(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_import_runs
                (run_id, provider_id, source_id, status, started_at_ms, completed_at_ms, row_count, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `${providerId(row)}:${optionalString(row['sourceId']) ?? 'source'}:${generatedAtMs}`),
                providerId(row),
                optionalString(row['sourceId']) ?? 'unknown',
                optionalString(row['status']) ?? 'unknown',
                dateMs(row['startedAt']) ?? generatedAtMs,
                dateMs(row['completedAt']) ?? generatedAtMs,
                optionalInteger(row['rowCount']) ?? 0,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeRawPayloadRefs(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_raw_payload_refs
                (raw_payload_ref, provider_id, source_id, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `${providerId(row)}:${optionalString(row['sourceId']) ?? 'source'}:${generatedAtMs}`),
                providerId(row),
                optionalString(row['sourceId']) ?? 'unknown',
                dateMs(row['observedAt']) ?? generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeConflicts(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_conflicts
                (conflict_key, projection_key, field_path, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const projectionKey = optionalString(row['projectionKey']) ?? 'unknown';
            const fieldPath = optionalString(row['fieldPath']) ?? 'unknown';
            insert.run(
                idOr(row, `${projectionKey}:${fieldPath}:${optionalString(row['selectedEvidenceId']) ?? 'selected'}`),
                projectionKey,
                fieldPath,
                generatedAtMs,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeEligibilityRuns(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_eligibility_runs
                (run_id, policy_profile, task_profile, account_scope, status, started_at_ms, completed_at_ms,
                 model_count, eligible_count, unknown_count, excluded_count, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            insert.run(
                idOr(row, `eligibility:${generatedAtMs}`),
                optionalString(row['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
                optionalString(row['taskProfile']) ?? DEFAULT_TASK_PROFILE,
                optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
                optionalString(row['status']) ?? 'completed',
                dateMs(row['startedAt']) ?? generatedAtMs,
                dateMs(row['completedAt']) ?? generatedAtMs,
                optionalInteger(row['modelCount']) ?? 0,
                optionalInteger(row['eligibleCount']) ?? 0,
                optionalInteger(row['unknownCount']) ?? 0,
                optionalInteger(row['excludedCount']) ?? 0,
                payloadJson(row),
            );
        }
    }

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {number} generatedAtMs
     */
    #writeEligibilityDecisions(rows, generatedAtMs) {
        const insert = this.#db.prepare(`
            INSERT OR REPLACE INTO copilot_model_gateway_eligibility_decisions
                (decision_key, run_id, provider_id, provider_model, route_profile, selector_kind, selector_syntax,
                 account_scope, policy_profile, task_profile, include, disposition, primary_reason, observed_at_ms,
                 expires_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const reasons = Array.isArray(row['reasons']) ? row['reasons'] : [];
            insert.run(
                eligibilityDecisionKey(row),
                optionalString(row['runId']),
                providerId(row),
                providerModel(row),
                routeProfile(row),
                selectorKind(row),
                selectorSyntax(row),
                optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
                optionalString(row['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
                optionalString(row['taskProfile']) ?? DEFAULT_TASK_PROFILE,
                row['include'] === true ? 1 : 0,
                optionalString(row['disposition']) ?? 'unknown',
                optionalString(reasons[0]),
                dateMs(row['observedAt']) ?? generatedAtMs,
                dateMs(row['expiresAt']),
                payloadJson(row),
            );
        }
    }
}
