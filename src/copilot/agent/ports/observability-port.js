// @ts-check
/**
 * Porta agregada de observabilidade do agent.
 *
 * Compatibilidade: novos imports devem preferir portas finas (`logging-port`, `metrics-port`, `tracing-port`,
 * `error-tracking-port`, `event-observer-port`, `snapshot-port`).
 *
 * Esta porta permanece como aggregate para consumidores legados/testes e para evitar quebra em ondas intermediárias.
 *
 * Ao adicionar nova observabilidade no runtime:
 *
 * - se for logging, use `logging-port`;
 * - se for métrica, use `metrics-port`;
 * - se for span/telemetry, use `tracing-port`;
 * - se for erro, use `error-tracking-port`;
 * - se for evento/coletor, use `event-observer-port`;
 * - se for projection para HTTP/terminal, prefira `presentation/`;
 * - se for decisão de domínio, mantenha no módulo do agent que possui o estado.
 *
 * @module copilot/agent/ports/observability-port
 * @internal
 */

export { ERROR_TRACKER, defaultErrorTracker } from './error-tracking-port.js';
export { createAgentEventObserver, defaultEventCollector, initEventCollector } from './event-observer-port.js';
export { log } from './logging-port.js';
export { METRICS_STORE, defaultMetrics } from './metrics-port.js';
export { buildStatusSnapshot } from './snapshot-port.js';
export { buildTelemetryConfig, startSpan, startSpanImmediate } from './tracing-port.js';
