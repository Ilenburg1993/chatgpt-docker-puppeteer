// @ts-check
/**
 * src/copilot/observability/bootstrap.js
 *
 * Inicializa as dependências de observabilidade em módulos de camada inferior (`core/`).
 *
 * Esse arquivo é o único ponto de crossing intencional entre `observability/` e `core/`: ao invés de `core/` importar
 * `observability/` (inversão de camada), o bootstrap injeta as dependências via `registerErrorHandlerDeps()`.
 *
 * Deve ser chamado UMA VEZ, no bootstrap da aplicação (`src/main.js` ou equivalente), antes de qualquer uso de
 * `logSwallowed` / `wrapAsync` em runtime.
 *
 * @module copilot/observability/bootstrap
 */

import { AUDIT_LOGGER } from '#copilot/audit';
import { DB_LOGGER, EVENT_BUS, SHUTDOWN_LOGGER } from '#copilot/core';
import { HOOKS_LOGGER, SDK_LOGGER, TOOLS_BUILDER } from '#copilot/sdk/di';
import { defaultBus as defaultHookBus, setHooksLogger } from '#copilot/sdk/session';
import { setSdkMetricEmitter } from '#copilot/sdk/telemetry';
import { setCustomToolsBuilder } from '#copilot/sdk/tools';
import { setToolsLogger, setToolsMetrics, TOOLS_LOGGER, TOOLS_METRICS } from '#copilot/tools/observability';
import { channel } from 'node:diagnostics_channel';
import { setAuditLogger } from '../audit/logger.js';
import { container } from '../core/di-container.js';
import { registerErrorHandlerDeps } from '../core/error-handlers.js';
import { createEventBus } from '../core/event-bus.js';
import { SHUTDOWN_PRIORITY } from '../core/shutdown-priorities.js';
import { registerShutdownHandler, setShutdownEventEmitter, setShutdownLogger } from '../core/shutdown.js';
import { registerBuiltinMiddleware } from '../events/middleware/index.js';
import { setSdkLogger } from '../sdk/logger.js';
import { defaultConvergenceTraceStore, initConvergenceTracePersistence } from './convergence-trace-store.js';
import { CONVERGENCE_TRACE_STORE, ERROR_TRACKER, EVENT_COLLECTOR, METRICS_STORE } from './di-tokens.js';
import { defaultErrorTracker } from './error-tracker.js';
import { attachObservabilityBusRuntime, detachObservabilityBusRuntime } from './event-bus-runtime.js';
import { defaultEventCollector } from './event-collector.js';
import { log, LOG_DIR } from './logger.js';
import { defaultMetrics } from './metrics.js';
import { projectSdkOperationMetric } from './sdk-metric-bridge.js';
import { getToolStats, recordBlockedToolCall, recordToolCall } from './tool-stats.js';

/** @type {boolean} */
let _obsBooted = false;
const ioOperationChannel = channel('copilot.io.operation');

/**
 * @param {unknown} message
 * @returns {void}
 */
function recordIoOperationMetric(message) {
    if (!message || typeof message !== 'object') return;
    const payload = /** @type {{ success?: unknown; io?: import('../core/io-contracts.js').IoMeta }} */ (message);
    const io = payload.io;
    if (!io || typeof io !== 'object') return;

    const success = payload.success !== false;
    const durationMs = Math.max(0, Math.round(io.durationMs ?? 0));
    const engine = io.engine ?? 'unknown';
    const metricName = `io.${io.operation}.${engine}`;

    defaultMetrics.recordToolCall(metricName, durationMs, success);
    defaultMetrics.recordCounter(`copilot.io.${io.operation}.${success ? 'success' : 'error'}_total`);
    if (typeof io.bytesRead === 'number') {
        defaultMetrics.recordCounter('copilot.io.bytes_read_total', io.bytesRead);
    }
    if (typeof io.bytesWritten === 'number') {
        defaultMetrics.recordCounter('copilot.io.bytes_written_total', io.bytesWritten);
    }
    const lockWait = io.advisoryLimits?.['lockWaitMs'];
    if (typeof lockWait === 'number') {
        defaultMetrics.recordGauge('copilot.io.lock_wait_ms.last', lockWait);
    }
}

/**
 * @param {import('../sdk/types.js').SdkOperationMetric} metric
 * @returns {void}
 */
function emitSdkMetric(metric) {
    const bus = container.has(EVENT_BUS) ? container.resolve(EVENT_BUS) : null;
    projectSdkOperationMetric(metric, {
        metrics: defaultMetrics,
        bus,
        convergenceTraceStore: defaultConvergenceTraceStore,
    });
}

/**
 * @param {{ type: string; timestamp: number; [key: string]: unknown }} event
 * @returns {void}
 */
function emitShutdownLifecycleEvent(event) {
    if (!container.has(EVENT_BUS)) return;
    const bus = container.resolve(EVENT_BUS);
    bus?.emit(event);
}

