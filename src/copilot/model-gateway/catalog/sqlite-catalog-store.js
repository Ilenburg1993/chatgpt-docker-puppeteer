// @ts-check
/**
 * SQLite-backed universal catalog store.
 *
 * This is the first normalized durable store for the model-gateway catalog. The JSON snapshot remains useful for debug
 * and interchange, while this class writes the same redacted snapshot into separated relational layers.
 *
 * @module copilot/model-gateway/catalog/sqlite-catalog-store
 */

import Database from 'better-sqlite3';

import { getCopilotDb } from '../../db/sqlite.js';
import { normalizeModelGatewayAccountLimitState } from '../account-access/limits.js';
import { MODEL_GATEWAY_CATALOG_SCHEMA_VERSION } from './contracts.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { toOpenAIModelCatalogList } from './openai-schema.js';
import { MODEL_GATEWAY_SQLITE_SCHEMA_SQL, MODEL_GATEWAY_SQLITE_SCHEMA_VERSION, MODEL_GATEWAY_SQLITE_TABLES } from './sqlite-schema.js';

const ACTIVE_SNAPSHOT_ID = 'active';
const DEFAULT_ROUTE_PROFILE = 'default';
const DEFAULT_ACCOUNT_SCOPE = 'default';
const DEFAULT_POLICY_PROFILE = 'default';
const DEFAULT_TASK_PROFILE = 'default';

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
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function sqliteUserVersion(db) {
    return optionalInteger(db.pragma('user_version', { simple: true })) ?? 0;
}

/**
 * @param {import('better-sqlite3').Database} db
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
 * @param {import('better-sqlite3').Database} db
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
 * @returns {number}
 */
