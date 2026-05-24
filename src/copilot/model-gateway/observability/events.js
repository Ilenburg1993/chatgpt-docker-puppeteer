// @ts-check
/**
 * Stabilized model-gateway events.
 *
 * Observability may count, persist and correlate these events. It must not recalculate routing, infer provider
 * capabilities or read provider secrets.
 *
 * @module copilot/model-gateway/observability/events
 */

import { MODEL_GATEWAY_PROBE_COMPLETED, MODEL_GATEWAY_REGISTRY_SNAPSHOT } from '#copilot/events';

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
