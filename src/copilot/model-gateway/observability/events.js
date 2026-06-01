// @ts-check
/**
 * Stabilized model-gateway events.
 *
 * Observability may count, persist and correlate these events. It must not recalculate routing, infer provider
 * capabilities or read provider secrets.
 *
 * @module copilot/model-gateway/observability/events
 */

import {
    MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED,
    MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED,
    MODEL_GATEWAY_CATALOG_IMPORT_STARTED,
    MODEL_GATEWAY_CATALOG_MODEL_ADDED,
    MODEL_GATEWAY_CATALOG_MODEL_CHANGED,
    MODEL_GATEWAY_CATALOG_MODEL_REMOVED,
    MODEL_GATEWAY_ELIGIBILITY_EVALUATED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
} from '#copilot/events';
import { summarizeCanonicalModelProjectionDiff } from '../catalog/import-runs.js';

let routeDecisionSequence = 0;

export {
    MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED,
    MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED,
    MODEL_GATEWAY_CATALOG_IMPORT_STARTED,
    MODEL_GATEWAY_CATALOG_MODEL_ADDED,
    MODEL_GATEWAY_CATALOG_MODEL_CHANGED,
    MODEL_GATEWAY_CATALOG_MODEL_REMOVED,
    MODEL_GATEWAY_ELIGIBILITY_EVALUATED,
    MODEL_GATEWAY_EVENTS,
    MODEL_GATEWAY_MODEL_IMPORTED,
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_PROVIDER_FAILURE,
    MODEL_GATEWAY_PROVIDER_IMPORTED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
} from '#copilot/events';

/**
 * @param {ReturnType<import('../registry/snapshot.js').buildEnvByokModelGatewaySnapshot>} snapshot
 * @returns {{ type: string; timestamp: number; providerCount: number; modelCount: number; enabledModelCount: number; source: string }}
 */
export function buildRegistrySnapshotEvent(snapshot) {
    return {
        type: MODEL_GATEWAY_REGISTRY_SNAPSHOT,
        timestamp: Date.now(),
        providerCount: snapshot.diagnostics.providerCount,
        modelCount: snapshot.diagnostics.modelCount,
        enabledModelCount: snapshot.diagnostics.enabledModelCount,
        source: snapshot.source,
    };
}

/**
 * @param {ReturnType<import('../registry/snapshot.js').buildEnvByokModelGatewaySnapshot>} snapshot
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectModelGatewayMetrics(snapshot) {
    return {
        counters: {
            'model_gateway.registry.snapshot': 1,
        },
        gauges: {
            'model_gateway.providers': snapshot.diagnostics.providerCount,
            'model_gateway.models': snapshot.diagnostics.modelCount,
            'model_gateway.models.enabled': snapshot.diagnostics.enabledModelCount,
            'model_gateway.config.errors': snapshot.diagnostics.errors.length,
            'model_gateway.config.warnings': snapshot.diagnostics.warnings.length,
        },
    };
}

/**
 * @param {{
 *     probeKind: 'chat' | 'agent' | 'streaming' | 'json' | 'vision' | string;
 *     result: {
 *         ok?: boolean;
 *         status?: string;
 *         elapsedMs?: number;
 *         model?: string | null;
 *         profile?: string | null;
 *         preset?: string | null;
 *         providerType?: string | null;
 *         deltaCount?: number;
 *         deltaChars?: number;
 *         finalChars?: number;
 *         observedFinalEvent?: boolean;
 *         sessionId?: string | null;
 *         errors?: string[];
 *         warnings?: string[];
 *     };
 *     providerAttempted?: boolean;
 * }} input
 * @returns {{
 *     type: string;
 *     timestamp: number;
 *     probeKind: string;
 *     ok: boolean;
 *     status: string;
 *     elapsedMs: number | null;
 *     providerAttempted: boolean;
 *     model: string | null;
 *     profile: string | null;
 *     preset: string | null;
 *     providerType: string | null;
 *     deltaCount: number;
 *     deltaChars: number;
 *     finalChars: number;
 *     observedFinalEvent: boolean;
 *     sessionId: string | null;
 *     errorCount: number;
 *     warningCount: number;
 * }}
 */
