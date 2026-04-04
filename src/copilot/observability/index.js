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

// ─── Agent Event Observer ─────────────────────────────────────────────────────
export { createAgentEventObserver } from './agent-event-observer.js';

// ─── Audit Log ────────────────────────────────────────────────────────────────
export { createAuditLog, defaultAuditLog } from './audit-log.js';

// ─── Hooks Audit Preset ───────────────────────────────────────────────────────
// ARCH-OBS-003: movido para hooks/presets/audit.js — re-export mantido por backward compat
/** @deprecated F33.1: Importar de `../hooks/presets/audit.js` diretamente. */
export { createHooksAuditPreset } from '../hooks/presets/audit.js';

// ─── OTEL ─────────────────────────────────────────────────────────────────────
export { DEFAULT_OTEL_FILE, buildTelemetryConfig, isOtelEnabled, startSpan } from './otel.js';