function latestRuntimeAt(row) {
    return Math.max(
        dateMs(row['lastFailureAt']) ?? 0,
        dateMs(row['lastSuccessAt']) ?? 0,
        dateMs(row['lastAgentProbeFailureAt']) ?? 0,
        dateMs(row['lastAgentProbeSuccessAt']) ?? 0,
    );
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function runtimeHealthStatus(record) {
    const lastStatus = optionalString(record['lastStatus']);
    const agentStatus = optionalString(record['agentProbeStatus']);
    const chatFailed = lastStatus === 'failed' && (dateMs(record['lastFailureAt']) ?? 0) >= (dateMs(record['lastSuccessAt']) ?? 0);
    const agentFailed =
        agentStatus === 'failed' &&
        (dateMs(record['lastAgentProbeFailureAt']) ?? 0) >= (dateMs(record['lastAgentProbeSuccessAt']) ?? 0);
    if (chatFailed || agentFailed) return 'failed';
    if (lastStatus === 'ok' || agentStatus === 'ok') return 'ok';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function runtimeFailureContext(record) {
    return (
        optionalString(record['lastFailureKind']) ??
        optionalString(record['lastErrorContext']) ??
        optionalString(record['lastAgentProbeErrorContext']) ??
        optionalString(record['lastMessage']) ??
        optionalString(record['lastAgentProbeMessage'])
    );
}

export class SqliteModelGatewayCatalogStore {
    /** @type {import('better-sqlite3').Database} */
    #db;

    /**
     * @param {{ db?: import('better-sqlite3').Database; dbPath?: string }} [options]
     */
    constructor(options = {}) {
        this.#db = options.db ?? (options.dbPath ? new Database(options.dbPath) : getCopilotDb());
        this.#db.pragma('foreign_keys = ON');
        ensureCompatibleSqliteSchemaVersion(this.#db);
        this.#db.exec(MODEL_GATEWAY_SQLITE_SCHEMA_SQL);
        this.#db.pragma(`user_version = ${MODEL_GATEWAY_SQLITE_SCHEMA_VERSION}`);
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
            providerProjections: readPayloadRows(this.#db, 'copilot_model_gateway_provider_projections', 'projection_key'),
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
     *     routeDecisionRows: number;
     * }>}
     */
    async readStorageDiagnostics() {
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
            routeDecisionRows: tableCounts['copilot_model_gateway_route_decisions'] ?? 0,
        };
    }

    /**
     * @param {Record<string, unknown>[]} records
     * @param {{ runId?: string; observedAt?: string | number | Date }} [options]
     * @returns {Promise<{ runId: string; healthObservations: number; probeResults: number }>}
     */
    async writeRuntimeHealthRecords(records, options = {}) {
        const observedAtMs = dateMs(options.observedAt) ?? Date.now();
        const runId = optionalString(options.runId) ?? `model-gateway:runtime-health:${observedAtMs}`;
        let healthObservations = 0;
        let probeResults = 0;
        const tx = this.#db.transaction(() => {
            this.#db.prepare('DELETE FROM copilot_model_gateway_runtime_probe_results').run();
            this.#db.prepare('DELETE FROM copilot_model_gateway_runtime_probe_runs').run();
            this.#db.prepare('DELETE FROM copilot_model_gateway_health_observations').run();
            const insertRun = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_runs
                    (run_id, probe_profile, account_scope, status, started_at_ms, completed_at_ms,
                     model_count, success_count, failure_count, skipped_count, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertHealth = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_health_observations
                    (observation_key, provider_id, provider_model, route_profile, health_scope, status,
                     classified_failure, observed_at_ms, expires_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertProbe = this.#db.prepare(`
                INSERT INTO copilot_model_gateway_runtime_probe_results
                    (result_key, run_id, provider_id, provider_model, route_profile, probe_kind, wire_api,
                     ok, status, observed_at_ms, expires_at_ms, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                records.length,
                0,
                0,
                0,
                payloadJson({ source: 'byok-provider-health', records: records.length }),
            );
            for (const record of records.filter(isRecord)) {
                const observed = latestRuntimeAt(record) || observedAtMs;
                const status = runtimeHealthStatus(record);
                const healthKey = optionalString(record['key']) ?? `${routeProfile(record)}|${providerId(record)}|${providerModel(record)}`;
                insertHealth.run(
                    healthKey,
                    providerId(record),
                    providerModel(record),
                    routeProfile(record),
                    'runtime',
                    status,
                    runtimeFailureContext(record),
                    observed,
                    null,
                    payloadJson(record),
                );
                healthObservations += 1;
                const probes = isRecord(record['probes']) ? record['probes'] : {};
                for (const [probeKind, probeValue] of Object.entries(probes)) {
                    if (!isRecord(probeValue)) continue;
                    const ok = probeValue['ok'] === true;
                    if (ok) probeSuccessCount += 1;
                    else probeFailureCount += 1;
                    insertProbe.run(
                        `${healthKey}:${probeKind}`,
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
                        payloadJson({ ...probeValue, providerId: providerId(record), providerModel: providerModel(record), routeProfile: routeProfile(record) }),
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
                    payloadJson({ source: 'byok-provider-health', records: records.length, probeResults }),
                    runId,
                );
        });
        tx();
        return { runId, healthObservations, probeResults };
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
                    SELECT payload_json
                    FROM copilot_model_gateway_health_observations
                    WHERE provider_id = ?
                      AND provider_model = ?
                      AND (route_profile = ? OR ? = ?)
                    ORDER BY observed_at_ms DESC
                    LIMIT 1
                `,
            )
            .all(provider, model, route, route, DEFAULT_ROUTE_PROFILE)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
        const probes = this.#db
            .prepare(
                `
                    SELECT payload_json
                    FROM copilot_model_gateway_runtime_probe_results
                    WHERE provider_id = ?
                      AND provider_model = ?
                      AND (route_profile = ? OR ? = ?)
                    ORDER BY observed_at_ms DESC, probe_kind ASC
                `,
            )
            .all(provider, model, route, route, DEFAULT_ROUTE_PROFILE)
            .map((row) => parsePayload(/** @type {{ payload_json: string }} */ (row).payload_json));
        return {
            health: healthRows[0] ?? null,
            probes,
        };
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
                    payloadJson(event),
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
            const overlayId = idOr(row, `${providerId(row)}:${optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE}`);
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
                (decision_key, run_id, provider_id, provider_model, route_profile, selector_kind, account_scope,
                 policy_profile, task_profile, include, disposition, primary_reason, observed_at_ms, expires_at_ms,
                 payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
            const reasons = Array.isArray(row['reasons']) ? row['reasons'] : [];
            insert.run(
                [
                    optionalString(row['policyProfile']) ?? DEFAULT_POLICY_PROFILE,
                    optionalString(row['taskProfile']) ?? DEFAULT_TASK_PROFILE,
                    optionalString(row['accountScope']) ?? DEFAULT_ACCOUNT_SCOPE,
                    modelKey(row),
                    selectorKind(row),
                ].join(':'),
                optionalString(row['runId']),
                providerId(row),
                providerModel(row),
                routeProfile(row),
                selectorKind(row),
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