export function buildProbeCompletedEvent(input) {
    const result = input.result;
    const status = typeof result.status === 'string' && result.status ? result.status : 'unknown';
    return {
        type: MODEL_GATEWAY_PROBE_COMPLETED,
        timestamp: Date.now(),
        probeKind: input.probeKind,
        ok: result.ok === true,
        status,
        elapsedMs: typeof result.elapsedMs === 'number' && Number.isFinite(result.elapsedMs) ? result.elapsedMs : null,
        providerAttempted: input.providerAttempted !== false,
        model: result.model ?? null,
        profile: result.profile ?? null,
        preset: result.preset ?? null,
        providerType: result.providerType ?? null,
        deltaCount: typeof result.deltaCount === 'number' && Number.isFinite(result.deltaCount) ? result.deltaCount : 0,
        deltaChars: typeof result.deltaChars === 'number' && Number.isFinite(result.deltaChars) ? result.deltaChars : 0,
        finalChars: typeof result.finalChars === 'number' && Number.isFinite(result.finalChars) ? result.finalChars : 0,
        observedFinalEvent: result.observedFinalEvent === true,
        sessionId: result.sessionId ?? null,
        errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
        warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    };
}

/**
 * @param {ReturnType<typeof buildProbeCompletedEvent>} event
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectProbeCompletedMetrics(event) {
    const kind = event.probeKind || 'unknown';
    const status = event.status || 'unknown';
    return {
        counters: {
            'model_gateway.probe.completed': 1,
            [`model_gateway.probe.${event.ok ? 'ok' : 'failed'}`]: 1,
            [`model_gateway.probe.kind.${kind}`]: 1,
            [`model_gateway.probe.status.${status}`]: 1,
        },
        gauges: {
            'model_gateway.probe.elapsed_ms': event.elapsedMs ?? 0,
            'model_gateway.probe.delta_count': event.deltaCount,
            'model_gateway.probe.delta_chars': event.deltaChars,
            'model_gateway.probe.final_chars': event.finalChars,
            'model_gateway.probe.errors': event.errorCount,
            'model_gateway.probe.warnings': event.warningCount,
        },
    };
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
 * @returns {number | null}
 */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown[]} values
 * @param {number} limit
 * @returns {string[]}
 */
function safeStringList(values, limit) {
    return values.map(optionalString).filter((item) => item !== null).slice(0, limit);
}

/**
 * @param {Record<string, any> | null | undefined} selected
 * @returns {{ gatewayModelId: string | null; providerId: string | null; modelId: string | null; score: number | null; scoreBreakdown: Record<string, unknown> | null; reasons: string[] }}
 */
function summarizeSelectedRouteCandidate(selected) {
    if (!selected) {
        return { gatewayModelId: null, providerId: null, modelId: null, score: null, scoreBreakdown: null, reasons: [] };
    }
    const model = selected['model'] ?? {};
    return {
        gatewayModelId: optionalString(model['id']),
        providerId: optionalString(model['providerId']),
        modelId: optionalString(model['providerModel']) ?? optionalString(model['id']),
        score: finiteNumber(selected['score']),
        scoreBreakdown: optionalRecord(selected['scoreBreakdown']),
        reasons: safeStringList(Array.isArray(selected['reasons']) ? selected['reasons'] : [], 24),
    };
}

/**
 * @param {number} timestamp
 * @param {string} taskProfile
 * @param {string} modelId
 * @param {{ mode?: string | null; source?: string | null; failure?: string | null }} input
 * @returns {string}
 */
function buildRouteDecisionId(timestamp, taskProfile, modelId, input) {
    routeDecisionSequence = (routeDecisionSequence + 1) % 1_000_000;
    return [
        'route',
        timestamp,
        routeDecisionSequence,
        taskProfile,
        optionalString(input.source) ?? 'model-gateway',
        optionalString(input.mode) ?? 'unknown',
        modelId,
        optionalString(input.failure) ?? 'ok',
    ]
        .join('-')
        .replace(/[^a-zA-Z0-9._:-]+/gu, '-');
}