/**
 * Conecta `core/error-handlers`, `core/shutdown`, `db/sqlite`, `sdk/` e `audit/` às implementações reais de log e
 * tracking. Idempotente — chamadas subsequentes são ignoradas com log de aviso.
 *
 * Também registra os tokens DI correspondentes no container global para consumo via DI.
 *
 * @returns {void}
 */
export function bootstrapObservability() {
    if (_obsBooted) {
        log('WARN', '[observability/bootstrap] bootstrapObservability já executado — ignorando.');
        return;
    }
    _obsBooted = true;
    registerErrorHandlerDeps({
        log,
        tracker: defaultErrorTracker,
    });
    setSdkMetricEmitter(emitSdkMetric);

    // DI container — registrar as dependências como tokens
    container.register(SHUTDOWN_LOGGER, () => log, 'singleton');
    container.register(DB_LOGGER, () => log, 'singleton');
    container.register(SDK_LOGGER, () => log, 'singleton');
    container.register(AUDIT_LOGGER, () => log, 'singleton');
    container.register(HOOKS_LOGGER, () => log, 'singleton');
    container.register(TOOLS_LOGGER, () => log, 'singleton');
    container.register(
        TOOLS_METRICS,
        () => ({
            getSummary: () => defaultMetrics.getSummary(),
            getToolStats,
            recordToolCall,
        }),
        'singleton',
    );

    // Observability singletons — disponíveis via DI para consumers futuros
    container.register(METRICS_STORE, () => defaultMetrics, 'singleton');
    container.register(ERROR_TRACKER, () => defaultErrorTracker, 'singleton');
    container.register(EVENT_COLLECTOR, () => defaultEventCollector, 'singleton');
    container.register(CONVERGENCE_TRACE_STORE, () => defaultConvergenceTraceStore, 'singleton');

    // Event Bus global — singleton cross-module
    container.register(EVENT_BUS, () => createEventBus(), 'singleton');

    // FAIXA-L1: bridge HookBus → EventBus (fix bug GAP-EVENTS-01)
    const bus = container.resolve(EVENT_BUS);
    if (bus) defaultHookBus.setEventBus(bus);

    // FAIXA-L6: middleware pipeline (enricher → validator → rate-limiter)
    if (bus) registerBuiltinMiddleware(bus);

    // Runtime canônico de observabilidade sobre EventBus.
    if (bus) attachObservabilityBusRuntime({ bus, metrics: defaultMetrics });
    ioOperationChannel.subscribe(recordIoOperationMetric);
    setShutdownEventEmitter(emitShutdownLifecycleEvent);

    // FAIXA-0: Shutdown handlers para singletons de observabilidade
    registerShutdownHandler(
        'observability.metricsSnapshot.flush',
        async () => {
            defaultMetrics.stopPeriodicSnapshot();
            await defaultMetrics.flushPeriodicSnapshot();
        },
        SHUTDOWN_PRIORITY.AUDIT_FINALIZER,
        { timeoutMs: 10_000 },
    );

    registerShutdownHandler(
        'eventbus.dispose',
        async () => {
            const bus = container.resolve(EVENT_BUS);
            if (bus?.dispose) bus.dispose();
        },
        SHUTDOWN_PRIORITY.OBSERVABILITY_BUS,
    );

    registerShutdownHandler(
        'error-tracker.destroy',
        async () => {
            defaultErrorTracker.destroy();
        },
        SHUTDOWN_PRIORITY.OBSERVABILITY_TRACKER,
    );

    registerShutdownHandler(
        'observability.busRuntime.detach',
        async () => {
            detachObservabilityBusRuntime();
        },
        SHUTDOWN_PRIORITY.OBSERVABILITY_DETACH,
    );

    registerShutdownHandler(
        'observability.ioMetrics.detach',
        async () => {
            ioOperationChannel.unsubscribe(recordIoOperationMetric);
        },
        SHUTDOWN_PRIORITY.OBSERVABILITY_DETACH,
    );

    setShutdownLogger(log);
    setSdkLogger(log);
    setAuditLogger(log, LOG_DIR);
    setHooksLogger(log);
    setToolsLogger(log);
    setToolsMetrics({
        getSummary: () => defaultMetrics.getSummary(),
        getToolStats,
        recordBlockedToolCall,
        recordToolCall,
    });
}

/**
 * Injeta dependências tardias que requerem módulos de camadas superiores (L3+). Deve ser chamado após o bootstrap
 * básico, quando `tools/` estiver disponível.
 *
 * @param {{ buildTool?: Function }} deps
 * @returns {void}
 */
export function bootstrapLateDeps(deps) {
    if (deps.buildTool) {
        container.register(TOOLS_BUILDER, () => deps.buildTool, 'singleton');
        setCustomToolsBuilder(/** @type {Parameters<typeof setCustomToolsBuilder>[0]} */ (deps.buildTool));
    }
}

/**
 * Habilita persistência SQLite no trace-store de convergência. Deve ser chamado após `bootstrapObservability()` e após
 * the application SQLite provider has been bootstrapped.
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @returns {void}
 */
export function bootstrapConvergencePersistence(db) {
    initConvergenceTracePersistence(db);
}
