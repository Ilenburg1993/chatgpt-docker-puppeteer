// @ts-check
/**
 * Catalog explanation helpers.
 *
 * This layer joins metadata, route options, account overlays and pre-runtime eligibility without executing runtime
 * probes and without mutating the canonical catalog.
 *
 * @module copilot/model-gateway/catalog/explain
 */

import { explainModelGatewayEligibilityDecision } from '../eligibility/index.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { toOpenAIModelCatalogEntry } from './openai-schema.js';

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
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {string}
 */
function projectionKey(projection) {
    return [
        optionalString(projection['providerId']) ?? 'unknown-provider',
        optionalString(projection['providerModel']) ?? 'unknown-model',
        optionalString(projection['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} projection
 * @returns {boolean}
 */
function sameModelRoute(row, projection) {
    return (
        optionalString(row['providerId']) === optionalString(projection['providerId']) &&
        optionalString(row['providerModel']) === optionalString(projection['providerModel']) &&
        (optionalString(row['routeProfile']) ?? 'default') === (optionalString(projection['routeProfile']) ?? 'default')
    );
}

/**
 * @param {Record<string, unknown>} projection
 * @param {string} selector
 * @returns {boolean}
 */
function matchesProjectionSelector(projection, selector) {
    const normalized = selector.toLowerCase();
    const aliases = stringList(projection['aliases']);
    const candidates = [
        projectionKey(projection),
        optionalString(projection['providerModel']),
        optionalString(projection['displayName']),
        optionalString(projection['family']),
        ...aliases,
    ]
        .filter((item) => item !== null)
        .map((item) => String(item).toLowerCase());
    return candidates.some((candidate) => candidate === normalized || candidate.includes(normalized));
}

/**
 * @param {Record<string, unknown>} overlay
 * @param {Record<string, unknown>} projection
 * @returns {boolean}
 */
function overlayMentionsProjection(overlay, projection) {
    if (optionalString(overlay['providerId']) !== optionalString(projection['providerId'])) return false;
    const providerModel = optionalString(projection['providerModel']);
    if (!providerModel) return true;
    const enabled = stringList(overlay['enabledModels']);
    const blocked = stringList(overlay['blockedModels']);
    return enabled.length === 0 || enabled.includes(providerModel) || blocked.includes(providerModel);
}

/**
 * @param {Record<string, unknown>} health
 * @returns {'ok' | 'failed' | 'unknown'}
 */
function summarizeRuntimeHealthStatus(health) {
    const runtimeStatus = optionalString(health['runtimeHealthStatus']);
    if (runtimeStatus === 'failed') return 'failed';
    if (runtimeStatus === 'ok') return 'ok';
    const lastStatus = optionalString(health['lastStatus']);
    const agentStatus = optionalString(health['agentProbeStatus']);
    if (lastStatus === 'failed' || agentStatus === 'failed') return 'failed';
    if (lastStatus === 'ok' || agentStatus === 'ok') return 'ok';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown> | null}
 */
function findRuntimeHealth(projection, rows) {
    return (
        rows.find(
            (row) =>
                optionalString(row['providerId']) === optionalString(projection['providerId']) &&
                optionalString(row['providerModel']) === optionalString(projection['providerModel']) &&
                ((optionalString(row['routeProfile']) ?? 'default') ===
                    (optionalString(projection['routeProfile']) ?? 'default') ||
                    !optionalString(row['routeProfile'])),
        ) ?? null
    );
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown>[]}
 */
function findRuntimeProbes(projection, rows) {
    return rows.filter(
        (row) =>
            optionalString(row['providerId']) === optionalString(projection['providerId']) &&
            optionalString(row['providerModel']) === optionalString(projection['providerModel']) &&
            ((optionalString(row['routeProfile']) ?? 'default') ===
                (optionalString(projection['routeProfile']) ?? 'default') ||
                !optionalString(row['routeProfile'])),
    );
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} selector
 * @returns {boolean}
 */
function runtimeRecordMatchesSelector(row, selector) {
    const normalized = selector.toLowerCase();
    const providerId = optionalString(row['providerId']) ?? optionalString(row['provider']);
    const providerModel = optionalString(row['providerModel']) ?? optionalString(row['model']);
    if (!providerModel) return false;
    const tokens = [
        providerModel,
        providerId ? `${providerId}:${providerModel}` : null,
        providerId ? `${providerId}/${providerModel}` : null,
        optionalString(row['key']),
    ]
        .filter((item) => item !== null)
        .map((item) => String(item).toLowerCase());
    return tokens.some((token) => token === normalized || token.includes(normalized));
}

/**
 * @param {string} selector
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown> | null}
 */
function findRuntimeHealthBySelector(selector, rows) {
    return rows.find((row) => runtimeRecordMatchesSelector(row, selector)) ?? null;
}

/**
 * @param {Record<string, unknown>} health
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown>[]}
 */
function findRuntimeProbesForHealth(health, rows) {
    const providerId = optionalString(health['providerId']) ?? optionalString(health['provider']);
    const providerModel = optionalString(health['providerModel']) ?? optionalString(health['model']);
    return rows.filter(
        (row) =>
            (optionalString(row['providerId']) ?? optionalString(row['provider'])) === providerId &&
            (optionalString(row['providerModel']) ?? optionalString(row['model'])) === providerModel,
    );
}

/**
 * @param {unknown} snapshot
 * @param {string} selector
 * @param {{ runtimeHealthRecords?: Record<string, unknown>[]; runtimeProbeResults?: Record<string, unknown>[] }} [options]
 * @returns {{
 *     found: boolean;
 *     operationalFound?: boolean;
 *     selector: string;
 *     key: string | null;
 *     projection: Record<string, unknown> | null;
 *     openai: ReturnType<typeof toOpenAIModelCatalogEntry> | null;
 *     routeOptions: Record<string, unknown>[];
 *     accountOverlays: Record<string, unknown>[];
 *     eligibility: ReturnType<typeof explainModelGatewayEligibilityDecision> | null;
 *     providerProjection: Record<string, unknown> | null;
 *     runtimeHealth: { status: 'ok' | 'failed' | 'unknown'; record: Record<string, unknown> } | null;
 *     runtimeProbes: Record<string, unknown>[];
 *     metadataCoverage: {
 *         confidenceFields: number;
 *         provenanceFields: number;
 *         supportedParameters: number;
 *         unsupportedParameters: number;
 *     };
 *     nextActions: string[];
 * }}
 */
export function explainModelGatewayCatalogEntry(snapshot, selector, options = {}) {
    const catalog = normalizeStoredCatalogSnapshot(snapshot);
    const normalizedSelector = optionalString(selector) ?? '';
    const projection = catalog.projections.find((item) => matchesProjectionSelector(item, normalizedSelector)) ?? null;
    if (!projection) {
        const runtimeHealthRecord = findRuntimeHealthBySelector(normalizedSelector, options.runtimeHealthRecords ?? []);
        const runtimeProbes = runtimeHealthRecord
            ? findRuntimeProbesForHealth(runtimeHealthRecord, options.runtimeProbeResults ?? [])
            : [];
        const runtimeHealth = runtimeHealthRecord
            ? {
                  status: summarizeRuntimeHealthStatus(runtimeHealthRecord),
                  record: runtimeHealthRecord,
              }
            : null;
        return {
            found: false,
            operationalFound: runtimeHealthRecord !== null,
            selector: normalizedSelector,
            key: null,
            projection: null,
            openai: null,
            routeOptions: [],
            accountOverlays: [],
            eligibility: null,
            providerProjection: null,
            runtimeHealth,
            runtimeProbes,
            metadataCoverage: {
                confidenceFields: 0,
                provenanceFields: 0,
                supportedParameters: 0,
                unsupportedParameters: 0,
            },
            nextActions: runtimeHealthRecord
                ? [
                      'runtime_route_proved_but_catalog_projection_missing',
                      'refresh_catalog_or_collect_provider_model_metadata',
                      'runtime_selector_can_use_operational_candidate',
                  ]
                : ['refresh_catalog_or_use_more_specific_selector'],
        };
    }
    const routeOptions = catalog.routeOptions.filter((route) => sameModelRoute(route, projection));
    const accountOverlays = catalog.accountOverlays.filter((overlay) => overlayMentionsProjection(overlay, projection));
    const eligibilityDecision =
        catalog.modelEligibilityDecisions.find((decision) => sameModelRoute(decision, projection)) ?? null;
    const eligibility = eligibilityDecision ? explainModelGatewayEligibilityDecision(eligibilityDecision) : null;
    const subjectProviderId =
        optionalString(isRecord(projection['providerMetadata']) ? projection['providerMetadata']['ownedBy'] : null) ??
        optionalString(projection['providerId']);
    const providerProjection =
        catalog.providerProjections.find(
            (provider) =>
                optionalString(provider['providerId']) === optionalString(projection['providerId']) &&
                optionalString(provider['subjectProviderId']) === subjectProviderId,
        ) ?? null;
    const confidenceByField = isRecord(projection['confidenceByField']) ? projection['confidenceByField'] : {};
    const provenanceByField = isRecord(projection['provenanceByField']) ? projection['provenanceByField'] : {};
    const supportedParameters = stringList(projection['supportedParameters']);
    const unsupportedParameters = stringList(projection['unsupportedParameters']);
    const runtimeHealthRecord = findRuntimeHealth(projection, options.runtimeHealthRecords ?? []);
    const runtimeProbes = findRuntimeProbes(projection, options.runtimeProbeResults ?? []);
    const runtimeHealth = runtimeHealthRecord
        ? {
              status: summarizeRuntimeHealthStatus(runtimeHealthRecord),
              record: runtimeHealthRecord,
          }
        : null;
    const nextActions = [
        ...(eligibility?.nextActions ?? []),
        ...(runtimeHealth?.status === 'failed' ? ['inspect_or_clear_runtime_health_after_fix'] : []),
        ...(runtimeProbes.length === 0 ? ['run_runtime_probes_for_current_route'] : []),
        ...(routeOptions.length === 0 ? ['collect_route_options_for_model'] : []),
        ...(accountOverlays.length === 0 ? ['collect_account_overlay_for_provider'] : []),
    ];

    return {
        found: true,
        selector: normalizedSelector,
        key: projectionKey(projection),
        projection,
        openai: toOpenAIModelCatalogEntry(projection, {
            providerProjections: providerProjection ? [providerProjection] : [],
            eligibilityDecisions: eligibilityDecision ? [eligibilityDecision] : [],
            routeOptions,
        }),
        routeOptions,
        accountOverlays,
        eligibility,
        providerProjection,
        runtimeHealth,
        runtimeProbes,
        metadataCoverage: {
            confidenceFields: Object.keys(confidenceByField).length,
            provenanceFields: Object.keys(provenanceByField).length,
            supportedParameters: supportedParameters.length,
            unsupportedParameters: unsupportedParameters.length,
        },
        nextActions: [...new Set(nextActions.length > 0 ? nextActions : ['candidate_can_be_ranked'])],
    };
}

/**
 * @param {unknown} snapshot
 * @param {string} selector
 * @returns {{
 *     found: boolean;
 *     selector: string;
 *     providerId: string | null;
 *     providerProjection: Record<string, unknown> | null;
 *     sources: Record<string, unknown>[];
 *     providerEvidences: Record<string, unknown>[];
 *     projections: Record<string, unknown>[];
 *     routeOptions: Record<string, unknown>[];
 *     accountOverlays: Record<string, unknown>[];
 *     conflicts: Record<string, unknown>[];
 *     freshness: { newestSourceAt: string | null; oldestSourceAt: string | null; sourceCount: number };
 *     nextActions: string[];
 * }}
 */
export function explainModelGatewayProviderEntry(snapshot, selector) {
    const catalog = normalizeStoredCatalogSnapshot(snapshot);
    const normalizedSelector = optionalString(selector) ?? '';
    const normalized = normalizedSelector.toLowerCase();
    const providerProjection =
        catalog.providerProjections.find((provider) =>
            [
                optionalString(provider['providerId']),
                optionalString(provider['subjectProviderId']),
                optionalString(provider['displayName']),
            ]
                .filter((item) => item !== null)
                .some((item) => String(item).toLowerCase().includes(normalized)),
        ) ?? null;
    const providerId =
        optionalString(providerProjection?.['providerId']) ??
        optionalString(providerProjection?.['subjectProviderId']) ??
        catalog.projections.find((projection) =>
            optionalString(projection['providerId'])?.toLowerCase().includes(normalized),
        )?.['providerId'] ??
        null;
    const providerIdText = optionalString(providerId);
    if (!providerIdText) {
        return {
            found: false,
            selector: normalizedSelector,
            providerId: null,
            providerProjection: null,
            sources: [],
            providerEvidences: [],
            projections: [],
            routeOptions: [],
            accountOverlays: [],
            conflicts: [],
            freshness: { newestSourceAt: null, oldestSourceAt: null, sourceCount: 0 },
            nextActions: ['refresh_catalog_or_use_provider_id'],
        };
    }
    const sources = catalog.sources.filter((source) => optionalString(source['providerId']) === providerIdText);
    const providerEvidences = catalog.providerEvidences.filter(
        (evidence) =>
            optionalString(evidence['providerId']) === providerIdText ||
            optionalString(evidence['subjectProviderId']) === providerIdText,
    );
    const projections = catalog.projections.filter(
        (projection) => optionalString(projection['providerId']) === providerIdText,
    );
    const routeOptions = catalog.routeOptions.filter((route) => optionalString(route['providerId']) === providerIdText);
    const accountOverlays = catalog.accountOverlays.filter(
        (overlay) => optionalString(overlay['providerId']) === providerIdText,
    );
    const projectionKeys = new Set(projections.map(projectionKey));
    const conflicts = catalog.conflicts.filter((conflict) =>
        projectionKeys.has(optionalString(conflict['projectionKey']) ?? ''),
    );
    const sourceDates = sources
        .map((source) => optionalString(source['updatedAt']) ?? optionalString(source['createdAt']))
        .filter((item) => item !== null)
        .sort();
    return {
        found: true,
        selector: normalizedSelector,
        providerId: providerIdText,
        providerProjection,
        sources,
        providerEvidences,
        projections,
        routeOptions,
        accountOverlays,
        conflicts,
        freshness: {
            newestSourceAt: sourceDates[sourceDates.length - 1] ?? null,
            oldestSourceAt: sourceDates[0] ?? null,
            sourceCount: sources.length,
        },
        nextActions: [
            ...(sources.length === 0 ? ['refresh_provider_catalog_sources'] : []),
            ...(accountOverlays.length === 0 ? ['collect_account_overlay_for_provider'] : []),
            ...(routeOptions.length === 0 ? ['collect_route_options_for_provider'] : []),
            ...(conflicts.length > 0 ? ['inspect_provider_conflicts'] : []),
        ],
    };
}
