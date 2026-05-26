// @ts-check
/**
 * Metadata coverage summaries for canonical catalog snapshots.
 *
 * Coverage is a catalog/metadata concern: it tells us which providers have evidence, projections, routes, overlays and
 * pre-runtime decisions before any live model call is attempted.
 *
 * @module copilot/model-gateway/catalog/coverage
 */

import {
    normalizeDataPolicyTaxonomy,
    normalizeModelPricingTaxonomy,
    normalizeRateLimitTaxonomy,
    normalizeRuntimeAgenticCapabilityTaxonomy,
} from './normalizers.js';

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
 * @param {Record<string, any>} row
 * @returns {boolean}
 */
function hasRuntimeAgenticTaxonomy(row) {
    const taxonomy = normalizeRuntimeAgenticCapabilityTaxonomy({
        capabilities: row['capabilities'],
        supportedParameters: row['supportedParameters'],
        modalities: row['modalities'],
    });
    return Array.isArray(taxonomy['capabilityFamilies']) && taxonomy['capabilityFamilies'].length > 0;
}

/**
 * @param {Record<string, any>} row
 * @returns {boolean}
 */
function hasPricingTaxonomy(row) {
    return isRecord(row['pricing']) && Object.keys(normalizeModelPricingTaxonomy(row['pricing'])).length > 0;
}

/**
 * @param {Record<string, any>} row
 * @returns {boolean}
 */
function hasRateLimitTaxonomy(row) {
    const rateInput = {
        ...(isRecord(row['limits']) ? row['limits'] : {}),
        ...(isRecord(row['rateLimits']) ? row['rateLimits'] : {}),
    };
    return Object.keys(normalizeRateLimitTaxonomy(rateInput)).length > 0;
}

/**
 * @param {Record<string, any>} row
 * @returns {boolean}
 */
