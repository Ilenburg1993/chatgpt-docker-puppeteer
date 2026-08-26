// @ts-check
/**
 * Pre-runtime selection audit.
 *
 * This layer validates whether the metadata database can produce deterministic route choices before runtime probes. It
 * deliberately does not require probe proof and does not execute providers or models.
 *
 * @module copilot/model-gateway/routing/selection-audit
 */

import { explainGatewayRouteDecision } from './explain.js';
import {
    prepareModelGatewayCatalogRoutingSnapshot,
    routePreparedModelGatewayCatalogSnapshot,
} from './policy-engine.js';
import { listModelGatewayTaskProfiles, resolveModelGatewayTaskProfile } from './task-profiles.js';

export const MODEL_GATEWAY_SELECTION_POLICY_MODE = Object.freeze({
    METADATA_FIRST: 'metadata_first',
    PREFER_RUNTIME_PROVED: 'prefer_runtime_proved',
    REQUIRE_RUNTIME_PROOF: 'require_runtime_proof',
});

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
 * @param {Record<string, unknown>} model
 * @param {string} field
 * @returns {string | null}
 */
function modelRouteString(model, field) {
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const routeProviderSpecific = isRecord(model['routeProviderSpecific']) ? model['routeProviderSpecific'] : {};
    const providerSpecific = isRecord(model['providerSpecific']) ? model['providerSpecific'] : {};
    return (
        optionalString(model[field]) ??
        optionalString(routing[field]) ??
        optionalString(policy[field]) ??
        optionalString(routeProviderSpecific[field]) ??
        optionalString(providerSpecific[field])
    );
}

/**
 * @param {Record<string, unknown>} model
 * @param {string} field
 * @returns {boolean | null}
 */
