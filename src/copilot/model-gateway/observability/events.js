// @ts-check
/**
 * Stabilized model-gateway events.
 *
 * Observability may count, persist and correlate these events. It must not recalculate routing, infer provider
 * capabilities or read provider secrets.
 *
 * @module copilot/model-gateway/observability/events
 */

import { MODEL_GATEWAY_REGISTRY_SNAPSHOT } from '#copilot/events';

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