/**
 * @param {{
 *     taskProfile: string;
 *     routeProfile?: string | null;
 *     mode?: string;
 *     source?: string;
 *     sessionId?: string | null;
 *     route: {
 *         selected?: Record<string, any> | null;
 *         candidates?: unknown[];
 *         rejected?: unknown[];
 *         fallbackChain?: unknown[];
 *     };
 *     estimatedInputTokens?: number | null;
 *     estimatedOutputTokens?: number | null;
 *     estimatedCostUsd?: number | null;
 *     failure?: string | null;
 * }} input
 * @returns {{
 *     type: string;
 *     timestamp: number;
 *     decisionId: string;
 *     taskProfile: string;
 *     routeProfile: string | null;
 *     mode: string;
 *     source: string;
 *     sessionId: string | null;
 *     selected: boolean;
 *     gatewayModelId: string | null;
 *     providerId: string | null;
 *     modelId: string | null;
 *     score: number | null;
 *     scoreBreakdown: Record<string, unknown> | null;
 *     reasons: string[];
 *     candidateCount: number;
 *     rejectedCount: number;
 *     fallbackChain: string[];
 *     estimatedInputTokens: number | null;
 *     estimatedOutputTokens: number | null;
 *     estimatedCostUsd: number | null;
 *     failure: string | null;
 *     traceAttributes: Record<string, string | number | boolean>;
 * }}
 */
export function buildRouteDecisionEvent(input) {
    const selected = summarizeSelectedRouteCandidate(input.route.selected ?? null);
    const timestamp = Date.now();
    const taskProfile = optionalString(input.taskProfile) ?? 'unknown';
    const routeProfile = optionalString(input.routeProfile);
    const modelId = selected.modelId ?? 'none';
    const mode = optionalString(input.mode) ?? 'unknown';
    const source = optionalString(input.source) ?? 'model-gateway';
    const failure = optionalString(input.failure);
    const event = {
        type: MODEL_GATEWAY_ROUTE_DECISION,
        timestamp,
        decisionId: buildRouteDecisionId(timestamp, taskProfile, modelId, { mode, source, failure }),
        taskProfile,
        routeProfile,
        mode,
        source,
        sessionId: optionalString(input.sessionId),
        selected: selected.modelId !== null,
        gatewayModelId: selected.gatewayModelId,
        providerId: selected.providerId,
        modelId: selected.modelId,
        score: selected.score,
        scoreBreakdown: selected.scoreBreakdown,
        reasons: selected.reasons,
        candidateCount: Array.isArray(input.route.candidates) ? input.route.candidates.length : 0,
        rejectedCount: Array.isArray(input.route.rejected) ? input.route.rejected.length : 0,
        fallbackChain: safeStringList(Array.isArray(input.route.fallbackChain) ? input.route.fallbackChain : [], 12),
        estimatedInputTokens: finiteNumber(input.estimatedInputTokens),
        estimatedOutputTokens: finiteNumber(input.estimatedOutputTokens),
        estimatedCostUsd: finiteNumber(input.estimatedCostUsd),
        failure,
    };
    return {
        ...event,
        traceAttributes: buildRouteDecisionTraceAttributes(event),
    };
}

/**
 * @param {{
 *     decisionId: string;
 *     taskProfile: string;
 *     routeProfile: string | null;
 *     mode: string;
 *     selected: boolean;
 *     gatewayModelId: string | null;
 *     providerId: string | null;
 *     modelId: string | null;
 *     score: number | null;
 *     candidateCount: number;
 *     rejectedCount: number;
 *     fallbackChain: string[];
 *     failure: string | null;
 * }} event
 * @returns {Record<string, string | number | boolean>}
 */
export function buildRouteDecisionTraceAttributes(event) {
    return {
        'llm.provider': event.providerId ?? 'none',
        'llm.model': event.modelId ?? 'none',
        'llm.gateway.model_id': event.gatewayModelId ?? 'none',
        'llm.route.decision_id': event.decisionId,
        'llm.route.task_profile': event.taskProfile,
        'llm.route.profile': event.routeProfile ?? 'none',
        'llm.route.mode': event.mode,
        'llm.route.selected': event.selected,
        'llm.route.score': event.score ?? 0,
        'llm.route.candidates': event.candidateCount,
        'llm.route.rejected': event.rejectedCount,
        'llm.route.fallback_count': event.fallbackChain.length,
        'llm.route.failure': event.failure ?? 'none',
    };
}

