// @ts-check
/**
 * Metadata coverage summaries for canonical catalog snapshots.
 *
 * Coverage is a catalog/metadata concern: it tells us which providers have evidence, projections, routes, overlays and
 * pre-runtime decisions before any live model call is attempted.
 *
 * @module copilot/model-gateway/catalog/coverage
 */

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
 * @returns {Record<string, any>[]}
 */
function records(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * @param {Record<string, any>} row
 * @returns {string}
 */
function providerId(row) {
    return optionalString(row['providerId']) ?? optionalString(row['provider']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, any>} row
 * @returns {string}
 */
function providerModel(row) {
    return optionalString(row['providerModel']) ?? optionalString(row['model']) ?? optionalString(row['id']) ?? 'unknown-model';
}

/**
 * @param {Record<string, any>} row
 * @param {string} key
 * @returns {boolean}
 */
function hasRecord(row, key) {
    return isRecord(row[key]) && Object.keys(row[key]).length > 0;
}

/**
 * @param {Record<string, any>[]} rows
 * @param {(row: Record<string, any>) => boolean} predicate
 * @returns {number}
 */
function countRows(rows, predicate) {
    return rows.filter(predicate).length;
}

/**
 * @param {Record<string, any>[]} rows
 * @returns {Set<string>}
 */
function providerSet(rows) {
    return new Set(rows.map(providerId));
}

/**
 * @param {Record<string, any>[]} rows
 * @returns {Set<string>}
 */
function providerModelSet(rows) {
    return new Set(rows.map((row) => `${providerId(row)}:${providerModel(row)}`));
}

/**
 * @param {Record<string, any>} snapshot
 * @returns {{
 *   providerCount: number;
 *   modelCount: number;
 *   modelEvidenceCount: number;
 *   providerEvidenceCount: number;
 *   routeOptionCount: number;
 *   accountOverlayCount: number;
 *   eligibilityDecisionCount: number;
 *   pricingKnownModelCount: number;
 *   limitsKnownModelCount: number;
 *   dataPolicyKnownModelCount: number;
 *   routeCoverageRatio: number;
 *   overlayCoverageRatio: number;
 *   providers: Array<{ providerId: string; modelCount: number; modelEvidenceCount: number; providerEvidenceCount: number; routeOptionCount: number; accountOverlayCount: number; eligibilityDecisionCount: number; pricingKnownModelCount: number; limitsKnownModelCount: number; dataPolicyKnownModelCount: number; routeCoverageRatio: number; overlayAvailable: boolean }>;
 * }}
 */
export function summarizeModelGatewayMetadataCoverage(snapshot) {
    const projections = records(snapshot['projections']);
    const modelEvidence = records(snapshot['modelMetadataEvidence'] ?? snapshot['evidences']);
    const providerEvidence = records(snapshot['providerMetadataEvidence'] ?? snapshot['providerEvidences']);
    const routeOptions = records(snapshot['routeOptions']);
    const accountOverlays = records(snapshot['accountOverlays']);
    const eligibilityDecisions = records(snapshot['modelEligibilityDecisions']);
    const providers = [...providerSet([...projections, ...modelEvidence, ...providerEvidence, ...routeOptions, ...accountOverlays])].sort();
    const routedModels = providerModelSet(routeOptions);
    const overlayProviders = providerSet(accountOverlays);
    const providerSummaries = providers.map((id) => {
        const providerProjections = projections.filter((row) => providerId(row) === id);
        const providerModels = providerModelSet(providerProjections);
        const providerRoutes = routeOptions.filter((row) => providerId(row) === id);
        const providerRoutedModels = providerModelSet(providerRoutes);
        return {
            providerId: id,
            modelCount: providerProjections.length,
            modelEvidenceCount: modelEvidence.filter((row) => providerId(row) === id).length,
            providerEvidenceCount: providerEvidence.filter((row) => providerId(row) === id).length,
            routeOptionCount: providerRoutes.length,
            accountOverlayCount: accountOverlays.filter((row) => providerId(row) === id).length,
            eligibilityDecisionCount: eligibilityDecisions.filter((row) => providerId(row) === id).length,
            pricingKnownModelCount: countRows(providerProjections, (row) => hasRecord(row, 'pricing')),
            limitsKnownModelCount: countRows(providerProjections, (row) => hasRecord(row, 'limits')),
            dataPolicyKnownModelCount: countRows(providerProjections, (row) => hasRecord(row, 'dataPolicy')),
            routeCoverageRatio: providerModels.size === 0 ? 0 : providerRoutedModels.size / providerModels.size,
            overlayAvailable: overlayProviders.has(id),
        };
    });
    return {
        providerCount: providers.length,
        modelCount: projections.length,
        modelEvidenceCount: modelEvidence.length,
        providerEvidenceCount: providerEvidence.length,
        routeOptionCount: routeOptions.length,
        accountOverlayCount: accountOverlays.length,
        eligibilityDecisionCount: eligibilityDecisions.length,
        pricingKnownModelCount: countRows(projections, (row) => hasRecord(row, 'pricing')),
        limitsKnownModelCount: countRows(projections, (row) => hasRecord(row, 'limits')),
        dataPolicyKnownModelCount: countRows(projections, (row) => hasRecord(row, 'dataPolicy')),
        routeCoverageRatio: projections.length === 0 ? 0 : routedModels.size / providerModelSet(projections).size,
        overlayCoverageRatio: providers.length === 0 ? 0 : overlayProviders.size / providers.length,
        providers: providerSummaries,
    };
}

/**
 * @param {ReturnType<typeof summarizeModelGatewayMetadataCoverage>} summary
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectModelGatewayMetadataCoverageMetrics(summary) {
    /** @type {Record<string, number>} */
    const gauges = {
        'model_gateway.catalog.coverage.providers': summary.providerCount,
        'model_gateway.catalog.coverage.models': summary.modelCount,
        'model_gateway.catalog.coverage.model_evidence': summary.modelEvidenceCount,
        'model_gateway.catalog.coverage.provider_evidence': summary.providerEvidenceCount,
        'model_gateway.catalog.coverage.route_options': summary.routeOptionCount,
        'model_gateway.catalog.coverage.account_overlays': summary.accountOverlayCount,
        'model_gateway.catalog.coverage.eligibility_decisions': summary.eligibilityDecisionCount,
        'model_gateway.catalog.coverage.models.pricing_known': summary.pricingKnownModelCount,
        'model_gateway.catalog.coverage.models.limits_known': summary.limitsKnownModelCount,
        'model_gateway.catalog.coverage.models.data_policy_known': summary.dataPolicyKnownModelCount,
        'model_gateway.catalog.coverage.route_ratio': summary.routeCoverageRatio,
        'model_gateway.catalog.coverage.overlay_ratio': summary.overlayCoverageRatio,
    };
    for (const provider of summary.providers) {
        const prefix = `model_gateway.catalog.coverage.provider.${provider.providerId}`;
        gauges[`${prefix}.models`] = provider.modelCount;
        gauges[`${prefix}.route_options`] = provider.routeOptionCount;
        gauges[`${prefix}.route_ratio`] = provider.routeCoverageRatio;
        gauges[`${prefix}.overlays`] = provider.accountOverlayCount;
        gauges[`${prefix}.eligibility_decisions`] = provider.eligibilityDecisionCount;
    }
    return {
        counters: { 'model_gateway.catalog.coverage.snapshot': 1 },
        gauges,
    };
}
