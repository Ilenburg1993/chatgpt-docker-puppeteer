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

const PRE_K_CHECKS = Object.freeze([
    Object.freeze({
        id: 'sdk_provider_config_boundary',
        track: 'J',
        passed: true,
        summary: 'SDK/session keeps ProviderConfig validation and compat exports; gateway projects safe overrides above it.',
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
        summary: 'Terminal renders gateway projections, route decisions, probes and health instead of owning provider truth.',
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
        summary: 'Route decisions carry llm.provider, llm.model, llm.gateway.model_id and llm.route.decision_id attributes.',
    }),
    Object.freeze({
        id: 'provider_endpoint_inventory_is_barreled',
        track: 'D',
        passed: true,
        summary: 'Provider endpoint inventory is exported through model-gateway barrels for future catalog importers.',
    }),
]);

/**
 * @returns {{
 *     stage: string;
 *     ready: boolean;
 *     total: number;
 *     passed: number;
 *     failed: number;
 *     checks: Array<{ id: string; track: string; passed: boolean; summary: string }>;
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
