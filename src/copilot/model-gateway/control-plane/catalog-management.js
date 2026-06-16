// @ts-check
/**
 * Catalog collection and refresh use cases shared by operator and LLM-B adapters.
 *
 * @module copilot/model-gateway/control-plane/catalog-management
 */

import { createDefaultModelGatewayCatalogImporters } from '../catalog/default-importers.js';
import { JsonModelGatewayCatalogStore } from '../catalog/json-catalog-store.js';
import { planModelGatewayCatalogRefresh } from '../catalog/refresh-plan.js';
import { refreshModelGatewayCatalog } from '../catalog/refresh.js';
import { mirrorModelGatewayCatalogSnapshotToSqlite } from '../catalog/sqlite-migration.js';
import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import { createEnvSecretRegistry } from '../secrets/env-secret-registry.js';
import { assertModelGatewayCatalogWritePort } from './ports.js';
import { createModelGatewayControlPlaneResult } from './result-envelope.js';

const OPERATIONAL_RETENTION_TABLES = Object.freeze([
    'copilot_model_gateway_account_quota_snapshots',
    'copilot_model_gateway_account_rate_limit_snapshots',
    'copilot_model_gateway_account_spending_snapshots',
    'copilot_model_gateway_route_decisions',
    'copilot_model_gateway_refresh_log_events',
    'copilot_model_gateway_runtime_probe_runs',
    'copilot_model_gateway_runtime_probe_results',
    'copilot_model_gateway_health_observations',
    'copilot_model_gateway_automation_decisions',
    'copilot_model_gateway_automation_policy_snapshots',
    'copilot_model_gateway_automation_effect_applications',
    'copilot_model_gateway_recovery_attempts',
    'copilot_model_gateway_sdk_session_handoffs',
    'copilot_model_gateway_sdk_session_confirmations',
    'copilot_model_gateway_standby_plans',
    'copilot_model_gateway_live_scenario_runs',
]);

/**
 * @param {number} maxRowsPerLedger
 */
function uniformOperationalRetentionPolicy(maxRowsPerLedger) {
    return {
        accountQuotaSnapshotMaxRows: maxRowsPerLedger,
        accountRateLimitSnapshotMaxRows: maxRowsPerLedger,
        accountSpendingSnapshotMaxRows: maxRowsPerLedger,
        routeDecisionMaxRows: maxRowsPerLedger,
        refreshLogMaxRows: maxRowsPerLedger,
        runtimeProbeRunMaxRows: maxRowsPerLedger,
        runtimeProbeResultMaxRows: maxRowsPerLedger,
        healthObservationMaxRows: maxRowsPerLedger,
        automationDecisionMaxRows: maxRowsPerLedger,
        automationPolicySnapshotMaxRows: maxRowsPerLedger,
        automationEffectApplicationMaxRows: maxRowsPerLedger,
        recoveryAttemptMaxRows: maxRowsPerLedger,
        sdkSessionHandoffMaxRows: maxRowsPerLedger,
        sdkSessionConfirmationMaxRows: maxRowsPerLedger,
        standbyPlanMaxRows: maxRowsPerLedger,
        liveScenarioRunMaxRows: maxRowsPerLedger,
    };
}

export class ModelGatewayCatalogControlPlane {
    /** @type {JsonModelGatewayCatalogStore} */
    #catalogStore;
    /** @type {SqliteModelGatewayCatalogStore} */
    #sqliteStore;
    /** @type {Record<string, string | undefined>} */
    #env;

