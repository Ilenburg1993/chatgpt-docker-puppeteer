// @ts-check
/**
 * src/copilot/observability/event-bus-runtime.js
 *
 * Runtime canônico de observabilidade sobre o EventBus.
 *
 * Consolida a composição de `bus-actions/*` em um único owner de wiring, evitando que `bootstrap.js` e consumidores
 * externos precisem decidir individualmente quais subscribers ativar.
 */

import {
    createActivityTracker,
    createCorrelationTracer,
    createErrorAlerterAction,
    createHealthUpdater,
    createLogObserver,
    createMetricsCollector,
} from './bus-actions/index.js';
import { defaultErrorTracker } from './error-tracker.js';
import { log } from './logger.js';

/**
 * @typedef {import('../core/event-bus.js').EventBus} EventBus
 *
 * @typedef {import('./metrics.js').MetricsStore} MetricsStore
 */

/**
 * @typedef {ReturnType<typeof createHealthUpdater> extends { getHealth: infer T } ? T : never} HealthGetter
 */

/**
 * @typedef {ReturnType<typeof createActivityTracker> extends { getSnapshot: infer T } ? T : never} ActivityGetter
 */

/**
 * @typedef {object} ObservabilityBusRuntime
 * @property {'observability.bus-runtime'} name
 * @property {boolean} attached
 * @property {() => ReturnType<HealthGetter>} getHealth
 * @property {() => ReturnType<ActivityGetter>} getActivity
 * @property {(correlationId: string) => { type: string; timestamp: number; correlationId?: string | undefined }[]} getTraces
 * @property {(limit?: number) => { type: string; timestamp: number; correlationId?: string | undefined }[]} getRecentTraces
 * @property {() => {
 *     attached: boolean;
 *     actions: string[];
 *     health: ReturnType<HealthGetter>;
 *     activity: ReturnType<ActivityGetter>;
 *     recentTraceCount: number;
 * }} diagnostics
 * @property {() => void} detach
 */

/** @type {ObservabilityBusRuntime | null} */
let _runtime = null;

/**
 * Cria uma instância acoplada do runtime de observabilidade do EventBus.
 *
 * @param {{
 *     bus: EventBus;
 *     metrics: MetricsStore;
 *     onAlert?: (evt: { type: string; timestamp: number }) => void;
 * }} deps
 * @returns {ObservabilityBusRuntime}
 */
export function createObservabilityBusRuntime({ bus, metrics, onAlert }) {
    const logObserver = createLogObserver({ bus });
    const metricsCollector = createMetricsCollector({ bus, metrics });
    const activityTracker = createActivityTracker({ bus });
    const healthUpdater = createHealthUpdater({ bus });
    const correlationTracer = createCorrelationTracer({ bus });
    const errorAlerter = createErrorAlerterAction({
        bus,
        errorTracker: defaultErrorTracker,
        ...(onAlert ? { onAlert } : {}),
    });

    const actions = {
        logObserver,
        metricsCollector,
        activityTracker,
        healthUpdater,
        correlationTracer,
        errorAlerter,
    };

    /** @type {boolean} */
    let attached = true;

    return {
        name: 'observability.bus-runtime',
        get attached() {
            return attached;
        },
        getHealth() {
            return healthUpdater.getHealth();
        },
        getActivity() {
            return activityTracker.getSnapshot();
        },
        getTraces(correlationId) {
            return correlationTracer.getTraces(correlationId);
        },
        getRecentTraces(limit = 20) {
            return correlationTracer.getRecentTraces(limit);
        },
        diagnostics() {
            return {
                attached,
                actions: Object.keys(actions),
                health: healthUpdater.getHealth(),
                activity: activityTracker.getSnapshot(),
                recentTraceCount: correlationTracer.getRecentTraces(100).length,
            };
        },
        detach() {
            if (!attached) return;
            attached = false;
            logObserver.unsub();
            metricsCollector.unsub();
            activityTracker.unsub();
            healthUpdater.unsub();
            correlationTracer.unsub();
            errorAlerter.unsub();
            log('INFO', '[observability/event-bus-runtime] runtime desacoplado do EventBus');
        },
    };
}

/**
 * Anexa o runtime singleton de observabilidade ao EventBus.
 *
 * Idempotente — se já existir runtime ativo, retorna a instância atual.
 *
 * @param {{
 *     bus: EventBus;
 *     metrics: MetricsStore;
 *     onAlert?: (evt: { type: string; timestamp: number }) => void;
 * }} deps
 * @returns {ObservabilityBusRuntime}
 */
export function attachObservabilityBusRuntime(deps) {
    if (_runtime?.attached) {
        return _runtime;
    }
    _runtime = createObservabilityBusRuntime(deps);
    log('INFO', '[observability/event-bus-runtime] runtime canônico acoplado ao EventBus');
    return _runtime;
}

/**
 * Desacopla o runtime singleton do EventBus.
 *
 * @returns {void}
 */
export function detachObservabilityBusRuntime() {
    _runtime?.detach();
    _runtime = null;
}

/**
 * Retorna o runtime singleton atual, se houver.
 *
 * @returns {ObservabilityBusRuntime | null}
 */
export function getObservabilityBusRuntime() {
    return _runtime;
}

/**
 * Retorna snapshot canônico de health da pipeline observacional do EventBus.
 *
 * @returns {{ score: number; status: string; lastUpdate: number } | null}
 */
export function getObservabilityBusHealth() {
    return _runtime?.getHealth() ?? null;
}

/**
 * Retorna snapshot canônico de activity da pipeline observacional do EventBus.
 *
 * @returns {{ lastActivity: number; lastEventType: string; eventCount: number; idleMs: number } | null}
 */
export function getObservabilityBusActivity() {
    return _runtime?.getActivity() ?? null;
}

/**
 * Diagnóstico agregado do runtime observacional do EventBus.
 *
 * @returns {{
 *     attached: boolean;
 *     actions: string[];
 *     health: { score: number; status: string; lastUpdate: number } | null;
 *     activity: { lastActivity: number; lastEventType: string; eventCount: number; idleMs: number } | null;
 *     recentTraceCount: number;
 * }}
 */
export function getObservabilityBusDiagnostics() {
    if (!_runtime) {
        return {
            attached: false,
            actions: [],
            health: null,
            activity: null,
            recentTraceCount: 0,
        };
    }
    return _runtime.diagnostics();
}
