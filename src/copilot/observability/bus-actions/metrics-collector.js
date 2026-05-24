// @ts-check
/**
 * src/copilot/observability/bus-actions/metrics-collector.js — FAIXA-L15
 *
 * EventBus subscriber que incrementa contadores/histogramas do MetricsStore para cada tipo de evento recebido,
 * eliminando a necessidade de metrificar manualmente em cada módulo.
 *
 * @module copilot/observability/bus-actions/metrics-collector
 */

import { toError } from '../../core/error-handlers.js';
import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 *
 * @typedef {import('../metrics.js').MetricsStore} MetricsStore
 */

/**
 * @param {{ bus: EventBus; metrics: MetricsStore }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string }}
 */
export function createMetricsCollector({ bus, metrics }) {
    /** @type {(() => void)[]} */
    const unsubs = [];

    /** @param {string} type @param {(evt: any) => void} fn */
    function on(type, fn) {
        unsubs.push(
            bus.on(type, (/** @type {any} */ evt) => {
                try {
                    fn(evt);
                } catch (e) {
                    log('WARN', `[metrics-collector] erro em ${type}: ${toError(e).message}`);
                }
            }),
        );
    }

    // Dialog turn metrics
    on('agent:dialog:turn_end', (evt) => {
        metrics.recordDialogTurn(evt.durationMs ?? 0, evt.reply !== undefined);
    });

    on('agent:dialog:stalled', (evt) => {
        metrics.recordDialogStall(evt.stalledMs ?? 0);
    });

    on('agent:dialog:turn_timeout', () => {
        metrics.recordDialogTimeout();
    });

    // Task metrics
    on('agent:task:completed', (evt) => {
        metrics.recordTaskCompletion(evt.durationMs ?? 0, true);
    });

    on('agent:task:error', () => {
        metrics.recordTaskCompletion(0, false);
    });

    // Session metrics
    on('agent:session:fatal', () => {
        metrics.recordSessionError();
    });

    // Tool calls
    // Streaming chunks
    on('agent:dialog:streaming_started', () => {
        metrics.recordStreamingChunk(0);
    });

    // Counters via recordCounter
    on('agent:session:compaction_start', () => {
        metrics.recordCounter('session.compaction', 1);
    });
    on('agent:session:compaction_complete', () => {
        metrics.recordCounter('session.compaction_complete', 1);
    });
    on('agent:handoff:received', () => {
        metrics.recordHandoff();
    });
    on('agent:session:keepalive', () => {
        metrics.recordKeepalivePing();
    });
    on('agent:session:usage', () => {
        metrics.recordCounter('session.usage_report', 1);
    });
    on('model_gateway:registry:snapshot', (evt) => {
        metrics.recordCounter('model_gateway.registry.snapshot', 1);
        metrics.recordGauge('model_gateway.providers', evt.providerCount ?? 0);
        metrics.recordGauge('model_gateway.models', evt.modelCount ?? 0);
        metrics.recordGauge('model_gateway.models.enabled', evt.enabledModelCount ?? 0);
    });
    on('model_gateway:route:decision', () => {
        metrics.recordCounter('model_gateway.route.decision', 1);
    });
    on('model_gateway:probe:completed', (evt) => {
        metrics.recordCounter(evt.ok === false ? 'model_gateway.probe.failed' : 'model_gateway.probe.ok', 1);
    });
    on('model_gateway:provider:failure', (evt) => {
        const kind = typeof evt.kind === 'string' && evt.kind ? evt.kind : 'unknown';
        metrics.recordCounter(`model_gateway.provider_failure.${kind}`, 1);
    });

    log('INFO', `[metrics-collector] ${unsubs.length} subscribers registrados`);

    return {
        name: 'MetricsCollector',
        hasAction: true,
        unsub() {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
    };
}
