// @ts-check
/**
 * SQLite schema for the model-gateway catalog domain.
 *
 * The JSON catalog remains the active store. This schema is the normalized target that lets migrations reserve stable
 * tables for catalog metadata, account overlays, pre-runtime eligibility and route decisions without mixing layers.
 *
 * @module copilot/model-gateway/catalog/sqlite-schema
 */

export const MODEL_GATEWAY_SQLITE_SCHEMA_VERSION = 2;

export const MODEL_GATEWAY_SQLITE_TABLES = Object.freeze([
    'copilot_model_gateway_snapshots',
    'copilot_model_gateway_catalog_sources',
    'copilot_model_gateway_model_evidence',
    'copilot_model_gateway_provider_evidence',
    'copilot_model_gateway_model_projections',
    'copilot_model_gateway_provider_projections',
    'copilot_model_gateway_route_options',
    'copilot_model_gateway_account_overlays',
    'copilot_model_gateway_account_quota_snapshots',
    'copilot_model_gateway_account_rate_limit_snapshots',
    'copilot_model_gateway_account_spending_snapshots',
    'copilot_model_gateway_import_runs',
    'copilot_model_gateway_raw_payload_refs',
    'copilot_model_gateway_conflicts',
    'copilot_model_gateway_eligibility_runs',
    'copilot_model_gateway_eligibility_decisions',
    'copilot_model_gateway_runtime_probe_runs',
    'copilot_model_gateway_runtime_probe_results',
    'copilot_model_gateway_health_observations',
    'copilot_model_gateway_route_decisions',
]);