/**
 * @param {ReturnType<typeof buildRouteDecisionEvent>} event
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectRouteDecisionMetrics(event) {
    return {
        counters: {
            'model_gateway.route.decision': 1,
            [`model_gateway.route.${event.selected ? 'selected' : 'unselected'}`]: 1,
            [`model_gateway.route.mode.${event.mode || 'unknown'}`]: 1,
        },
        gauges: {
            'model_gateway.route.candidates': event.candidateCount,
            'model_gateway.route.rejected': event.rejectedCount,
            'model_gateway.route.fallback': event.fallbackChain.length,
            'model_gateway.route.estimated_input_tokens': event.estimatedInputTokens ?? 0,
            'model_gateway.route.estimated_cost_usd': event.estimatedCostUsd ?? 0,
        },
    };
}

/**
 * @param {{
 *     source?: string;
 *     storePath?: string | null;
 *     run?: Record<string, any> | null;
 *     summary?: { modelCount?: number; eligibleCount?: number; unknownCount?: number; excludedCount?: number };
 *     decisions?: Record<string, any>[];
 *     persisted?: boolean;
 * }} input
 * @returns {{
 *     type: string;
 *     timestamp: number;
 *     source: string;
 *     storePath: string | null;
 *     runId: string | null;
 *     policyProfile: string;
 *     taskProfile: string;
 *     accountScope: string;
 *     persisted: boolean;
 *     modelCount: number;
 *     eligibleCount: number;
 *     unknownCount: number;
 *     excludedCount: number;
 *     hardReasonCounts: Record<string, number>;
 *     softReasonCounts: Record<string, number>;
 *     dispositionCounts: Record<string, number>;
 * }}
 */
export function buildEligibilityEvaluatedEvent(input) {
    const run = asRecord(input.run);
    const summary = asRecord(input.summary);
    const reasonSummary = summarizeEligibilityDecisionReasons(input.decisions);
    return {
        type: MODEL_GATEWAY_ELIGIBILITY_EVALUATED,
        timestamp: Date.now(),
        source: optionalString(input.source) ?? 'eligibility-refresh',
        storePath: optionalString(input.storePath),
        runId: optionalString(run['runId']),
        policyProfile: optionalString(run['policyProfile']) ?? 'default',
        taskProfile: optionalString(run['taskProfile']) ?? 'default',
        accountScope: optionalString(run['accountScope']) ?? 'default',
        persisted: input.persisted === true,
        modelCount: finiteNumber(summary['modelCount']) ?? finiteNumber(run['modelCount']) ?? 0,
        eligibleCount: finiteNumber(summary['eligibleCount']) ?? finiteNumber(run['eligibleCount']) ?? 0,
        unknownCount: finiteNumber(summary['unknownCount']) ?? finiteNumber(run['unknownCount']) ?? 0,
        excludedCount: finiteNumber(summary['excludedCount']) ?? finiteNumber(run['excludedCount']) ?? 0,
        hardReasonCounts: reasonSummary.hardReasonCounts,
        softReasonCounts: reasonSummary.softReasonCounts,
        dispositionCounts: reasonSummary.dispositionCounts,
    };
}

/**
 * @param {unknown} reason
 * @returns {string | null}
 */
function metricReason(reason) {
    const value = optionalString(reason);
    return value ? value.toLowerCase().replace(/[^a-z0-9_.:-]+/gu, '_') : null;
}

/**
 * @param {Record<string, number>} counts
 * @param {unknown} reason
 * @returns {void}
 */
