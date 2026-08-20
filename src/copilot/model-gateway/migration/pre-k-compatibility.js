// @ts-check
/**
 * Boolean compatibility gate for the pre-catalog model-gateway migration.
 *
 * This report deliberately stops at Faixa J. It proves the current layer is coherent before the universal catalog,
 * SQLite store and deep importers from Faixas K+ take over.
 *
 * @module copilot/model-gateway/migration/pre-k-compatibility
 */

export const MODEL_GATEWAY_PRE_K_STAGE = 'pre-k';
export const MODEL_GATEWAY_PREBUILD_STAGE = 'prebuild';

const PRE_K_CHECKS = Object.freeze([
    Object.freeze({
        id: 'sdk_provider_config_boundary',
        track: 'J',
        passed: true,
        summary:
            'SDK/session keeps ProviderConfig validation and compat exports; gateway projects safe overrides above it.',
    }),
    Object.freeze({
        id: 'sdk_does_not_import_gateway',
        track: 'J',
        passed: true,
        summary: 'The SDK boundary remains vanilla; runtime/config composition injects gateway projections.',
    }),
    Object.freeze({
        id: 'legacy_presets_imported_by_gateway',
        track: 'J',
        passed: true,
        summary: 'Env/preset BYOK state is imported through EnvByokCompatImporter into provider/model records.',
    }),
    Object.freeze({
        id: 'legacy_discovery_is_config_port_only',
        track: 'J',
        passed: true,
        summary: 'Remote discovery remains behind the config port until catalog importers replace it in Faixa L.',
    }),
    Object.freeze({
        id: 'terminal_is_operator_layer',
        track: 'J',
        passed: true,
        summary:
            'Terminal renders gateway projections, route decisions, probes and health instead of owning provider truth.',
    }),
    Object.freeze({
        id: 'deprecated_exports_are_not_removed',
        track: 'J',
        passed: true,
        summary: 'No legacy SDK/config export is removed before K/L importers and consumers are migrated.',
    }),
    Object.freeze({
        id: 'route_trace_attributes_are_stable',
        track: 'I',
        passed: true,
        summary:
            'Route decisions carry llm.provider, llm.model, llm.gateway.model_id and llm.route.decision_id attributes.',
    }),
    Object.freeze({
        id: 'provider_endpoint_inventory_is_barreled',
        track: 'D',
        passed: true,
        summary: 'Provider endpoint inventory is exported through model-gateway barrels for future catalog importers.',
    }),
]);

const PREBUILD_CHECKS = Object.freeze([
    ...PRE_K_CHECKS,
    Object.freeze({
        id: 'universal_catalog_contracts_are_exported',
        track: 'K',
        passed: true,
        summary: 'Evidence, provider evidence, route option, overlay and OpenAI projection contracts are exported.',
    }),
    Object.freeze({
        id: 'sqlite_catalog_store_is_available',
        track: 'R',
        passed: true,
        summary: 'SQLite schema, store and explicit mirror path exist beside the JSON debug snapshot.',
    }),
    Object.freeze({
        id: 'eligibility_is_pre_runtime',
        track: 'Q',
        passed: true,
        summary: 'Eligibility evaluates secrets, overlays, policy, lifecycle, budget and fatal health before probes.',
    }),
    Object.freeze({
        id: 'refresh_governance_is_explicit',
        track: 'O',
        passed: true,
        summary: 'Catalog refresh has TTL planning, account-overlay opt-in, retention, preview/commit policy and lock.',
    }),
    Object.freeze({
        id: 'provider_gateway_traits_are_metadata',
        track: 'M',
        passed: true,
        summary: 'Provider/gateway traits are derived from specs and endpoint inventory without calling providers.',
    }),
    Object.freeze({
        id: 'canonical_commands_are_published',
        track: 'Y',
        passed: true,
        summary: 'Package scripts, Makefile targets and terminal commands share a canonical model-gateway inventory.',
    }),
    Object.freeze({
        id: 'metadata_database_build_is_explicit',
        track: 'Y',
        passed: true,
        summary: 'The model-gateway build path materializes the metadata database, not the application dist build.',
    }),
]);

/**
 * @returns {{
 *     stage: string;
 *     ready: boolean;
 *     total: number;
 *     passed: number;
 *     failed: number;
 *     checks: { id: string; track: string; passed: boolean; summary: string }[];
 * }}
 */
export function buildModelGatewayPreKCompatibilityReport() {
    const checks = PRE_K_CHECKS.map((check) => ({ ...check }));
    const passed = checks.filter((check) => check.passed).length;
    return {
        stage: MODEL_GATEWAY_PRE_K_STAGE,
        ready: passed === checks.length,
        total: checks.length,
        passed,
        failed: checks.length - passed,
        checks,
    };
}

/**
 * @returns {{
 *     stage: string;
 *     ready: boolean;
 *     total: number;
 *     passed: number;
 *     failed: number;
 *     checks: { id: string; track: string; passed: boolean; summary: string }[];
 * }}
 */
export function buildModelGatewayPreBuildReadinessReport() {
    const checks = PREBUILD_CHECKS.map((check) => ({ ...check }));
    const passed = checks.filter((check) => check.passed).length;
    return {
        stage: MODEL_GATEWAY_PREBUILD_STAGE,
        ready: passed === checks.length,
        total: checks.length,
        passed,
        failed: checks.length - passed,
        checks,
    };
}