    /**
     * @param {{
     *   catalogStore?: JsonModelGatewayCatalogStore;
     *   sqliteStore?: SqliteModelGatewayCatalogStore;
     *   env?: Record<string, string | undefined>;
     * }} [options]
     */
    constructor(options = {}) {
        this.#catalogStore = /** @type {JsonModelGatewayCatalogStore} */ (
            assertModelGatewayCatalogWritePort(options.catalogStore ?? new JsonModelGatewayCatalogStore())
        );
        this.#sqliteStore = options.sqliteStore ?? new SqliteModelGatewayCatalogStore();
        this.#env = options.env ?? process.env;
    }

    /**
     * @param {{
     *   includePublic: boolean;
     *   includeAuthenticated: boolean;
     *   force: boolean;
     *   sourceIds: string[];
     *   maxSourceResults: number;
     * }} input
     */
    async planRefresh(input) {
        const snapshot = await this.#catalogStore.readSnapshot();
        const importers = createDefaultModelGatewayCatalogImporters({
            env: this.#env,
            includePublic: input.includePublic,
            includeAuthenticated: input.includeAuthenticated,
        });
        const plan = planModelGatewayCatalogRefresh({
            importers,
            sources: snapshot.sources,
            force: input.force,
            ...(input.sourceIds.length > 0 ? { sourceIds: input.sourceIds } : {}),
        });
        return createModelGatewayControlPlaneResult({
            operation: 'catalog.refresh',
            status: 'planned',
            dryRun: true,
            data: {
                snapshotId: snapshot.snapshotId,
                generatedAt: snapshot.generatedAt,
                importerCount: plan.importerCount,
                selectedCount: plan.selected.length,
                skippedCount: plan.skipped.length,
                selected: plan.selected.slice(0, input.maxSourceResults),
                skipped: plan.skipped.slice(0, input.maxSourceResults),
                truncated:
                    plan.selected.length > input.maxSourceResults || plan.skipped.length > input.maxSourceResults,
            },
            warnings: plan.selected.length === 0 ? ['no_catalog_sources_selected'] : [],
            nextActions:
                plan.selected.length > 0
                    ? ['review_plan_then_apply_with_confirm_true']
                    : ['adjust_source_filters_or_force_policy'],
        });
    }

    /**
     * @param {{
     *   includePublic: boolean;
     *   includeAuthenticated: boolean;
     *   force: boolean;
     *   sourceIds: string[];
     *   refreshAccountOverlays: boolean;
     *   maxSourceResults: number;
     *   idempotencyKey: string;
     * }} input
     */
    async applyRefresh(input) {
        const importers = createDefaultModelGatewayCatalogImporters({
            env: this.#env,
            includePublic: input.includePublic,
            includeAuthenticated: input.includeAuthenticated,
        });
        const result = await refreshModelGatewayCatalog({
            store: this.#catalogStore,
            importers,
            incremental: true,
            force: input.force,
            ...(input.sourceIds.length > 0 ? { sourceIds: input.sourceIds } : {}),
            refreshAccountOverlays: input.refreshAccountOverlays,
            eligibility: {
                enabled: true,
                secretRegistry: createEnvSecretRegistry({ env: this.#env }),
                policy: {
                    unknownAccessPolicy: 'allow_probe',
                    policyProfile: 'llm-b-refresh',
                },
            },
            writePolicy: 'commit',
            lockKey: this.#catalogStore.filePath,
            retentionPolicy: {
                maxImportRuns: 500,
                maxRawPayloadRefs: 500,
                maxConflicts: 1_000,
                maxModelEligibilityRuns: 200,
            },
        });
        const mirror = await mirrorModelGatewayCatalogSnapshotToSqlite({
            sourceStore: this.#catalogStore,
            sqliteStore: this.#sqliteStore,
        });
        const selected = result.refreshPlan?.selected ?? [];
        const skipped = result.refreshPlan?.skipped ?? [];
        return createModelGatewayControlPlaneResult({
            operation: 'catalog.refresh',
            ok: result.writePolicy.committed && mirror.parity.ok,
            status: result.writePolicy.committed && mirror.parity.ok ? 'committed' : 'parity_failed',
            data: {
                idempotencyKey: input.idempotencyKey,
                snapshotId: result.snapshot.snapshotId,
                generatedAt: result.snapshot.generatedAt,
                selectedCount: selected.length,
                skippedCount: skipped.length,
                selected: selected.slice(0, input.maxSourceResults),
                skipped: skipped.slice(0, input.maxSourceResults),
                projections: result.snapshot.projections.length,
                routeOptions: result.snapshot.routeOptions.length,
                accountOverlays: result.overlayRefresh.total,
                eligibilityDecisions: result.eligibilityRefresh.decisionCount,
                diff: {
                    added: result.diff.added.length,
                    removed: result.diff.removed.length,
                    changed: result.diff.changed.length,
                },
                parity: mirror.parity,
                retention: result.retention,
            },
            warnings: mirror.parity.ok ? [] : ['sqlite_catalog_parity_failed'],
            nextActions: mirror.parity.ok ? ['inspect_overview_and_route_plan'] : ['inspect_catalog_integrity'],
        });
    }

    /**
     * @param {{ maxRowsPerLedger: number }} input
     */
    async planMaintenance(input) {
        const diagnostics = await this.#sqliteStore.readStorageDiagnostics();
        const tables = OPERATIONAL_RETENTION_TABLES.map((table) => {
            const currentRows = diagnostics.tableCounts[table] ?? 0;
            return {
                table,
                currentRows,
                maxRows: input.maxRowsPerLedger,
                candidateDeleteRows: Math.max(0, currentRows - input.maxRowsPerLedger),
            };
        });
        return createModelGatewayControlPlaneResult({
            operation: 'maintenance.retention',
            status: 'planned',
            dryRun: true,
            data: {
                maxRowsPerLedger: input.maxRowsPerLedger,
                candidateDeleteRows: tables.reduce((total, table) => total + table.candidateDeleteRows, 0),
                tables,
                canonicalCatalogRowsProtected: diagnostics.catalogRows,
            },
            nextActions: ['review_plan_then_apply_with_confirm_true'],
        });
    }

    /**
     * @param {{ maxRowsPerLedger: number }} input
     */
    async applyMaintenance(input) {
        const retention = await this.#sqliteStore.applyOperationalRetention(
            uniformOperationalRetentionPolicy(input.maxRowsPerLedger),
        );
        return createModelGatewayControlPlaneResult({
            operation: 'maintenance.retention',
            status: 'committed',
            data: {
                maxRowsPerLedger: input.maxRowsPerLedger,
                deletedRows: retention.deletedRows,
                tables: retention.tables,
                canonicalCatalogProtected: true,
            },
            nextActions: ['inspect_overview'],
        });
    }
}

export function createModelGatewayCatalogControlPlane(options = {}) {
    return new ModelGatewayCatalogControlPlane(options);
}
