// @ts-check
import {
    configureApplicationShutdownObservability,
    PROCESS_SHUTDOWN_PHASE,
    registerApplicationShutdownHandler,
} from '#copilot/boot/process-runtime';
/**
 * src/copilot/observability/bootstrap.js
 *
 * Inicializa as integrações de observabilidade da aplicação.
 *
 * O reporting de erros silenciados pertence a Observability e não depende de setters globais de Core.
 *
 * @module copilot/observability/bootstrap
 */

import { getApplicationEventBus } from '#copilot/boot/application-events';
import { defaultBus as defaultHookBus, setHooksLogger } from '#copilot/sdk/session';
import { setSdkMetricEmitter } from '#copilot/sdk/telemetry';
import { setCustomToolsBuilder } from '#copilot/sdk/tools';
import { setToolsLogger, setToolsMetrics } from '#copilot/tools/observability';
import { channel } from 'node:diagnostics_channel';
import { setAuditErrorReporter, setAuditLogger } from '../audit/logger.js';
import { registerBuiltinMiddleware } from '../events/middleware/index.js';
import { setSdkErrorReporter, setSdkLogger } from '../sdk/logger.js';
import { defaultConvergenceTraceStore, initConvergenceTracePersistence } from './convergence-trace-store.js';
import { defaultErrorTracker } from './error-tracker.js';
import { attachObservabilityBusRuntime, detachObservabilityBusRuntime } from './event-bus-runtime.js';
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
    const payload =
        /** @type {{ success?: unknown; io?: import('#copilot/infra/public/operations/contracts').IoMeta }} */ (
            message
        );
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
    const bus = getApplicationEventBus();
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
    getApplicationEventBus().emit(event);
}

/**
 * Conecta ProcessInfra lifecycle, SQLite, `sdk/` e `audit/` às implementações reais de log e
 * tracking. Idempotente — chamadas subsequentes são ignoradas com log de aviso.
 *
 * @returns {void}
 */
export function bootstrapObservability() {
    if (_obsBooted) {
        log('WARN', '[observability/bootstrap] bootstrapObservability já executado — ignorando.');
        return;
    }
    _obsBooted = true;
    setSdkMetricEmitter(emitSdkMetric);

    // FAIXA-L1: bridge HookBus → EventBus (fix bug GAP-EVENTS-01)
    const bus = getApplicationEventBus();
    if (bus) defaultHookBus.setEventBus(bus);

    // FAIXA-L6: middleware pipeline (enricher → validator → rate-limiter)
    if (bus) registerBuiltinMiddleware(bus);

    // Runtime canônico de observabilidade sobre EventBus.
    if (bus) attachObservabilityBusRuntime({ bus, metrics: defaultMetrics });
    ioOperationChannel.subscribe(recordIoOperationMetric);
    configureApplicationShutdownObservability({ emit: emitShutdownLifecycleEvent });

    // FAIXA-0: Shutdown handlers para singletons de observabilidade
    registerApplicationShutdownHandler(
        'observability.metricsSnapshot.flush',
        async () => {
            defaultMetrics.stopPeriodicSnapshot();
            await defaultMetrics.flushPeriodicSnapshot();
        },
        PROCESS_SHUTDOWN_PHASE.FINAL,
        { timeoutMs: 10_000 },
    );

    registerApplicationShutdownHandler(
        'error-tracker.destroy',
        async () => {
            defaultErrorTracker.destroy();
        },
        PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_TRACKER,
    );

    registerApplicationShutdownHandler(
        'observability.busRuntime.detach',
        async () => {
            detachObservabilityBusRuntime();
        },
        PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_DETACH,
    );

    registerApplicationShutdownHandler(
        'observability.ioMetrics.detach',
        async () => {
            ioOperationChannel.unsubscribe(recordIoOperationMetric);
        },
        PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_DETACH,
    );

    configureApplicationShutdownObservability({ log, emit: emitShutdownLifecycleEvent });
    setSdkLogger(log);
    setSdkErrorReporter((error, context) => defaultErrorTracker.trackError(error, { source: `sdk:${context}` }));
    setAuditLogger(log, LOG_DIR);
    setAuditErrorReporter((error, context) => defaultErrorTracker.trackError(error, { source: `audit:${context}` }));
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