function modelRouteBoolean(model, field) {
    const routing = isRecord(model['routing']) ? model['routing'] : {};
    const policy = isRecord(model['normalizedPolicy']) ? model['normalizedPolicy'] : {};
    const routeProviderSpecific = isRecord(model['routeProviderSpecific']) ? model['routeProviderSpecific'] : {};
    const providerSpecific = isRecord(model['providerSpecific']) ? model['providerSpecific'] : {};
    const value =
        model[field] ?? routing[field] ?? policy[field] ?? routeProviderSpecific[field] ?? providerSpecific[field];
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {boolean}
 */
function isDefaultAuditProfile(profile) {
    return profile['defaultAudit'] !== false;
}

/**
 * @param {Record<string, unknown> | null} selected
 */
function selectedSummary(selected) {
    if (!selected) return null;
    const model = isRecord(selected['model']) ? selected['model'] : {};
    const eligibility = isRecord(selected['eligibility']) ? selected['eligibility'] : {};
    const policyInputs = isRecord(eligibility['policyInputs']) ? eligibility['policyInputs'] : {};
    const accountAccess = isRecord(policyInputs['accountAccess']) ? policyInputs['accountAccess'] : {};
    const health = isRecord(selected['health']) ? selected['health'] : {};
    const probes = isRecord(health['probes']) ? health['probes'] : {};
    const provenance = isRecord(model['provenance']) ? model['provenance'] : {};
    const runtimeEvidence = isRecord(model['runtimeEvidence']) ? model['runtimeEvidence'] : {};
    const verifiedProbes = Object.entries(probes)
        .filter(([, probe]) => isRecord(probe) && probe['ok'] === true && probe['providerAttempted'] !== false)
        .map(([kind]) => kind)
        .sort();
    const failedProbes = Object.entries(probes)
        .filter(([, probe]) => isRecord(probe) && probe['ok'] === false && probe['providerAttempted'] !== false)
        .map(([kind]) => kind)
        .sort();
    return {
        id: optionalString(model['id']),
        providerId: optionalString(model['providerId']),
        providerModel: optionalString(model['providerModel']) ?? optionalString(model['id']),
        routeCandidateId: optionalString(model['routeCandidateId']),
        canonicalModelId: optionalString(model['canonicalModelId']),
        routeProfile: optionalString(model['routeProfile']),
        routeOptionRef: optionalString(model['routeOptionRef']),
        routeOptionRefs: Array.isArray(model['routeOptionRefs'])
            ? model['routeOptionRefs']
                  .map(optionalString)
                  .filter((item) => item !== null)
                  .slice(0, 8)
            : [],
        selectorKind: optionalString(model['selectorKind']) ?? 'exact_model',
        selectorSyntax:
            optionalString(model['selectorSyntax']) ??
            optionalString(model['providerModel']) ??
            optionalString(model['id']),
        routeLayer: modelRouteString(model, 'routeLayer'),
        wireApi: modelRouteString(model, 'wireApi'),
        runtimeKind: modelRouteString(model, 'runtimeKind'),
        upstreamProvider: modelRouteString(model, 'upstreamProvider'),
        baseUrl: modelRouteString(model, 'baseUrl'),
        openAICompatibleBaseUrl: modelRouteString(model, 'openAICompatibleBaseUrl'),
        endpoint: modelRouteString(model, 'endpoint'),
        aiSdkPackage: modelRouteString(model, 'aiSdkPackage'),
        autoSelection: modelRouteBoolean(model, 'autoSelection'),
        supportsFallback: modelRouteBoolean(model, 'supportsFallback'),
        localPrivate: modelRouteBoolean(model, 'localPrivate'),
        candidateSource: optionalString(provenance['candidateSource']) ?? optionalString(provenance['source']),
        runtimeObservedOnly:
            provenance['candidateSource'] === 'runtime_health' || runtimeEvidence['source'] === 'runtime_health',
        runtimeEvidence: Object.keys(runtimeEvidence).length > 0 ? runtimeEvidence : null,
        score: typeof selected['score'] === 'number' && Number.isFinite(selected['score']) ? selected['score'] : null,
        scoreBreakdown: isRecord(selected['scoreBreakdown']) ? selected['scoreBreakdown'] : null,
        eligibilityDisposition: optionalString(eligibility['disposition']),
        accountScope: optionalString(eligibility['accountScope']) ?? 'default',
        policyProfile: optionalString(eligibility['policyProfile']),
        taskProfile: optionalString(eligibility['taskProfile']),
        accountAccess: {
            status: optionalString(accountAccess['status']),
            canAttempt: accountAccess['canAttempt'] === true,
            secretConfigured:
                typeof accountAccess['secretConfigured'] === 'boolean' ? accountAccess['secretConfigured'] : null,
            modelVisible: accountAccess['modelVisible'] === true,
            failureClass: optionalString(accountAccess['failureClass']),
            accessConfidence: optionalString(accountAccess['accessConfidence']),
            resetWindows: Array.isArray(accountAccess['resetWindows'])
                ? accountAccess['resetWindows'].filter(isRecord).slice(0, 4)
                : [],
            hardReasons: stringList(accountAccess['hardReasons']).slice(0, 8),
            softReasons: stringList(accountAccess['softReasons']).slice(0, 8),
        },
        runtimeHealth: isRecord(selected['health'])
            ? {
                  lastStatus: optionalString(health['lastStatus']),
                  agentProbeStatus: optionalString(health['agentProbeStatus']),
                  verifiedProbes,
                  failedProbes,
                  liveToolProtocolStatus: isRecord(probes['live_tool_protocol'])
                      ? optionalString(probes['live_tool_protocol']['status'])
                      : null,
                  liveAskUserStatus: isRecord(probes['live_ask_user'])
                      ? optionalString(probes['live_ask_user']['status'])
                      : null,
              }
            : null,
        reasons: stringList(selected['reasons']).slice(0, 8),
    };
}

/**
 * @param {Record<string, unknown>[]} candidates
 * @param {number} limit
 * @returns {Array<NonNullable<ReturnType<typeof selectedSummary>>>}
 */
function candidateSummaries(candidates, limit = 96) {
    const boundedLimit = Math.max(0, Math.floor(limit));
    if (boundedLimit === 0) return [];
    /** @type {Array<NonNullable<ReturnType<typeof selectedSummary>>>} */
    const summaries = [];
    for (const candidate of candidates) {
        const summary = selectedSummary(candidate);
        if (summary) summaries.push(summary);
        if (summaries.length >= boundedLimit) break;
    }
    return summaries;
}

/**
 * @template T
 * @param {readonly T[]} rows
 * @param {(row: T) => unknown} readValue
 * @returns {Record<string, number>}
 */
function countBy(rows, readValue) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const row of rows) {
        const value = optionalString(readValue(row)) ?? 'unknown';
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
 * @param {Record<string, unknown>[]} candidates
 * @param {Record<string, unknown> | null} profile
 * @returns {{
 *     candidateCount: number;
 *     required: Record<string, number>;
 *     softRequired: Record<string, number>;
 *     preferred: Record<string, number>;
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
 * @param {Record<string, unknown> | null} profile
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
 * @param {ReturnType<typeof prepareModelGatewayCatalogRoutingSnapshot>} preparedSnapshot
 * @param {{
 *     profiles?: string[];
 *     strict?: boolean;
 *     includeProjectionOnly?: boolean;
 *     secretRegistry?: { has(ref: string): boolean };
 *     eligibilityPolicy?: Record<string, unknown>;
 *     runtimeHealthRecords?: Record<string, unknown>[];
 *     runtimeHealthIndex?: Record<string, unknown>;
 *     runtimeRouteProfile?: string | null;
 *     requireRuntimeProof?: boolean;
 *     now?: string | number | Date;
 *     maxRuntimeProofAgeMs?: number;
 *     runtimeProofWeights?: Partial<typeof import('./policy-engine.js').DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS>;
 *     temporaryFailureCooldownMs?: number;
 *     requiredProbeKinds?: string[];
 *     preferredProbeKinds?: string[];
 *     blockFailedProbeKinds?: string[];
 *     providerCooldownWindowMs?: number;
 *     providerCooldownMinFailedModels?: number;
 *     providerCooldownFailureKinds?: string[];
 * }} options
 * @param {{
 *     schema: 'model-gateway-pre-runtime-selection-audit' | 'model-gateway-post-runtime-selection-audit';
 *     ignoreRuntimeHealth: boolean;
 *     runtimeMode: 'metadata_only' | 'observed_runtime_health';
 * }} auditOptions
 * @returns {{
 *     schema: 'model-gateway-pre-runtime-selection-audit' | 'model-gateway-post-runtime-selection-audit';
 *     ok: boolean;
 *     mode: 'strict_access_only' | 'allow_probe_unknown';
 *     runtimeMode: 'metadata_only' | 'observed_runtime_health';
 *     snapshotContext: Record<string, number>;
 *     summary: {
 *         profileCount: number;
 *         selectedProfileCount: number;
 *         unselectedProfileCount: number;
 *         candidateCount: number;
 *         rejectedCount: number;
 *         healthRecordCount: number;
 *         runtimeChatOkCount: number;
 *         runtimeAgentProbeProofCount: number;
 *         runtimeProbeProofCount: number;
 *         runtimeLiveToolProtocolProofCount: number;
 *         runtimeLiveAskUserProofCount: number;
 *         runtimeLiveProtocolFailureCount: number;
 *         runtimeHealthProofCount: number;
 *         selectedProviders: Record<string, number>;
 *         selectedSelectorKinds: Record<string, number>;
 *         rejectedReasonCounts: Record<string, number>;
 *     };
 *     profiles: Array<{
 *         profileId: string;
 *         selected: ReturnType<typeof selectedSummary>;
 *         candidateAlternates: Array<NonNullable<ReturnType<typeof selectedSummary>>>;
 *         candidateCount: number;
 *         rejectedCount: number;
 *         fallbackChain: string[];
 *         topRejectedReasons: string[];
 *         nextActions: string[];
 *         capabilitySupply: {
 *             candidateCount: number;
 *             required: Record<string, number>;
 *             softRequired: Record<string, number>;
 *             preferred: Record<string, number>;
 *         };
 *         supplyWarnings: string[];
 *         decisionLayers: Record<string, unknown>;
 *         snapshotContext: Record<string, number>;
 *     }>;
 * }}
 */
function auditPreparedModelGatewaySelection(preparedSnapshot, options, auditOptions) {
    options = isRecord(options) ? options : {};
    const strict = options.strict === true;
    const requestedProfiles = new Set(stringList(options.profiles));
    const profileIds = resolveProfileIds(options);
    const runtimeRouteProfile = optionalString(options.runtimeRouteProfile);
    const profileAudits = profileIds.map((profileId) => {
        const effectiveRouteProfile = runtimeRouteProfile ?? (auditOptions.ignoreRuntimeHealth ? null : profileId);
        /** @type {Parameters<typeof routePreparedModelGatewayCatalogSnapshot>[2]} */
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
        if (effectiveRouteProfile) routeOptions.routeProfile = effectiveRouteProfile;
        if (options.secretRegistry !== undefined) routeOptions.secretRegistry = options.secretRegistry;
        if (options.runtimeProofWeights !== undefined) routeOptions.runtimeProofWeights = options.runtimeProofWeights;
        if (options.now !== undefined) routeOptions.now = options.now;
        if (typeof options.maxRuntimeProofAgeMs === 'number')
            routeOptions.maxRuntimeProofAgeMs = options.maxRuntimeProofAgeMs;
        if (Array.isArray(options.runtimeHealthRecords))
            routeOptions.runtimeHealthRecords = options.runtimeHealthRecords;
        if (options.runtimeHealthIndex !== undefined) {
            routeOptions.runtimeHealthIndex = /** @type {NonNullable<
    NonNullable<Parameters<typeof routePreparedModelGatewayCatalogSnapshot>[2]>['runtimeHealthIndex']
>} */ (options.runtimeHealthIndex);
        }
        if (typeof options.temporaryFailureCooldownMs === 'number') {
            routeOptions.temporaryFailureCooldownMs = options.temporaryFailureCooldownMs;
        }
        if (typeof options.providerCooldownWindowMs === 'number') {
            routeOptions.providerCooldownWindowMs = options.providerCooldownWindowMs;
        }
        if (typeof options.providerCooldownMinFailedModels === 'number') {
            routeOptions.providerCooldownMinFailedModels = options.providerCooldownMinFailedModels;
        }
        if (Array.isArray(options.providerCooldownFailureKinds)) {
            routeOptions.providerCooldownFailureKinds = stringList(options.providerCooldownFailureKinds);
        }
        if (Array.isArray(options.requiredProbeKinds))
            routeOptions.requiredProbeKinds = stringList(options.requiredProbeKinds);
        if (Array.isArray(options.preferredProbeKinds))
            routeOptions.preferredProbeKinds = stringList(options.preferredProbeKinds);
        if (Array.isArray(options.blockFailedProbeKinds))
            routeOptions.blockFailedProbeKinds = stringList(options.blockFailedProbeKinds);
        const profile = resolveModelGatewayTaskProfile(profileId);
        const route = routePreparedModelGatewayCatalogSnapshot(preparedSnapshot, profileId, routeOptions);
        const explanation = explainGatewayRouteDecision(route);
        const supply = capabilitySupply(route.candidates, profile);
        return {
            profileId,
            selected: selectedSummary(route.selected),
            candidateAlternates: candidateSummaries(route.candidates),
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
    const selectedRows = profileAudits.map((profile) => profile.selected).filter((selected) => selected !== null);
    const selectedProfileCount = selectedRows.length;
    return {
        ok: selectedProfileCount === profileAudits.length,
        schema: auditOptions.schema,
        mode: strict ? 'strict_access_only' : 'allow_probe_unknown',
        runtimeMode: auditOptions.runtimeMode,
        snapshotContext: profileAudits[0]?.snapshotContext ?? {
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
            runtimeChatOkCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeChatOkCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeAgentProbeProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeAgentProbeProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeProbeProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeProbeProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeLiveToolProtocolProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeLiveToolProtocolProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeLiveAskUserProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeLiveAskUserProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeLiveProtocolFailureCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeLiveProtocolFailureCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            runtimeHealthProofCount: profileAudits.reduce((sum, profile) => {
                const value = profile.decisionLayers['runtimeHealthProofCount'];
                return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
            }, 0),
            selectedProviders: countBy(selectedRows, (selected) => selected.providerId),
            selectedSelectorKinds: countBy(selectedRows, (selected) => selected.selectorKind),
            rejectedReasonCounts: mergeCounts(profileAudits.map((profile) => profile.rejectedReasonCounts)),
        },
        profiles: profileAudits.map(({ rejectedReasonCounts, ...profile }) => profile),
    };
}

/**
 * @param {Record<string, unknown>} snapshot
 * @param {Parameters<typeof auditPreparedModelGatewaySelection>[1]} options
 * @param {Parameters<typeof auditPreparedModelGatewaySelection>[2]} auditOptions
 * @returns {ReturnType<typeof auditPreparedModelGatewaySelection>}
 */
function auditModelGatewaySelection(snapshot, options, auditOptions) {
    const normalizedOptions = isRecord(options) ? options : {};
    const preparedSnapshot = prepareModelGatewayCatalogRoutingSnapshot(snapshot, {
        includeProjectionOnly: normalizedOptions.includeProjectionOnly !== false,
    });
    return auditPreparedModelGatewaySelection(preparedSnapshot, normalizedOptions, auditOptions);
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

/**
 * Audit an already-prepared routing snapshot without rebuilding its candidate universe.
 * @param {ReturnType<typeof prepareModelGatewayCatalogRoutingSnapshot>} preparedSnapshot
 * @param {Parameters<typeof auditPreparedModelGatewaySelection>[1]} [options]
 */
export function auditPreparedModelGatewayPreRuntimeSelection(preparedSnapshot, options = {}) {
    return auditPreparedModelGatewaySelection(preparedSnapshot, options, {
        schema: 'model-gateway-pre-runtime-selection-audit',
        ignoreRuntimeHealth: true,
        runtimeMode: 'metadata_only',
    });
}

/**
 * Audit observed runtime health against an already-prepared routing snapshot.
 * @param {ReturnType<typeof prepareModelGatewayCatalogRoutingSnapshot>} preparedSnapshot
 * @param {Parameters<typeof auditPreparedModelGatewaySelection>[1]} [options]
 */
export function auditPreparedModelGatewayPostRuntimeSelection(preparedSnapshot, options = {}) {
    return auditPreparedModelGatewaySelection(preparedSnapshot, options, {
        schema: 'model-gateway-post-runtime-selection-audit',
        ignoreRuntimeHealth: false,
        runtimeMode: 'observed_runtime_health',
    });
}

/**
 * @param {ReturnType<typeof selectedSummary>} selected
 * @returns {string | null}
 */
function selectedRouteKey(selected) {
    if (!selected) return null;
    return [
        selected.providerId ?? 'unknown-provider',
        selected.providerModel ?? selected.id ?? 'unknown-model',
        selected.selectorKind ?? 'exact_model',
        selected.selectorSyntax ?? selected.providerModel ?? selected.id ?? 'unknown-model',
    ].join(':');
}

/**
 * @param {ReturnType<typeof selectedSummary>} selected
 * @returns {boolean}
 */
function selectedHasRuntimeProof(selected) {
    if (!selected?.runtimeHealth) return false;
    return (
        selected.runtimeHealth.lastStatus === 'ok' ||
        selected.runtimeHealth.agentProbeStatus === 'ok' ||
        selected.runtimeHealth.verifiedProbes.length > 0
    );
}

/**
 * @template {{ profileId: string }} T
 * @param {readonly T[]} profiles
 * @returns {Map<string, T>}
 */
function profilesById(profiles) {
    const byId = new Map();
    for (const profile of profiles) byId.set(profile.profileId, profile);
    return byId;
}

/**
 * Compare a metadata/pre-runtime selection with a post-runtime selection using the same profile set.
 *
 * The comparison is deliberately observational: it does not decide that post-runtime should win. It only records what
 * changed when volatile health proofs were allowed into scoring.
 *
 * @param {ReturnType<typeof auditModelGatewayPreRuntimeSelection>} preRuntimeSelection
 * @param {ReturnType<typeof auditModelGatewayPostRuntimeSelection>} postRuntimeSelection
 * @param {{ profiles?: string[] }} [options]
 * @returns {{
 *     schema: 'model-gateway-selection-comparison';
 *     ok: boolean;
 *     summary: {
 *         profileCount: number;
 *         changedCount: number;
 *         unchangedCount: number;
 *         preSelectedCount: number;
 *         postSelectedCount: number;
 *         postRuntimeProofSelectedCount: number;
 *         postRuntimeHealthProofCount: number;
 *         postRuntimeProbeProofCount: number;
 *     };
 *     rows: Array<{
 *         profileId: string;
 *         changed: boolean;
 *         preSelected: ReturnType<typeof selectedSummary>;
 *         postSelected: ReturnType<typeof selectedSummary>;
 *         preCandidateAlternates: Array<NonNullable<ReturnType<typeof selectedSummary>>>;
 *         postCandidateAlternates: Array<NonNullable<ReturnType<typeof selectedSummary>>>;
 *         preRouteKey: string | null;
 *         postRouteKey: string | null;
 *         postSelectedHasRuntimeProof: boolean;
 *         postDecisionLayers: Record<string, unknown>;
 *     }>;
 * }}
 */
export function compareModelGatewaySelectionAudits(preRuntimeSelection, postRuntimeSelection, options = {}) {
    const requestedProfileIds = stringList(options.profiles);
    const requestedProfiles = new Set(requestedProfileIds);
    const allPreProfiles = preRuntimeSelection.profiles;
    const preProfilesById = profilesById(allPreProfiles);
    const preProfiles =
        requestedProfiles.size > 0
            ? requestedProfileIds
                  .map((profileId) => preProfilesById.get(profileId))
                  .filter((profile) => profile !== undefined)
            : allPreProfiles;
    const postProfiles = profilesById(postRuntimeSelection.profiles);
    const rows = preProfiles.map((preProfile) => {
        const profileId = preProfile.profileId;
        const postProfile = postProfiles.get(profileId);
        const preSelected = preProfile.selected;
        const postSelected = postProfile?.selected ?? null;
        const preCandidateAlternates = preProfile.candidateAlternates;
        const postCandidateAlternates = postProfile?.candidateAlternates ?? [];
        const preRouteKey = selectedRouteKey(preSelected);
        const postRouteKey = selectedRouteKey(postSelected);
        return {
            profileId,
            changed: preRouteKey !== postRouteKey,
            preSelected,
            postSelected,
            preCandidateAlternates,
            postCandidateAlternates,
            preRouteKey,
            postRouteKey,
            postSelectedHasRuntimeProof: selectedHasRuntimeProof(postSelected),
            postDecisionLayers: postProfile?.decisionLayers ?? {},
        };
    });
    const changedCount = rows.filter((row) => row.changed).length;
    const scopedOk =
        requestedProfiles.size > 0
            ? rows.length === requestedProfiles.size &&
              rows.every((row) => row.preSelected !== null && row.postSelected !== null)
            : preRuntimeSelection.ok === true && postRuntimeSelection.ok === true;
    const postRuntimeHealthProofCount = rows.reduce((sum, row) => {
        const value = row.postDecisionLayers['runtimeHealthProofCount'];
        return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    }, 0);
    const postRuntimeProbeProofCount = rows.reduce((sum, row) => {
        const value = row.postDecisionLayers['runtimeProbeProofCount'];
        return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    }, 0);
    return {
        schema: 'model-gateway-selection-comparison',
        ok: scopedOk,
        summary: {
            profileCount: rows.length,
            changedCount,
            unchangedCount: rows.length - changedCount,
            preSelectedCount: rows.filter((row) => row.preSelected !== null).length,
            postSelectedCount: rows.filter((row) => row.postSelected !== null).length,
            postRuntimeProofSelectedCount: rows.filter((row) => row.postSelectedHasRuntimeProof).length,
            postRuntimeHealthProofCount,
            postRuntimeProbeProofCount,
        },
        rows,
    };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function selectionComparisonReason(row) {
    const preSelected = isRecord(row['preSelected']);
    const postSelected = isRecord(row['postSelected']);
    if (!preSelected && !postSelected) return 'both_unselected';
    if (!preSelected && postSelected)
        return row['postSelectedHasRuntimeProof'] === true
            ? 'post_runtime_discovered_route'
            : 'post_runtime_fallback_route';
    if (preSelected && !postSelected) return 'post_runtime_lost_route';
    if (row['changed'] === true)
        return row['postSelectedHasRuntimeProof'] === true
            ? 'post_runtime_proved_better_route'
            : 'post_runtime_changed_route';
    if (row['postSelectedHasRuntimeProof'] === true) return 'same_route_runtime_proved';
    return 'same_route_no_runtime_proof';
}

/**
 * @param {string} reason
 * @returns {string[]}
 */
function selectionComparisonNextActions(reason) {
    if (reason === 'both_unselected') return ['inspect_pre_runtime_rejections'];
    if (reason === 'post_runtime_discovered_route') return ['refresh_eligibility_or_prefer_runtime_proved_policy'];
    if (reason === 'post_runtime_fallback_route') return ['inspect_metadata_filters_before_using_fallback'];
    if (reason === 'post_runtime_lost_route') return ['keep_metadata_route_or_refresh_runtime_health'];
    if (reason === 'post_runtime_proved_better_route') return ['consider_prefer_runtime_proved_policy'];
    if (reason === 'post_runtime_changed_route') return ['inspect_effective_health_before_switching'];
    if (reason === 'same_route_runtime_proved') return ['record_runtime_proof_and_keep_route'];
    return ['candidate_can_remain_metadata_first'];
}

/**
 * Explain how metadata-only selection differs from effective/observed selection.
 *
 * This helper does not choose a winner. It makes the comparison actionable for terminal, trace and future selector
 * policy layers.
 *
 * @param {ReturnType<typeof compareModelGatewaySelectionAudits>} comparison
 * @returns {{
 *     schema: 'model-gateway-selection-comparison-explain';
 *     ok: boolean;
 *     summary: {
 *         profileCount: number;
 *         changedCount: number;
 *         unchangedCount: number;
 *         runtimeProofCount: number;
 *         reasonCounts: Record<string, number>;
 *         nextActions: string[];
 *     };
 *     rows: {
 *         profileId: string;
 *         changed: boolean;
 *         reason: string;
 *         nextActions: string[];
 *         preRouteKey: string | null;
 *         postRouteKey: string | null;
 *         postSelectedHasRuntimeProof: boolean;
 *     }[];
 * }}
 */
export function explainModelGatewaySelectionComparison(comparison) {
    const rows = comparison.rows.map((row) => {
        const reason = selectionComparisonReason(row);
        return {
            profileId: row.profileId,
            changed: row.changed,
            reason,
            nextActions: selectionComparisonNextActions(reason),
            preRouteKey: row.preRouteKey,
            postRouteKey: row.postRouteKey,
            postSelectedHasRuntimeProof: row.postSelectedHasRuntimeProof,
        };
    });
    return {
        schema: 'model-gateway-selection-comparison-explain',
        ok: comparison.ok === true,
        summary: {
            profileCount: rows.length,
            changedCount: rows.filter((row) => row.changed).length,
            unchangedCount: rows.filter((row) => !row.changed).length,
            runtimeProofCount: rows.filter((row) => row.postSelectedHasRuntimeProof).length,
            reasonCounts: countBy(rows, (row) => row.reason),
            nextActions: [...new Set(rows.flatMap((row) => row.nextActions))].sort(),
        },
        rows,
    };
}

/**
 * @param {unknown} value
 * @returns {'metadata_first' | 'prefer_runtime_proved' | 'require_runtime_proof'}
 */
function normalizeSelectionPolicyMode(value) {
    const normalized = optionalString(value)?.replaceAll('-', '_');
    if (normalized === MODEL_GATEWAY_SELECTION_POLICY_MODE.PREFER_RUNTIME_PROVED) return normalized;
    if (normalized === MODEL_GATEWAY_SELECTION_POLICY_MODE.REQUIRE_RUNTIME_PROOF) return normalized;
    return MODEL_GATEWAY_SELECTION_POLICY_MODE.METADATA_FIRST;
}

/**
 * Resolve a final, non-mutating route choice from a pre/post-runtime comparison under an explicit operator policy.
 *
 * This function does not run providers and does not decide the default product behavior by itself. It records what a
 * caller asked for: keep metadata-first choices, prefer proved runtime choices, or require runtime proof.
 *
 * @param {ReturnType<typeof compareModelGatewaySelectionAudits>} comparison
 * @param {{ mode?: 'metadata_first' | 'prefer_runtime_proved' | 'require_runtime_proof' | string }} [options]
 * @returns {{
 *     schema: 'model-gateway-selection-policy-resolution';
 *     ok: boolean;
 *     mode: 'metadata_first' | 'prefer_runtime_proved' | 'require_runtime_proof';
 *     summary: {
 *         profileCount: number;
 *         selectedCount: number;
 *         unselectedCount: number;
 *         metadataWinnerCount: number;
 *         postRuntimeWinnerCount: number;
 *         runtimeProofSelectedCount: number;
 *         changedFromPreRuntimeCount: number;
 *     };
 *     rows: Array<{
 *         profileId: string;
 *         selected: ReturnType<typeof selectedSummary>;
 *         source:
 *             | 'pre_runtime_metadata'
 *             | 'post_runtime_proved'
 *             | 'post_runtime_fallback'
 *             | 'blocked_runtime_proof_missing';
 *         changedFromPreRuntime: boolean;
 *         hasRuntimeProof: boolean;
 *         preSelected: ReturnType<typeof selectedSummary>;
 *         postSelected: ReturnType<typeof selectedSummary>;
 *         candidateAlternates: Array<NonNullable<ReturnType<typeof selectedSummary>>>;
 *     }>;
 * }}
 */
export function resolveModelGatewaySelectionPolicy(comparison, options = {}) {
    const mode = normalizeSelectionPolicyMode(options.mode);
    const rows = comparison.rows.map((row) => {
        let selected = row.preSelected;
        const preCandidateAlternates = row.preCandidateAlternates;
        const postCandidateAlternates = row.postCandidateAlternates;
        /** @type {'pre_runtime_metadata'
    | 'post_runtime_proved'
    | 'post_runtime_fallback'
    | 'blocked_runtime_proof_missing'} */
        let source = 'pre_runtime_metadata';
        if (mode === MODEL_GATEWAY_SELECTION_POLICY_MODE.REQUIRE_RUNTIME_PROOF) {
            selected = row.postSelectedHasRuntimeProof ? row.postSelected : null;
            source = row.postSelectedHasRuntimeProof ? 'post_runtime_proved' : 'blocked_runtime_proof_missing';
        } else if (mode === MODEL_GATEWAY_SELECTION_POLICY_MODE.PREFER_RUNTIME_PROVED) {
            if (row.postSelectedHasRuntimeProof) {
                selected = row.postSelected;
                source = 'post_runtime_proved';
            } else if (!selected && row.postSelected) {
                selected = row.postSelected;
                source = 'post_runtime_fallback';
            }
        } else if (!selected && row.postSelected) {
            selected = row.postSelected;
            source = 'post_runtime_fallback';
        }
        const candidateAlternates =
            mode === MODEL_GATEWAY_SELECTION_POLICY_MODE.PREFER_RUNTIME_PROVED ||
            mode === MODEL_GATEWAY_SELECTION_POLICY_MODE.REQUIRE_RUNTIME_PROOF
                ? [...postCandidateAlternates, ...preCandidateAlternates]
                : [...preCandidateAlternates, ...postCandidateAlternates];
        return {
            profileId: row.profileId,
            selected,
            source,
            changedFromPreRuntime: selectedRouteKey(selected) !== row.preRouteKey,
            hasRuntimeProof: selectedHasRuntimeProof(selected),
            preSelected: row.preSelected,
            postSelected: row.postSelected,
            candidateAlternates,
        };
    });
    return {
        schema: 'model-gateway-selection-policy-resolution',
        ok: rows.every((row) => row.selected !== null),
        mode,
        summary: {
            profileCount: rows.length,
            selectedCount: rows.filter((row) => row.selected !== null).length,
            unselectedCount: rows.filter((row) => row.selected === null).length,
            metadataWinnerCount: rows.filter((row) => row.source === 'pre_runtime_metadata').length,
            postRuntimeWinnerCount: rows.filter(
                (row) => row.source === 'post_runtime_proved' || row.source === 'post_runtime_fallback',
            ).length,
            runtimeProofSelectedCount: rows.filter((row) => row.hasRuntimeProof).length,
            changedFromPreRuntimeCount: rows.filter((row) => row.changedFromPreRuntime).length,
        },
        rows,
    };
}