function incrementReason(counts, reason) {
    const key = metricReason(reason);
    if (!key) return;
    counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * @param {unknown} decisions
 * @returns {{ hardReasonCounts: Record<string, number>; softReasonCounts: Record<string, number>; dispositionCounts: Record<string, number> }}
 */
function summarizeEligibilityDecisionReasons(decisions) {
    /** @type {Record<string, number>} */
    const hardReasonCounts = {};
    /** @type {Record<string, number>} */
    const softReasonCounts = {};
    /** @type {Record<string, number>} */
    const dispositionCounts = {};
    for (const decision of Array.isArray(decisions) ? decisions.map(asRecord).filter((record) => Object.keys(record).length > 0) : []) {
        incrementReason(dispositionCounts, decision['disposition']);
        for (const reason of uniqueStringList(decision['hardExclusions'])) incrementReason(hardReasonCounts, reason);
        for (const reason of uniqueStringList(decision['softPenalties'])) incrementReason(softReasonCounts, reason);
    }
    return { hardReasonCounts, softReasonCounts, dispositionCounts };
}

/**
 * @param {ReturnType<typeof buildEligibilityEvaluatedEvent>} event
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectEligibilityEvaluatedMetrics(event) {
    /** @type {Record<string, number>} */
    const gauges = {
        'model_gateway.eligibility.models': event.modelCount,
        'model_gateway.eligibility.eligible': event.eligibleCount,
        'model_gateway.eligibility.unknown': event.unknownCount,
        'model_gateway.eligibility.excluded': event.excludedCount,
    };
    for (const [reason, count] of Object.entries(event.hardReasonCounts)) {
        gauges[`model_gateway.eligibility.exclusion_reason.hard.${reason}`] = count;
    }
    for (const [reason, count] of Object.entries(event.softReasonCounts)) {
        gauges[`model_gateway.eligibility.exclusion_reason.soft.${reason}`] = count;
    }
    for (const [disposition, count] of Object.entries(event.dispositionCounts)) {
        gauges[`model_gateway.eligibility.disposition.${disposition}`] = count;
    }
    return {
        counters: {
            'model_gateway.eligibility.evaluated': 1,
            [`model_gateway.eligibility.${event.persisted ? 'persisted' : 'previewed'}`]: 1,
            [`model_gateway.eligibility.policy.${event.policyProfile}`]: 1,
        },
        gauges,
    };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueStringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {};
}

/**
 * @param {{
 *     source?: string;
 *     storePath?: string | null;
 *     importerIds?: string[];
 * }} input
 * @returns {{ type: string; timestamp: number; source: string; storePath: string | null; importerIds: string[] }}
 */
export function buildCatalogRefreshStartedEvent(input) {
    return {
        type: MODEL_GATEWAY_CATALOG_IMPORT_STARTED,
        timestamp: Date.now(),
        source: optionalString(input.source) ?? 'catalog-refresh',
        storePath: optionalString(input.storePath),
        importerIds: uniqueStringList(input.importerIds),
    };
}

/**
 * @param {{
 *     source?: string;
 *     storePath?: string | null;
 *     importerIds?: string[];
 *     snapshot: { projections?: unknown[]; providerProjections?: unknown[]; importRuns?: unknown[]; conflicts?: unknown[] };
 *     diff: { added?: string[]; removed?: string[]; changed?: Array<{ changedKinds?: string[] }> };
 *     openai?: { data?: unknown[] };
 * }} input
 * @returns {{
 *     type: string;
 *     timestamp: number;
 *     source: string;
 *     storePath: string | null;
 *     importerIds: string[];
 *     projectionCount: number;
 *     providerProjectionCount: number;
 *     openaiModelCount: number;
 *     importRunCount: number;
 *     conflictCount: number;
 *     addedCount: number;
 *     removedCount: number;
 *     changedCount: number;
 *     changedKinds: string[];
 *     changedKindCounts: Record<string, number>;
 * }}
 */
export function buildCatalogRefreshCompletedEvent(input) {
    const diffSummary = summarizeCanonicalModelProjectionDiff(input.diff);
    return {
        type: MODEL_GATEWAY_CATALOG_IMPORT_COMPLETED,
        timestamp: Date.now(),
        source: optionalString(input.source) ?? 'catalog-refresh',
        storePath: optionalString(input.storePath),
        importerIds: uniqueStringList(input.importerIds),
        projectionCount: Array.isArray(input.snapshot.projections) ? input.snapshot.projections.length : 0,
        providerProjectionCount: Array.isArray(input.snapshot.providerProjections) ? input.snapshot.providerProjections.length : 0,
        openaiModelCount: Array.isArray(input.openai?.data) ? input.openai.data.length : 0,
        importRunCount: Array.isArray(input.snapshot.importRuns) ? input.snapshot.importRuns.length : 0,
        conflictCount: Array.isArray(input.snapshot.conflicts) ? input.snapshot.conflicts.length : 0,
        addedCount: diffSummary.addedCount,
        removedCount: diffSummary.removedCount,
        changedCount: diffSummary.changedCount,
        changedKinds: diffSummary.changedKinds,
        changedKindCounts: diffSummary.changedKindCounts,
    };
}

/**
 * @param {ReturnType<typeof buildCatalogRefreshCompletedEvent>} event
 * @returns {{ counters: Record<string, number>; gauges: Record<string, number> }}
 */
