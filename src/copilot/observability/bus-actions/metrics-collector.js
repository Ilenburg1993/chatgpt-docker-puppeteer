// @ts-check
/**
 * src/copilot/observability/bus-actions/metrics-collector.js — FAIXA-L15
 *
 * EventBus subscriber que incrementa contadores/histogramas do MetricsStore para cada tipo de evento recebido,
 * eliminando a necessidade de metrificar manualmente em cada módulo.
 *
 * @module copilot/observability/bus-actions/metrics-collector
 */

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
                } catch (/** @type {any} */ e) {
                    log('WARN', `[metrics-collector] erro em ${type}: ${e?.message}`);
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
    on('hook:post_tool_use', (evt) => {
        const input = evt?.input ?? {};
        metrics.recordToolCall(input.toolName ?? 'unknown', input.durationMs ?? 0, input.result !== 'error');
    });

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
