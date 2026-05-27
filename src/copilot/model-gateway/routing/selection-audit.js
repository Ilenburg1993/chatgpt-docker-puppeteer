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
 * @param {Record<string, any>} profile
 * @returns {boolean}
 */
function isDefaultAuditProfile(profile) {
    return profile['defaultAudit'] !== false;
}

/**
 * @param {Record<string, any> | null} selected
 * @returns {Record<string, unknown> | null}
 */
function selectedSummary(selected) {
    if (!selected) return null;
    const model = isRecord(selected['model']) ? selected['model'] : {};
    const eligibility = isRecord(selected['eligibility']) ? selected['eligibility'] : {};
    const health = isRecord(selected['health']) ? selected['health'] : {};
    const probes = isRecord(health['probes']) ? health['probes'] : {};
    const verifiedProbes = Object.entries(probes)
        .filter(([, probe]) => isRecord(probe) && probe['ok'] === true && probe['providerAttempted'] !== false)
        .map(([kind]) => kind)
        .sort();
    return {
        id: optionalString(model['id']),
        providerId: optionalString(model['providerId']),
        providerModel: optionalString(model['providerModel']) ?? optionalString(model['id']),
        routeProfile: optionalString(model['routeProfile']),
        selectorKind: optionalString(model['selectorKind']) ?? 'exact_model',
        selectorSyntax: optionalString(model['selectorSyntax']) ?? optionalString(model['providerModel']) ?? optionalString(model['id']),
        score: typeof selected['score'] === 'number' && Number.isFinite(selected['score']) ? selected['score'] : null,
        eligibilityDisposition: optionalString(eligibility['disposition']),
        runtimeHealth: isRecord(selected['health'])
            ? {
                  lastStatus: optionalString(health['lastStatus']),
                  agentProbeStatus: optionalString(health['agentProbeStatus']),
                  verifiedProbes,
              }
            : null,
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
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function rowCapabilities(row) {
    return isRecord(row['capabilities']) ? row['capabilities'] : {};
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} capability
 * @returns {boolean}
 */
function hasCapability(row, capability) {
    const capabilities = rowCapabilities(row);
    if (capability === 'text') return capabilities['text'] !== false;
    if (capability === 'free') {
        const routing = isRecord(row['routing']) ? row['routing'] : {};
        const pricing = isRecord(row['pricing']) ? row['pricing'] : {};
        return routing['tier'] === 'free' || pricing['inputUsdPerMillion'] === 0;
    }
    return capabilities[capability] === true;
}

/**
 * @param {Array<Record<string, any>>} candidates
 * @param {Record<string, any> | null} profile
 * @returns {{
 *   candidateCount: number;
 *   required: Record<string, number>;
 *   softRequired: Record<string, number>;
 *   preferred: Record<string, number>;
 * }}
 */
function capabilitySupply(candidates, profile) {
    const rows = candidates.map((candidate) => (isRecord(candidate['model']) ? candidate['model'] : {}));
    /** @type {Record<string, number>} */
    const required = {};
    /** @type {Record<string, number>} */
    const softRequired = {};
    /** @type {Record<string, number>} */
    const preferred = {};
    if (!profile) return { candidateCount: rows.length, required, softRequired, preferred };
    for (const capability of stringList(profile['requires'])) {
        required[capability] = rows.filter((row) => hasCapability(row, capability)).length;
    }
    for (const capability of stringList(profile['softRequires'])) {
        softRequired[capability] = rows.filter((row) => hasCapability(row, capability)).length;
    }
    for (const capability of stringList(profile['prefers'])) {
        preferred[capability] = rows.filter((row) => hasCapability(row, capability)).length;
    }
    return { candidateCount: rows.length, required, softRequired, preferred };
}

/**
 * @param {ReturnType<typeof capabilitySupply>} supply
 * @param {Record<string, any> | null} profile
 * @returns {string[]}
 */
function capabilitySupplyWarnings(supply, profile) {
    const warnings = [];
    const preferredWarnings = new Set(stringList(profile?.['supplyWarns']));
    for (const [capability, count] of Object.entries(supply.required)) {
        if (count === 0) warnings.push(`required_supply_zero:${capability}`);
    }
    for (const [capability, count] of Object.entries(supply.softRequired)) {
        if (count === 0) warnings.push(`soft_supply_zero:${capability}`);
    }
    for (const [capability, count] of Object.entries(supply.preferred)) {
        if (count === 0 && preferredWarnings.has(capability)) warnings.push(`preferred_supply_zero:${capability}`);
    }
    return warnings;
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
    const profileIds =
        requested.length > 0
            ? requested
            : listModelGatewayTaskProfiles()
                  .filter((profile) => isDefaultAuditProfile(profile))
                  .map((profile) => profile.id);
    return profileIds.filter((profileId) => resolveModelGatewayTaskProfile(profileId));
}

/**
 * @param {string} profileId
 * @param {Set<string>} requestedProfiles
 * @returns {boolean}
 */
function profileExplicitlyRequestsLocal(profileId, requestedProfiles) {
    return requestedProfiles.has(profileId) && /(?:^|_)local(?:_|$)/iu.test(profileId);
}

/**
 * @param {Record<string, any>} snapshot
 * @param {{
 *   profiles?: string[];
 *   strict?: boolean;
 *   includeProjectionOnly?: boolean;
 *   secretRegistry?: { has(ref: string): boolean };
 *   eligibilityPolicy?: Record<string, any>;
 *   runtimeHealthRecords?: Record<string, any>[];
 *   runtimeRouteProfile?: string | null;
 *   requireRuntimeProof?: boolean;
 *   requiredProbeKinds?: string[];
 *   preferredProbeKinds?: string[];
 *   blockFailedProbeKinds?: string[];
 * }} options
 * @param {{
 *   schema: 'model-gateway-pre-runtime-selection-audit' | 'model-gateway-post-runtime-selection-audit';
 *   ignoreRuntimeHealth: boolean;
 *   runtimeMode: 'metadata_only' | 'observed_runtime_health';
 * }} auditOptions
 * @returns {{
 *   schema: 'model-gateway-pre-runtime-selection-audit' | 'model-gateway-post-runtime-selection-audit';
 *   ok: boolean;
 *   mode: 'strict_access_only' | 'allow_probe_unknown';
 *   runtimeMode: 'metadata_only' | 'observed_runtime_health';
 *   snapshotContext: Record<string, number>;
 *   summary: {
 *     profileCount: number;
 *     selectedProfileCount: number;
 *     unselectedProfileCount: number;
 *     candidateCount: number;
 *     rejectedCount: number;
 *     healthRecordCount: number;
 *     runtimeProbeProofCount: number;
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
 *     capabilitySupply: {
 *       candidateCount: number;
 *       required: Record<string, number>;
 *       softRequired: Record<string, number>;
 *       preferred: Record<string, number>;
 *     };
 *     supplyWarnings: string[];
 *     decisionLayers: Record<string, unknown>;
 *     snapshotContext: Record<string, number>;
 *   }>;
 * }}
 */
function auditModelGatewaySelection(snapshot, options, auditOptions) {
    options = isRecord(options) ? options : {};
    const strict = options.strict === true;
    const requestedProfiles = new Set(stringList(options.profiles));
    const profileIds = resolveProfileIds(options);
    const runtimeRouteProfile = optionalString(options.runtimeRouteProfile);
    const profileAudits = profileIds.map((profileId) => {
        /** @type {Parameters<typeof routeModelGatewayCatalogSnapshot>[2]} */
        const routeOptions = {
            evaluateEligibility: true,
            requireAgentProbeOk: false,
            requireRuntimeProof: options.requireRuntimeProof === true,
            requireKnownEligibility: strict,
            ignoreRuntimeHealth: auditOptions.ignoreRuntimeHealth,
            allowLocalProviders: profileExplicitlyRequestsLocal(profileId, requestedProfiles),
            eligibilityPolicy: {
                ...(isRecord(options.eligibilityPolicy) ? options.eligibilityPolicy : {}),
                unknownAccessPolicy: strict ? 'block' : 'allow_probe',
                taskProfile: profileId,
            },
        };
        if (runtimeRouteProfile) routeOptions.routeProfile = runtimeRouteProfile;
        if (options.includeProjectionOnly !== undefined) routeOptions.includeProjectionOnly = options.includeProjectionOnly;
        if (options.secretRegistry !== undefined) routeOptions.secretRegistry = options.secretRegistry;
        if (Array.isArray(options.runtimeHealthRecords)) routeOptions.runtimeHealthRecords = options.runtimeHealthRecords;
        if (Array.isArray(options.requiredProbeKinds)) routeOptions.requiredProbeKinds = stringList(options.requiredProbeKinds);
        if (Array.isArray(options.preferredProbeKinds)) routeOptions.preferredProbeKinds = stringList(options.preferredProbeKinds);
        if (Array.isArray(options.blockFailedProbeKinds)) routeOptions.blockFailedProbeKinds = stringList(options.blockFailedProbeKinds);
        const profile = resolveModelGatewayTaskProfile(profileId);
        const route = routeModelGatewayCatalogSnapshot(snapshot, profileId, routeOptions);
        const explanation = explainGatewayRouteDecision(route);
        const supply = capabilitySupply(route.candidates, profile);
        return {
            profileId,
            selected: selectedSummary(route.selected),
            candidateCount: route.candidates.length,
            rejectedCount: route.rejected.length,
            fallbackChain: route.fallbackChain.slice(0, 12),
            topRejectedReasons: explanation.topRejectedReasons,
            nextActions: explanation.nextActions,
            capabilitySupply: supply,
            supplyWarnings: capabilitySupplyWarnings(supply, profile),
            decisionLayers: explanation.decisionLayers,
            snapshotContext: route.snapshotContext,
            rejectedReasonCounts: explanation.rejectedReasonCounts,
        };
    });
    const selectedRows = profileAudits.map((profile) => profile.selected).filter(isRecord);
    const selectedProfileCount = selectedRows.length;
    return {
        ok: selectedProfileCount === profileAudits.length,
        schema: auditOptions.schema,
        mode: strict ? 'strict_access_only' : 'allow_probe_unknown',
        runtimeMode: auditOptions.runtimeMode,
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
            healthRecordCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['healthRecordCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeProbeProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeProbeProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            selectedProviders: countBy(selectedRows, 'providerId'),
            selectedSelectorKinds: countBy(selectedRows, 'selectorKind'),
            rejectedReasonCounts: mergeCounts(profileAudits.map((profile) => profile.rejectedReasonCounts)),
        },
        profiles: profileAudits.map(({ rejectedReasonCounts, ...profile }) => profile),
    };
}

/**
 * @param {Parameters<typeof auditModelGatewaySelection>[0]} snapshot
 * @param {Parameters<typeof auditModelGatewaySelection>[1]} [options]
 * @returns {ReturnType<typeof auditModelGatewaySelection>}
 */
export function auditModelGatewayPreRuntimeSelection(snapshot, options = {}) {
    return auditModelGatewaySelection(snapshot, options, {
        schema: 'model-gateway-pre-runtime-selection-audit',
        ignoreRuntimeHealth: true,
        runtimeMode: 'metadata_only',
    });
}

/**
 * Post-runtime selection audit.
 *
 * This consumes already-observed runtime/account health as volatile route evidence. It does not execute models and does
 * not write runtime facts into the canonical metadata snapshot.
 *
 * @param {Parameters<typeof auditModelGatewaySelection>[0]} snapshot
 * @param {Parameters<typeof auditModelGatewaySelection>[1]} [options]
 * @returns {ReturnType<typeof auditModelGatewaySelection>}
 */
export function auditModelGatewayPostRuntimeSelection(snapshot, options = {}) {
    return auditModelGatewaySelection(snapshot, options, {
        schema: 'model-gateway-post-runtime-selection-audit',
        ignoreRuntimeHealth: false,
        runtimeMode: 'observed_runtime_health',
    });
}
