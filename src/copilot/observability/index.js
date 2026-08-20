// @ts-check
/**
 * src/copilot/observability/index.js
 *
 * API pública do módulo de observabilidade de src/copilot.
 *
 * Exporta todos os instrumentos de observabilidade isolados do workspace pai:
 *
 * - Logger interno (escreve em var/logs/copilot/ — não polui workspace)
 * - EventCollector (captura 50+ tipos de eventos SDK)
 * - MetricsStore (histogramas de latência + token usage)
 * - ErrorTracker (ring buffer de erros + global handlers)
 * - OTEL config builder (integração com CopilotClient)
 *
 * @module copilot/observability
 * @see EventBus
 */

// ─── Logger ───────────────────────────────────────────────────────────────────
export { LOG_DIR, audit, getRecentLogs, log, logMetric, metric } from './logger.js';

// ─── Event Collector ──────────────────────────────────────────────────────────
export {
    MAX_EVENTS_BYTES,
    attachSdkEventTyped,
    createEventCollector,
    defaultEventCollector,
    getCompactionHistory,
    getLastQuotaSnapshots,
    initEventCollector,
} from './event-collector.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────
export {
    createConvergenceTraceStore,
    defaultConvergenceTraceStore,
    getPersistedSnapshot,
    initConvergenceTracePersistence,
} from './convergence-trace-store.js';
export { createMetricsStore, defaultMetrics } from './metrics.js';

// ─── Error Tracker ────────────────────────────────────────────────────────────
export { createErrorTracker, defaultErrorTracker } from './error-tracker.js';

// ─── Bootstrap (conecta core/ a observability/) ───────────────────────────────
export { bootstrapConvergencePersistence, bootstrapLateDeps, bootstrapObservability } from './bootstrap.js';

// ─── Agent Event Observer ─────────────────────────────────────────────────────
export { createAgentEventObserver } from './agent-event-observer.js';
export { buildStatusSnapshot } from './snapshots.js';

// ─── EventBus Runtime Canônico ───────────────────────────────────────────────
export {
    attachObservabilityBusRuntime,
    createObservabilityBusRuntime,
    detachObservabilityBusRuntime,
    getObservabilityBusActivity,
    getObservabilityBusDiagnostics,
    getObservabilityBusHealth,
    getObservabilityBusRuntime,
} from './event-bus-runtime.js';

// ─── EventBus Observers ───────────────────────────────────────────────────────
export { createLogObserver } from './bus-actions/log-observer.js';

// ─── Audit Log ────────────────────────────────────────────────────────────────
export { createAuditLog, defaultAuditLog } from '#copilot/audit';

// ─── OTEL ─────────────────────────────────────────────────────────────────────
export { DEFAULT_OTEL_FILE, buildTelemetryConfig, isOtelEnabled, startSpan, startSpanImmediate, toOtelException } from './otel.js';

// ─── Tool Stats ──────────────────────────────────────────────────────────────
export {
    getStatsByCategory,
    getToolStats,
    recordBlockedToolCall,
    recordToolCall,
    wrapWithStats,
} from './tool-stats.js';

// ─── Event Catalog + Dead-Letter ──────────────────────────────────────────────
export { clearDeadLetters, getCatalog, getDeadLetters, recordDeadLetter } from './event-catalog.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { CONVERGENCE_TRACE_STORE, ERROR_TRACKER, EVENT_COLLECTOR, METRICS_STORE } from './di-tokens.js';
