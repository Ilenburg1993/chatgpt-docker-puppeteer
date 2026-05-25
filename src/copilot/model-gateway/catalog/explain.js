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
 * @param {ReturnType<typeof import('./json-catalog-store.js').normalizeStoredCatalogSnapshot>} snapshot
 * @param {string} selector
 * @returns {{
 *   found: boolean;
 *   selector: string;
 *   key: string | null;
 *   projection: Record<string, any> | null;
 *   openai: ReturnType<typeof toOpenAIModelCatalogEntry> | null;
 *   routeOptions: Record<string, any>[];
 *   accountOverlays: Record<string, any>[];
 *   eligibility: ReturnType<typeof explainModelGatewayEligibilityDecision> | null;
 *   providerProjection: Record<string, any> | null;
 *   metadataCoverage: {
 *     confidenceFields: number;
 *     provenanceFields: number;
 *     supportedParameters: number;
 *     unsupportedParameters: number;
 *   };
 *   nextActions: string[];
 * }}
 */
export function explainModelGatewayCatalogEntry(snapshot, selector) {
    const normalizedSelector = optionalString(selector) ?? '';
    const projection =
        snapshot.projections.find((item) => matchesProjectionSelector(item, normalizedSelector)) ?? null;
    if (!projection) {
        return {
            found: false,
            selector: normalizedSelector,
            key: null,
            projection: null,
            openai: null,
            routeOptions: [],
            accountOverlays: [],
            eligibility: null,
            providerProjection: null,
            metadataCoverage: {
                confidenceFields: 0,
                provenanceFields: 0,
                supportedParameters: 0,
                unsupportedParameters: 0,
            },
            nextActions: ['refresh_catalog_or_use_more_specific_selector'],
        };
    }
    const routeOptions = snapshot.routeOptions.filter((route) => sameModelRoute(route, projection));
    const accountOverlays = snapshot.accountOverlays.filter((overlay) => overlayMentionsProjection(overlay, projection));
    const eligibilityDecision =
        snapshot.modelEligibilityDecisions.find((decision) => sameModelRoute(decision, projection)) ?? null;
    const eligibility = eligibilityDecision ? explainModelGatewayEligibilityDecision(eligibilityDecision) : null;
    const subjectProviderId =
        optionalString(isRecord(projection['providerMetadata']) ? projection['providerMetadata']['ownedBy'] : null) ??
        optionalString(projection['providerId']);
    const providerProjection =
        snapshot.providerProjections.find(
            (provider) =>
                optionalString(provider['providerId']) === optionalString(projection['providerId']) &&
                optionalString(provider['subjectProviderId']) === subjectProviderId,
        ) ?? null;
    const confidenceByField = isRecord(projection['confidenceByField']) ? projection['confidenceByField'] : {};
    const provenanceByField = isRecord(projection['provenanceByField']) ? projection['provenanceByField'] : {};
    const supportedParameters = stringList(projection['supportedParameters']);
    const unsupportedParameters = stringList(projection['unsupportedParameters']);
    const nextActions = [
        ...(eligibility?.nextActions ?? []),
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
        }),
        routeOptions,
        accountOverlays,
        eligibility,
        providerProjection,
        metadataCoverage: {
            confidenceFields: Object.keys(confidenceByField).length,
            provenanceFields: Object.keys(provenanceByField).length,
            supportedParameters: supportedParameters.length,
            unsupportedParameters: unsupportedParameters.length,
        },
        nextActions: [...new Set(nextActions.length > 0 ? nextActions : ['candidate_can_be_ranked'])],
    };
}
