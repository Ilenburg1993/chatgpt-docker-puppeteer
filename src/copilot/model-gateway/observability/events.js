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
    MODEL_GATEWAY_PROBE_COMPLETED,
    MODEL_GATEWAY_REGISTRY_SNAPSHOT,
    MODEL_GATEWAY_ROUTE_DECISION,
} from '#copilot/events';

export {
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
 * @param {unknown[]} values
 * @param {number} limit
 * @returns {string[]}
 */
function safeStringList(values, limit) {
    return values.map(optionalString).filter((item) => item !== null).slice(0, limit);
}

/**
 * @param {Record<string, any> | null | undefined} selected
 * @returns {{ gatewayModelId: string | null; providerId: string | null; modelId: string | null; score: number | null; reasons: string[] }}
 */
function summarizeSelectedRouteCandidate(selected) {
    if (!selected) {
        return { gatewayModelId: null, providerId: null, modelId: null, score: null, reasons: [] };
    }
    const model = selected['model'] ?? {};
    return {
        gatewayModelId: optionalString(model['id']),
        providerId: optionalString(model['providerId']),
        modelId: optionalString(model['providerModel']) ?? optionalString(model['id']),
        score: finiteNumber(selected['score']),
        reasons: safeStringList(Array.isArray(selected['reasons']) ? selected['reasons'] : [], 8),
    };
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
    const event = {
        type: MODEL_GATEWAY_ROUTE_DECISION,
        timestamp,
        decisionId: `route-${timestamp}-${taskProfile}-${modelId}`.replace(/[^a-zA-Z0-9._:-]+/gu, '-'),
        taskProfile,
        routeProfile,
        mode: optionalString(input.mode) ?? 'unknown',
        source: optionalString(input.source) ?? 'model-gateway',
        sessionId: optionalString(input.sessionId),
        selected: selected.modelId !== null,
        gatewayModelId: selected.gatewayModelId,
        providerId: selected.providerId,
        modelId: selected.modelId,
        score: selected.score,
        reasons: selected.reasons,
        candidateCount: Array.isArray(input.route.candidates) ? input.route.candidates.length : 0,
        rejectedCount: Array.isArray(input.route.rejected) ? input.route.rejected.length : 0,
        fallbackChain: safeStringList(Array.isArray(input.route.fallbackChain) ? input.route.fallbackChain : [], 12),
        estimatedInputTokens: finiteNumber(input.estimatedInputTokens),
        estimatedOutputTokens: finiteNumber(input.estimatedOutputTokens),
        estimatedCostUsd: finiteNumber(input.estimatedCostUsd),
        failure: optionalString(input.failure),
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