export function projectCatalogRefreshCompletedMetrics(event) {
    /** @type {Record<string, number>} */
    const counters = {
        'model_gateway.catalog.refresh.completed': 1,
    };
    for (const kind of event.changedKinds) {
        counters[`model_gateway.catalog.diff.${kind}`] = event.changedKindCounts[kind] ?? 1;
    }
    return {
        counters,
        gauges: {
            'model_gateway.catalog.projections': event.projectionCount,
            'model_gateway.catalog.provider_projections': event.providerProjectionCount,
            'model_gateway.catalog.openai_models': event.openaiModelCount,
            'model_gateway.catalog.import_runs': event.importRunCount,
            'model_gateway.catalog.conflicts': event.conflictCount,
            'model_gateway.catalog.diff.added': event.addedCount,
            'model_gateway.catalog.diff.removed': event.removedCount,
            'model_gateway.catalog.diff.changed': event.changedCount,
        },
    };
}

/**
 * @param {{
 *     source?: string;
 *     storePath?: string | null;
 *     diff: { added?: string[]; removed?: string[]; changed?: Array<{ key?: string; changedFields?: string[]; changedKinds?: string[] }> };
 * }} input
 * @returns {Array<{ type: string; timestamp: number; source: string; storePath: string | null; key: string; changedFields?: string[]; changedKinds?: string[] }>}
 */
export function buildCatalogRefreshModelEvents(input) {
    const timestamp = Date.now();
    const source = optionalString(input.source) ?? 'catalog-refresh';
    const storePath = optionalString(input.storePath);
    const events = [];
    for (const key of uniqueStringList(input.diff.added)) {
        events.push({ type: MODEL_GATEWAY_CATALOG_MODEL_ADDED, timestamp, source, storePath, key });
    }
    for (const key of uniqueStringList(input.diff.removed)) {
        events.push({ type: MODEL_GATEWAY_CATALOG_MODEL_REMOVED, timestamp, source, storePath, key });
    }
    for (const item of Array.isArray(input.diff.changed) ? input.diff.changed : []) {
        const key = optionalString(item.key);
        if (!key) continue;
        events.push({
            type: MODEL_GATEWAY_CATALOG_MODEL_CHANGED,
            timestamp,
            source,
            storePath,
            key,
            changedFields: uniqueStringList(item.changedFields),
            changedKinds: uniqueStringList(item.changedKinds),
        });
    }
    return events;
}

/**
 * @param {{
 *     source?: string;
 *     storePath?: string | null;
 *     snapshot: { conflicts?: unknown[] };
 * }} input
 * @returns {Array<{ type: string; timestamp: number; source: string; storePath: string | null; projectionKey: string | null; fieldPath: string | null; selectedEvidenceId: string | null; conflictingEvidenceIds: string[] }>}
 */
export function buildCatalogConflictDetectedEvents(input) {
    const timestamp = Date.now();
    const source = optionalString(input.source) ?? 'catalog-refresh';
    const storePath = optionalString(input.storePath);
    return (Array.isArray(input.snapshot.conflicts) ? input.snapshot.conflicts : []).map((conflict) => {
        const record = asRecord(conflict);
        return {
            type: MODEL_GATEWAY_CATALOG_CONFLICT_DETECTED,
            timestamp,
            source,
            storePath,
            projectionKey: optionalString(record['projectionKey']),
            fieldPath: optionalString(record['fieldPath']),
            selectedEvidenceId: optionalString(record['selectedEvidenceId']),
            conflictingEvidenceIds: uniqueStringList(record['conflictingEvidenceIds']),
        };
    });
}

/**
 * @param {Parameters<typeof buildCatalogRefreshCompletedEvent>[0]} input
 * @returns {{
 *     completedEvent: ReturnType<typeof buildCatalogRefreshCompletedEvent>;
 *     modelEvents: ReturnType<typeof buildCatalogRefreshModelEvents>;
 *     conflictEvents: ReturnType<typeof buildCatalogConflictDetectedEvents>;
 *     events: Array<{ type: string; [key: string]: unknown }>;
 * }}
 */
export function buildCatalogRefreshEventBatch(input) {
    const modelEvents = buildCatalogRefreshModelEvents(input);
    const conflictEvents = buildCatalogConflictDetectedEvents(input);
    const completedEvent = buildCatalogRefreshCompletedEvent(input);
    return {
        completedEvent,
        modelEvents,
        conflictEvents,
        events: [...modelEvents, ...conflictEvents, completedEvent],
    };
}
