// @ts-check
/**
 * src/copilot/observability/sdk-metric-bridge.js
 *
 * Ponte canônica entre as métricas emitidas pela SDK Wrapper Layer (L1) e a infraestrutura de observabilidade de
 * runtime (L2+). Mantém a decisão de projeção fora de `sdk/`, permitindo que o bootstrap escolha como materializar uma
 * `SdkOperationMetric` em métricas/gauges e em sinais observáveis via EventBus.
 *
 * @module copilot/observability/sdk-metric-bridge
 */

/**
 * @typedef {import('../sdk/types.js').SdkOperationMetric} SdkOperationMetric
 *
 * @typedef {import('../core/event-bus.js').EventBus} EventBus
 *
 * @typedef {import('./metrics.js').MetricsStore} MetricsStore
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeSdkMetricSegment(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/gu, '_');
}

/**
 * Materializa uma métrica da SDK Wrapper Layer no `MetricsStore` e, opcionalmente, no `EventBus` canônico de runtime.
 *
 * @param {SdkOperationMetric} metric
 * @param {{ metrics: MetricsStore; bus?: EventBus | null }} deps
 * @returns {void}
 */
export function projectSdkOperationMetric(metric, { metrics, bus }) {
    const op = normalizeSdkMetricSegment(metric.operation);
    const status = normalizeSdkMetricSegment(metric.status);

    metrics.recordCounter(`sdk.operation.${op}.total`);
    metrics.recordCounter(`sdk.operation.${op}.${status}`);

    if (typeof metric.durationMs === 'number') {
        metrics.recordGauge(`sdk.operation.${op}.last_duration_ms`, metric.durationMs);
    }

    const errorKind = metric.attributes?.['errorKind'];
    if (typeof errorKind === 'string' && errorKind) {
        metrics.recordCounter(`sdk.operation.${op}.error_kind.${normalizeSdkMetricSegment(errorKind)}`);
    }

    const action = metric.attributes?.['action'];
    if (typeof action === 'string' && action) {
        metrics.recordCounter(`sdk.operation.${op}.action.${normalizeSdkMetricSegment(action)}`);
    }

    if (metric.operation === 'session.sendAndWait' && typeof metric.durationMs === 'number') {
        metrics.recordSdkDialogTurn(metric.durationMs, metric.status === 'succeeded');
    }

    bus?.emit({
        type: 'sdk:operation:metric',
        timestamp: Date.now(),
        operation: metric.operation,
        status: metric.status,
        sessionId: metric.sessionId,
        durationMs: metric.durationMs,
        attributes: metric.attributes,
    });
}