export const MODEL_GATEWAY_SQLITE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS copilot_model_gateway_snapshots (
        snapshot_id     TEXT PRIMARY KEY,
        schema_version  INTEGER NOT NULL,
        source          TEXT NOT NULL,
        generated_at_ms INTEGER NOT NULL,
        active          INTEGER NOT NULL DEFAULT 1,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_snapshots_active
        ON copilot_model_gateway_snapshots(active, generated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_catalog_sources (
        source_id       TEXT PRIMARY KEY,
        provider_id     TEXT NOT NULL,
        source_kind     TEXT NOT NULL,
        auth_mode       TEXT NOT NULL DEFAULT 'none',
        trust_tier      TEXT NOT NULL DEFAULT 'unknown',
        refresh_policy  TEXT NOT NULL DEFAULT 'manual',
        observed_at_ms  INTEGER NOT NULL,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_catalog_sources_provider
        ON copilot_model_gateway_catalog_sources(provider_id, source_kind);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_model_evidence (
        evidence_id     TEXT PRIMARY KEY,
        provider_id     TEXT NOT NULL,
        provider_model  TEXT NOT NULL,
        route_profile   TEXT NOT NULL DEFAULT 'default',
        field_path      TEXT NOT NULL,
        confidence      TEXT NOT NULL DEFAULT 'unknown',
        source_id       TEXT NOT NULL,
        observed_at_ms  INTEGER NOT NULL,
        expires_at_ms   INTEGER,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_model_evidence_model
        ON copilot_model_gateway_model_evidence(provider_id, provider_model, route_profile);
    CREATE INDEX IF NOT EXISTS idx_mg_model_evidence_field
        ON copilot_model_gateway_model_evidence(field_path, confidence);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_provider_evidence (
        evidence_id          TEXT PRIMARY KEY,
        provider_id          TEXT NOT NULL,
        subject_provider_id  TEXT NOT NULL,
        field_path           TEXT NOT NULL,
        confidence           TEXT NOT NULL DEFAULT 'unknown',
        source_id            TEXT NOT NULL,
        observed_at_ms       INTEGER NOT NULL,
        expires_at_ms        INTEGER,
        payload_json         TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_provider_evidence_subject
        ON copilot_model_gateway_provider_evidence(provider_id, subject_provider_id);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_model_projections (
        projection_key   TEXT PRIMARY KEY,
        provider_id      TEXT NOT NULL,
        provider_model   TEXT NOT NULL,
        route_profile    TEXT NOT NULL DEFAULT 'default',
        display_name     TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL DEFAULT 'unknown',
        updated_at_ms    INTEGER NOT NULL,
        payload_json     TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_model_projections_provider
        ON copilot_model_gateway_model_projections(provider_id, provider_model, route_profile);
    CREATE INDEX IF NOT EXISTS idx_mg_model_projections_lifecycle
        ON copilot_model_gateway_model_projections(lifecycle_status, updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_provider_projections (
        projection_key       TEXT PRIMARY KEY,
        provider_id          TEXT NOT NULL,
        subject_provider_id  TEXT NOT NULL,
        display_name         TEXT NOT NULL,
        updated_at_ms        INTEGER NOT NULL,
        payload_json         TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_provider_projections_subject
        ON copilot_model_gateway_provider_projections(provider_id, subject_provider_id);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_route_options (
        route_key        TEXT PRIMARY KEY,
        provider_id      TEXT NOT NULL,
        provider_model   TEXT NOT NULL,
        route_profile    TEXT NOT NULL DEFAULT 'default',
        selector_kind    TEXT NOT NULL,
        selector_syntax  TEXT NOT NULL,
        route_layer      TEXT,
        wire_api         TEXT,
        source_id        TEXT,
        updated_at_ms    INTEGER NOT NULL,
        payload_json     TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_route_options_model
        ON copilot_model_gateway_route_options(provider_id, provider_model, route_profile);
    CREATE INDEX IF NOT EXISTS idx_mg_route_options_selector
        ON copilot_model_gateway_route_options(selector_kind, route_layer, wire_api);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_account_overlays (
        account_overlay_id  TEXT PRIMARY KEY,
        provider_id         TEXT NOT NULL,
        account_scope       TEXT NOT NULL DEFAULT 'default',
        secret_ref          TEXT,
        source_id           TEXT,
        confidence          TEXT NOT NULL DEFAULT 'unknown',
        observed_at_ms      INTEGER NOT NULL,
        expires_at_ms       INTEGER,
        payload_json        TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_account_overlays_provider
        ON copilot_model_gateway_account_overlays(provider_id, account_scope, secret_ref);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_account_quota_snapshots (
        snapshot_key       TEXT PRIMARY KEY,
        account_overlay_id TEXT NOT NULL,
        provider_id        TEXT NOT NULL,
        account_scope      TEXT NOT NULL DEFAULT 'default',
        secret_ref         TEXT,
        status             TEXT NOT NULL,
        observed_at_ms     INTEGER NOT NULL,
        expires_at_ms      INTEGER,
        payload_json       TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_account_quota_snapshots_provider
        ON copilot_model_gateway_account_quota_snapshots(provider_id, account_scope, secret_ref, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_account_rate_limit_snapshots (
        snapshot_key       TEXT PRIMARY KEY,
        account_overlay_id TEXT NOT NULL,
        provider_id        TEXT NOT NULL,
        account_scope      TEXT NOT NULL DEFAULT 'default',
        secret_ref         TEXT,
        status             TEXT NOT NULL,
        reset_at_ms        INTEGER,
        observed_at_ms     INTEGER NOT NULL,
        expires_at_ms      INTEGER,
        payload_json       TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_account_rate_limit_snapshots_provider
        ON copilot_model_gateway_account_rate_limit_snapshots(provider_id, account_scope, secret_ref, status, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_account_spending_snapshots (
        snapshot_key       TEXT PRIMARY KEY,
        account_overlay_id TEXT NOT NULL,
        provider_id        TEXT NOT NULL,
        account_scope      TEXT NOT NULL DEFAULT 'default',
        secret_ref         TEXT,
        status             TEXT NOT NULL,
        observed_at_ms     INTEGER NOT NULL,
        expires_at_ms      INTEGER,
        payload_json       TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_account_spending_snapshots_provider
        ON copilot_model_gateway_account_spending_snapshots(provider_id, account_scope, secret_ref, status, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_import_runs (
        run_id          TEXT PRIMARY KEY,
        provider_id     TEXT NOT NULL,
        source_id       TEXT NOT NULL,
        status          TEXT NOT NULL,
        started_at_ms   INTEGER NOT NULL,
        completed_at_ms INTEGER NOT NULL,
        row_count       INTEGER NOT NULL DEFAULT 0,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_import_runs_source
        ON copilot_model_gateway_import_runs(source_id, completed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_raw_payload_refs (
        raw_payload_ref TEXT PRIMARY KEY,
        provider_id     TEXT NOT NULL,
        source_id       TEXT NOT NULL,
        observed_at_ms  INTEGER NOT NULL,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_raw_payload_refs_source
        ON copilot_model_gateway_raw_payload_refs(source_id, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_conflicts (
        conflict_key   TEXT PRIMARY KEY,
        projection_key TEXT NOT NULL,
        field_path     TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        payload_json   TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_conflicts_projection
        ON copilot_model_gateway_conflicts(projection_key, field_path);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_eligibility_runs (
        run_id          TEXT PRIMARY KEY,
        policy_profile  TEXT NOT NULL DEFAULT 'default',
        task_profile    TEXT NOT NULL DEFAULT 'default',
        account_scope   TEXT NOT NULL DEFAULT 'default',
        status          TEXT NOT NULL,
        started_at_ms   INTEGER NOT NULL,
        completed_at_ms INTEGER NOT NULL,
        model_count     INTEGER NOT NULL DEFAULT 0,
        eligible_count  INTEGER NOT NULL DEFAULT 0,
        unknown_count   INTEGER NOT NULL DEFAULT 0,
        excluded_count  INTEGER NOT NULL DEFAULT 0,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_eligibility_runs_policy
        ON copilot_model_gateway_eligibility_runs(policy_profile, completed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_eligibility_decisions (
        decision_key    TEXT PRIMARY KEY,
        run_id          TEXT,
        provider_id     TEXT NOT NULL,
        provider_model  TEXT NOT NULL,
        route_profile   TEXT NOT NULL DEFAULT 'default',
        selector_kind   TEXT NOT NULL,
        account_scope   TEXT NOT NULL DEFAULT 'default',
        policy_profile  TEXT NOT NULL DEFAULT 'default',
        task_profile    TEXT NOT NULL DEFAULT 'default',
        include         INTEGER NOT NULL,
        disposition     TEXT NOT NULL,
        primary_reason  TEXT,
        observed_at_ms  INTEGER NOT NULL,
        expires_at_ms   INTEGER,
        payload_json    TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES copilot_model_gateway_eligibility_runs(run_id) ON DELETE SET NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_eligibility_decisions_model
        ON copilot_model_gateway_eligibility_decisions(provider_id, provider_model, route_profile);
    CREATE INDEX IF NOT EXISTS idx_mg_eligibility_decisions_policy
        ON copilot_model_gateway_eligibility_decisions(policy_profile, task_profile, account_scope, include);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_runtime_probe_runs (
        run_id          TEXT PRIMARY KEY,
        probe_profile   TEXT NOT NULL DEFAULT 'default',
        account_scope   TEXT NOT NULL DEFAULT 'default',
        status          TEXT NOT NULL,
        started_at_ms   INTEGER NOT NULL,
        completed_at_ms INTEGER NOT NULL,
        model_count     INTEGER NOT NULL DEFAULT 0,
        success_count   INTEGER NOT NULL DEFAULT 0,
        failure_count   INTEGER NOT NULL DEFAULT 0,
        skipped_count   INTEGER NOT NULL DEFAULT 0,
        payload_json    TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_runtime_probe_runs_profile
        ON copilot_model_gateway_runtime_probe_runs(probe_profile, completed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_runtime_probe_results (
        result_key     TEXT PRIMARY KEY,
        run_id         TEXT,
        provider_id    TEXT NOT NULL,
        provider_model TEXT NOT NULL,
        route_profile  TEXT NOT NULL DEFAULT 'default',
        probe_kind     TEXT NOT NULL,
        wire_api       TEXT,
        ok             INTEGER NOT NULL,
        status         TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        expires_at_ms  INTEGER,
        payload_json   TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES copilot_model_gateway_runtime_probe_runs(run_id) ON DELETE SET NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_runtime_probe_results_model
        ON copilot_model_gateway_runtime_probe_results(provider_id, provider_model, route_profile, probe_kind);
    CREATE INDEX IF NOT EXISTS idx_mg_runtime_probe_results_status
        ON copilot_model_gateway_runtime_probe_results(probe_kind, ok, status, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_health_observations (
        observation_key    TEXT PRIMARY KEY,
        provider_id        TEXT NOT NULL,
        provider_model     TEXT NOT NULL,
        route_profile      TEXT NOT NULL DEFAULT 'default',
        health_scope       TEXT NOT NULL DEFAULT 'runtime',
        status             TEXT NOT NULL,
        classified_failure TEXT,
        observed_at_ms     INTEGER NOT NULL,
        expires_at_ms      INTEGER,
        payload_json       TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_health_observations_model
        ON copilot_model_gateway_health_observations(provider_id, provider_model, route_profile, health_scope);
    CREATE INDEX IF NOT EXISTS idx_mg_health_observations_status
        ON copilot_model_gateway_health_observations(status, observed_at_ms DESC);

    CREATE TABLE IF NOT EXISTS copilot_model_gateway_route_decisions (
        decision_id    TEXT PRIMARY KEY,
        task_profile   TEXT NOT NULL,
        route_profile  TEXT NOT NULL DEFAULT 'default',
        policy_profile TEXT NOT NULL DEFAULT 'default',
        provider_id    TEXT,
        provider_model TEXT,
        selected       INTEGER NOT NULL,
        decided_at_ms  INTEGER NOT NULL,
        payload_json   TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_mg_route_decisions_task
        ON copilot_model_gateway_route_decisions(task_profile, route_profile, decided_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_mg_route_decisions_model
        ON copilot_model_gateway_route_decisions(provider_id, provider_model, selected);
`;
