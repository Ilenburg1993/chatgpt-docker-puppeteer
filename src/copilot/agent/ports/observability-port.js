// @ts-check
/**
 * Porta de observabilidade do agent.
 *
 * Centraliza o acesso do runtime a logging, spans, métricas e snapshots para que o miolo do `agent/` não dependa
 * diretamente da topologia concreta de `observability/`.
 *
 * @module copilot/agent/ports/observability-port
 * @internal
 */

export {
    ERROR_TRACKER,
    METRICS_STORE,
    buildTelemetryConfig,
    createAgentEventObserver,
    defaultErrorTracker,
    defaultEventCollector,
    defaultMetrics,
    initEventCollector,
    log,
    startSpan,
    startSpanImmediate,
} from '#copilot/observability';

export { buildStatusSnapshot } from '../../observability/snapshots.js';
