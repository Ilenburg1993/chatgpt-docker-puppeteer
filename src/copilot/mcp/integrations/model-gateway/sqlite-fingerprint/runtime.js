// @ts-check
/**
 * Process-scoped SQLite fingerprint for Model Gateway readiness reuse.
 *
 * The integration owner receives its database from MCP process composition. Wire tools never discover application
 * infrastructure. An unavailable database deliberately disables cache reuse rather than risking stale readiness data.
 *
 * @module copilot/mcp/integrations/model-gateway/sqlite-fingerprint/runtime
 */

const MODEL_GATEWAY_FINGERPRINT_TABLES = Object.freeze([
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
]);

/**
 * @param {() => import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} readDatabase
 */
export function createModelGatewaySqliteFingerprintCapability(readDatabase) {
    if (typeof readDatabase !== 'function') {
        throw new TypeError('Model Gateway SQLite fingerprint capability requires a database reader.');
    }
    return Object.freeze({ read: () => readModelGatewaySqliteFingerprint(readDatabase()) });
}

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} db
 */
export function readModelGatewaySqliteFingerprint(db) {
    if (!db) return `unavailable:not-configured:${Date.now()}`;
    try {
        const active = /** @type {{ generated_at_ms?: number | null; payload_bytes?: number | null } | undefined} */ (
            db
                .prepare(
                    `SELECT generated_at_ms, length(payload_json) AS payload_bytes
                     FROM copilot_model_gateway_snapshots
                     WHERE snapshot_id = 'active'
                     LIMIT 1`,
                )
                .get()
        );
        const runtime = /** @type {{
          probe_runs?: number | null;
          probe_run_max?: number | null;
          probe_results?: number | null;
          probe_result_max?: number | null;
          health_rows?: number | null;
          health_max?: number | null;
      } | undefined} */ (
            db
                .prepare(
                    `SELECT
                        (SELECT COUNT(*) FROM copilot_model_gateway_runtime_probe_runs) AS probe_runs,
                        (SELECT MAX(completed_at_ms) FROM copilot_model_gateway_runtime_probe_runs) AS probe_run_max,
                        (SELECT COUNT(*) FROM copilot_model_gateway_runtime_probe_results) AS probe_results,
                        (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_runtime_probe_results) AS probe_result_max,
                        (SELECT COUNT(*) FROM copilot_model_gateway_health_observations) AS health_rows,
                        (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_health_observations) AS health_max`,
                )
                .get()
        );
        const catalogCounts = MODEL_GATEWAY_FINGERPRINT_TABLES.map((table) => {
            const row = /** @type {{ count?: number | null } | undefined} */ (
                db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            );
            return Number(row?.count ?? -1);
        });
        return JSON.stringify({
            activeGeneratedAtMs: Number(active?.generated_at_ms ?? 0),
            activePayloadBytes: Number(active?.payload_bytes ?? 0),
            catalogCounts,
            runtime: {
                probeRuns: Number(runtime?.probe_runs ?? 0),
                probeRunMax: Number(runtime?.probe_run_max ?? 0),
                probeResults: Number(runtime?.probe_results ?? 0),
                probeResultMax: Number(runtime?.probe_result_max ?? 0),
                healthRows: Number(runtime?.health_rows ?? 0),
                healthMax: Number(runtime?.health_max ?? 0),
            },
        });
    } catch {
        return `unavailable:query-failed:${Date.now()}`;
    }
}
