// @ts-check
/**
 * Pre-runtime selection audit.
 *
 * This layer validates whether the metadata database can produce deterministic route choices before runtime probes.
 * It deliberately does not require probe proof and does not execute providers or models.
 *
 * @module copilot/model-gateway/routing/selection-audit
 */

import { explainGatewayRouteDecision } from './explain.js';
import { routeModelGatewayCatalogSnapshot } from './policy-engine.js';
import { listModelGatewayTaskProfiles, resolveModelGatewayTaskProfile } from './task-profiles.js';

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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any> | null} selected
 * @returns {Record<string, unknown> | null}
 */
function selectedSummary(selected) {
    if (!selected) return null;
    const model = isRecord(selected['model']) ? selected['model'] : {};
    const eligibility = isRecord(selected['eligibility']) ? selected['eligibility'] : {};
    return {
        id: optionalString(model['id']),
        providerId: optionalString(model['providerId']),
        providerModel: optionalString(model['providerModel']) ?? optionalString(model['id']),
        routeProfile: optionalString(model['routeProfile']),
        selectorKind: optionalString(model['selectorKind']) ?? 'exact_model',
        selectorSyntax: optionalString(model['selectorSyntax']) ?? optionalString(model['providerModel']) ?? optionalString(model['id']),
        score: typeof selected['score'] === 'number' && Number.isFinite(selected['score']) ? selected['score'] : null,
        eligibilityDisposition: optionalString(eligibility['disposition']),
        reasons: stringList(selected['reasons']).slice(0, 8),
    };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} key
 * @returns {Record<string, number>}
 */
function countBy(rows, key) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const row of rows) {
        const value = optionalString(row[key]) ?? 'unknown';
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}

/**
 * @param {Record<string, number>[]} countRecords
 * @returns {Record<string, number>}
 */
function mergeCounts(countRecords) {
    /** @type {Record<string, number>} */
    const merged = {};
    for (const counts of countRecords) {
        for (const [key, value] of Object.entries(counts)) merged[key] = (merged[key] ?? 0) + value;
    }
    return merged;
}

/**
 * @param {object} [options]
 * @param {string[]} [options.profiles]
 * @returns {string[]}
 */
function resolveProfileIds(options = {}) {
    const requested = stringList(options.profiles);
    const profileIds = requested.length > 0 ? requested : listModelGatewayTaskProfiles().map((profile) => profile.id);
    return profileIds.filter((profileId) => resolveModelGatewayTaskProfile(profileId));
}

/**
 * @param {Record<string, any>} snapshot
 * @param {{
 *   profiles?: string[];
 *   strict?: boolean;
 *   includeProjectionOnly?: boolean;
 *   secretRegistry?: { has(ref: string): boolean };
 *   eligibilityPolicy?: Record<string, any>;
 * }} [options]
 * @returns {{
 *   schema: 'model-gateway-pre-runtime-selection-audit';
 *   ok: boolean;
 *   mode: 'strict_access_only' | 'allow_probe_unknown';
 *   snapshotContext: Record<string, number>;
 *   summary: {
 *     profileCount: number;
 *     selectedProfileCount: number;
 *     unselectedProfileCount: number;
 *     candidateCount: number;
 *     rejectedCount: number;
 *     selectedProviders: Record<string, number>;
 *     selectedSelectorKinds: Record<string, number>;
 *     rejectedReasonCounts: Record<string, number>;
 *   };
 *   profiles: Array<{
 *     profileId: string;
 *     selected: Record<string, unknown> | null;
 *     candidateCount: number;
 *     rejectedCount: number;
 *     fallbackChain: string[];
 *     topRejectedReasons: string[];
 *     nextActions: string[];
 *     decisionLayers: Record<string, unknown>;
 *     snapshotContext: Record<string, number>;
 *   }>;
 * }}
 */
export function auditModelGatewayPreRuntimeSelection(snapshot, options = {}) {
    const strict = options.strict === true;
    const profileIds = resolveProfileIds(options);
    const profileAudits = profileIds.map((profileId) => {
        /** @type {Parameters<typeof routeModelGatewayCatalogSnapshot>[2]} */
        const routeOptions = {
            evaluateEligibility: true,
            requireAgentProbeOk: false,
            requireRuntimeProof: false,
            requireKnownEligibility: strict,
            ignoreRuntimeHealth: true,
            eligibilityPolicy: {
                ...(isRecord(options.eligibilityPolicy) ? options.eligibilityPolicy : {}),
                unknownAccessPolicy: strict ? 'block' : 'allow_probe',
                taskProfile: profileId,
            },
        };
        if (options.includeProjectionOnly !== undefined) routeOptions.includeProjectionOnly = options.includeProjectionOnly;
        if (options.secretRegistry !== undefined) routeOptions.secretRegistry = options.secretRegistry;
        const route = routeModelGatewayCatalogSnapshot(snapshot, profileId, routeOptions);
        const explanation = explainGatewayRouteDecision(route);
        return {
            profileId,
            selected: selectedSummary(route.selected),
            candidateCount: route.candidates.length,
            rejectedCount: route.rejected.length,
            fallbackChain: route.fallbackChain.slice(0, 12),
            topRejectedReasons: explanation.topRejectedReasons,
            nextActions: explanation.nextActions,
            decisionLayers: explanation.decisionLayers,
            snapshotContext: route.snapshotContext,
            rejectedReasonCounts: explanation.rejectedReasonCounts,
        };
    });
    const selectedRows = profileAudits.map((profile) => profile.selected).filter(isRecord);
    const selectedProfileCount = selectedRows.length;
    return {
        schema: 'model-gateway-pre-runtime-selection-audit',
        ok: selectedProfileCount === profileAudits.length,
        mode: strict ? 'strict_access_only' : 'allow_probe_unknown',
        snapshotContext:
            profileAudits[0]?.snapshotContext ??
            {
                projectionCount: 0,
                routeOptionCount: 0,
                accountOverlayCount: 0,
                eligibilityDecisionCount: 0,
                candidateCount: 0,
            },
        summary: {
            profileCount: profileAudits.length,
            selectedProfileCount,
            unselectedProfileCount: profileAudits.length - selectedProfileCount,
            candidateCount: profileAudits.reduce((sum, profile) => sum + profile.candidateCount, 0),
            rejectedCount: profileAudits.reduce((sum, profile) => sum + profile.rejectedCount, 0),
            selectedProviders: countBy(selectedRows, 'providerId'),
            selectedSelectorKinds: countBy(selectedRows, 'selectorKind'),
            rejectedReasonCounts: mergeCounts(profileAudits.map((profile) => profile.rejectedReasonCounts)),
        },
        profiles: profileAudits.map(({ rejectedReasonCounts, ...profile }) => profile),
    };
}