function hasDataPolicyTaxonomy(row) {
    return isRecord(row['dataPolicy']) && Object.keys(normalizeDataPolicyTaxonomy(row['dataPolicy'])).length > 0;
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
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {Record<string, any>} source
 * @param {Date} now
 * @returns {number | null}
 */
function sourceAgeSeconds(source, now) {
    const observedMs = dateMs(source['updatedAt']) ?? dateMs(source['createdAt']);
    if (observedMs === null) return null;
    return Math.max(0, Math.floor((now.getTime() - observedMs) / 1000));
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
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {{
 *   providerCount: number;
 *   sourceCount: number;
 *   expiredSourceCount: number;
 *   ttlKnownSourceCount: number;
 *   providers: Array<{ providerId: string; sourceCount: number; expiredSourceCount: number; ttlKnownSourceCount: number; newestAgeSeconds: number | null; oldestAgeSeconds: number | null; averageAgeSeconds: number | null }>;
 * }}
 */
export function summarizeModelGatewayProviderFreshness(snapshot, options = {}) {
    const now = options.now ?? new Date();
    const sources = records(snapshot['sources']);
    const providers = [...providerSet(sources)].sort();
    const providerSummaries = providers.map((id) => {
        const providerSources = sources.filter((source) => providerId(source) === id);
        const ages = providerSources.map((source) => sourceAgeSeconds(source, now)).filter((age) => age !== null);
        const expiredSourceCount = providerSources.filter((source) => {
            const ttl = positiveNumber(source['ttlSeconds']);
            const age = sourceAgeSeconds(source, now);
            return ttl !== null && age !== null && age >= ttl;
        }).length;
        return {
            providerId: id,
            sourceCount: providerSources.length,
            expiredSourceCount,
            ttlKnownSourceCount: providerSources.filter((source) => positiveNumber(source['ttlSeconds']) !== null).length,
            newestAgeSeconds: ages.length === 0 ? null : Math.min(...ages),
            oldestAgeSeconds: ages.length === 0 ? null : Math.max(...ages),
            averageAgeSeconds: ages.length === 0 ? null : Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length),
        };
    });
    return {
        providerCount: providers.length,
        sourceCount: sources.length,
        expiredSourceCount: providerSummaries.reduce((sum, provider) => sum + provider.expiredSourceCount, 0),
        ttlKnownSourceCount: providerSummaries.reduce((sum, provider) => sum + provider.ttlKnownSourceCount, 0),
        providers: providerSummaries,
    };
}

/**
 * @param {ReturnType<typeof summarizeModelGatewayProviderFreshness>} summary
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectModelGatewayProviderFreshnessMetrics(summary) {
    /** @type {Record<string, number>} */
    const gauges = {
        'model_gateway.catalog.freshness.providers': summary.providerCount,
        'model_gateway.catalog.freshness.sources': summary.sourceCount,
        'model_gateway.catalog.freshness.sources.expired': summary.expiredSourceCount,
        'model_gateway.catalog.freshness.sources.ttl_known': summary.ttlKnownSourceCount,
    };
    for (const provider of summary.providers) {
        const prefix = `model_gateway.catalog.freshness.provider.${provider.providerId}`;
        gauges[`${prefix}.sources`] = provider.sourceCount;
        gauges[`${prefix}.sources.expired`] = provider.expiredSourceCount;
        gauges[`${prefix}.sources.ttl_known`] = provider.ttlKnownSourceCount;
        if (provider.newestAgeSeconds !== null) gauges[`${prefix}.age_seconds.newest`] = provider.newestAgeSeconds;
        if (provider.oldestAgeSeconds !== null) gauges[`${prefix}.age_seconds.oldest`] = provider.oldestAgeSeconds;
        if (provider.averageAgeSeconds !== null) gauges[`${prefix}.age_seconds.average`] = provider.averageAgeSeconds;
    }
    return {
        counters: { 'model_gateway.catalog.freshness.snapshot': 1 },
        gauges,
    };
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
 *   runtimeAgenticTaxonomyModelCount: number;
 *   pricingTaxonomyModelCount: number;
 *   rateLimitTaxonomyModelCount: number;
 *   dataPolicyTaxonomyModelCount: number;
 *   routeCoverageRatio: number;
 *   overlayCoverageRatio: number;
 *   providers: Array<{ providerId: string; modelCount: number; modelEvidenceCount: number; providerEvidenceCount: number; routeOptionCount: number; accountOverlayCount: number; eligibilityDecisionCount: number; pricingKnownModelCount: number; limitsKnownModelCount: number; dataPolicyKnownModelCount: number; runtimeAgenticTaxonomyModelCount: number; pricingTaxonomyModelCount: number; rateLimitTaxonomyModelCount: number; dataPolicyTaxonomyModelCount: number; routeCoverageRatio: number; overlayAvailable: boolean }>;
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
            runtimeAgenticTaxonomyModelCount: countRows(providerProjections, hasRuntimeAgenticTaxonomy),
            pricingTaxonomyModelCount: countRows(providerProjections, hasPricingTaxonomy),
            rateLimitTaxonomyModelCount: countRows(providerProjections, hasRateLimitTaxonomy),
            dataPolicyTaxonomyModelCount: countRows(providerProjections, hasDataPolicyTaxonomy),
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
        runtimeAgenticTaxonomyModelCount: countRows(projections, hasRuntimeAgenticTaxonomy),
        pricingTaxonomyModelCount: countRows(projections, hasPricingTaxonomy),
        rateLimitTaxonomyModelCount: countRows(projections, hasRateLimitTaxonomy),
        dataPolicyTaxonomyModelCount: countRows(projections, hasDataPolicyTaxonomy),
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
        'model_gateway.catalog.coverage.models.runtime_agentic_taxonomy': summary.runtimeAgenticTaxonomyModelCount,
        'model_gateway.catalog.coverage.models.pricing_taxonomy': summary.pricingTaxonomyModelCount,
        'model_gateway.catalog.coverage.models.rate_limit_taxonomy': summary.rateLimitTaxonomyModelCount,
        'model_gateway.catalog.coverage.models.data_policy_taxonomy': summary.dataPolicyTaxonomyModelCount,
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
        gauges[`${prefix}.runtime_agentic_taxonomy`] = provider.runtimeAgenticTaxonomyModelCount;
        gauges[`${prefix}.pricing_taxonomy`] = provider.pricingTaxonomyModelCount;
        gauges[`${prefix}.rate_limit_taxonomy`] = provider.rateLimitTaxonomyModelCount;
        gauges[`${prefix}.data_policy_taxonomy`] = provider.dataPolicyTaxonomyModelCount;
    }
    return {
        counters: { 'model_gateway.catalog.coverage.snapshot': 1 },
        gauges,
    };
}
