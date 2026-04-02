// @ts-check
/**
 * src/copilot/observability/index.js
 *
 * API pública do módulo de observabilidade de src/copilot.
 *
 * Exporta todos os instrumentos de observabilidade isolados do workspace pai:
 *
 * - Logger interno (escreve em logs/copilot/ — não polui workspace)
 * - EventCollector (captura 50+ tipos de eventos SDK)
 * - MetricsStore (histogramas de latência + token usage)
 * - ErrorTracker (ring buffer de erros + global handlers)
 * - OTEL config builder (integração com CopilotClient)
 *
 * @module copilot/observability
 */

// ─── Logger ───────────────────────────────────────────────────────────────────
export { LOG_DIR, audit, getRecentLogs, log, logMetric, metric } from './logger.js';

// ─── Event Collector ──────────────────────────────────────────────────────────
export {
    MAX_EVENTS_BYTES,
    createEventCollector,
    defaultEventCollector,
    initEventCollector,
} from './event-collector.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────
export { createMetricsStore, defaultMetrics } from './metrics.js';

// ─── Error Tracker ────────────────────────────────────────────────────────────
export { createErrorTracker, defaultErrorTracker } from './error-tracker.js';

// ─── OTEL ─────────────────────────────────────────────────────────────────────
export { DEFAULT_OTEL_FILE, buildTelemetryConfig, isOtelEnabled } from './otel.js';
