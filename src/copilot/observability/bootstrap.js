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
import { HOOKS_LOGGER } from '#copilot/hooks';
import { SDK_LOGGER, TOOLS_BUILDER } from '#copilot/sdk';
import { TOOLS_LOGGER, TOOLS_METRICS } from '#copilot/tools';
import { setAuditLogger } from '../audit/logger.js';
import { container, wireLegacySetters } from '../core/di-container.js';
import { registerErrorHandlerDeps } from '../core/error-handlers.js';
import { createEventBus } from '../core/event-bus.js';
import { registerShutdownHandler, setShutdownLogger } from '../core/shutdown.js';
import { setDbLogger } from '../db/sqlite.js';
import { registerBuiltinMiddleware } from '../events/middleware/index.js';
import { defaultBus as hookBus } from '../hooks/bus.js';
import { setHooksLogger } from '../hooks/logger.js';
import { setSdkLogger } from '../sdk/logger.js';
import { setSdkMetricEmitter } from '../sdk/telemetry/operation-metrics.js';
import { setCustomToolsBuilder } from '../sdk/tools/custom.js';
import { setToolsLogger } from '../tools/logger.js';
import { setToolsMetrics } from '../tools/metrics-proxy.js';
import { ERROR_TRACKER, EVENT_COLLECTOR, METRICS_STORE } from './di-tokens.js';
import { defaultErrorTracker } from './error-tracker.js';
import { attachObservabilityBusRuntime, detachObservabilityBusRuntime } from './event-bus-runtime.js';
import { defaultEventCollector } from './event-collector.js';
import { LOG_DIR, log } from './logger.js';
import { defaultMetrics } from './metrics.js';
import { projectSdkOperationMetric } from './sdk-metric-bridge.js';
import { getToolStats, recordToolCall } from './tool-stats.js';

/** @type {boolean} */
let _obsBooted = false;

/**
 * @param {import('../sdk/types.js').SdkOperationMetric} metric
 * @returns {void}
 */
function emitSdkMetric(metric) {
    const bus = container.has(EVENT_BUS) ? container.resolve(EVENT_BUS) : null;
    projectSdkOperationMetric(metric, { metrics: defaultMetrics, bus });
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

    // Event Bus global — singleton cross-module
    container.register(EVENT_BUS, () => createEventBus(), 'singleton');

    // FAIXA-L1: bridge HookBus → EventBus (fix bug GAP-EVENTS-01)
    const bus = container.resolve(EVENT_BUS);
    if (bus) hookBus.setEventBus(bus);

    // FAIXA-L6: middleware pipeline (enricher → validator → rate-limiter)
    if (bus) registerBuiltinMiddleware(bus);

    // Runtime canônico de observabilidade sobre EventBus.
    if (bus) attachObservabilityBusRuntime({ bus, metrics: defaultMetrics });

    // FAIXA-0: Shutdown handlers para singletons de observabilidade
    registerShutdownHandler(
        'eventbus.dispose',
        async () => {
            const bus = container.resolve(EVENT_BUS);
            if (bus?.dispose) bus.dispose();
        },
        40,
    );

    registerShutdownHandler(
        'error-tracker.destroy',
        async () => {
            defaultErrorTracker.destroy();
        },
        45,
    );

    registerShutdownHandler(
        'observability.busRuntime.detach',
        async () => {
            detachObservabilityBusRuntime();
        },
        46,
    );

    // K-5: wiring centralizado — resolve tokens e invoca setters legados
    wireLegacySetters(container, [
        { token: SHUTDOWN_LOGGER, setter: setShutdownLogger },
        { token: DB_LOGGER, setter: setDbLogger },
        { token: SDK_LOGGER, setter: setSdkLogger },
        {
            token: AUDIT_LOGGER,
            setter: (fn) => setAuditLogger(/** @type {Parameters<typeof setAuditLogger>[0]} */ (fn), LOG_DIR),
        },
        { token: HOOKS_LOGGER, setter: setHooksLogger },
        { token: TOOLS_LOGGER, setter: setToolsLogger },
        { token: TOOLS_METRICS, setter: setToolsMetrics },
    ]);
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
        // K-5: wiring centralizado
        wireLegacySetters(container, [
            {
                token: TOOLS_BUILDER,
                setter: (fn) => setCustomToolsBuilder(/** @type {Parameters<typeof setCustomToolsBuilder>[0]} */ (fn)),
            },
        ]);
    }
}
