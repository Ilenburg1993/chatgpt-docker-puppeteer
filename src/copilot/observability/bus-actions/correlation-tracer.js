// @ts-check
/**
 * src/copilot/observability/bus-actions/correlation-tracer.js — FAIXA-L15
 *
 * EventBus subscriber que rastreia correlationIds em eventos, construindo um trace log para debug end-to-end.
 * Complementa o correlationEnricher middleware (FAIXA-L16) que injeta o ID — este módulo observa e indexa.
 *
 * @module copilot/observability/bus-actions/correlation-tracer
 */

import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 */

/**
 * @typedef {object} TraceEntry
 * @property {string} type
 * @property {number} timestamp
 * @property {string | undefined} [correlationId]
 */

/**
 * @param {{ bus: EventBus; maxTraces?: number; maxEventsPerCorrelation?: number }} deps
 * @returns {{
 *     unsub: () => void;
 *     hasAction: true;
 *     name: string;
 *     getTraces: (correlationId: string) => TraceEntry[];
 *     getRecentTraces: (limit?: number) => TraceEntry[];
 * }}
 */
export function createCorrelationTracer({ bus, maxTraces = 500, maxEventsPerCorrelation = 100 }) {
    /** @type {Map<string, TraceEntry[]>} */
    const byCorrelation = new Map();
    /** @type {TraceEntry[]} */
    const recent = [];
    /** @type {(() => void)[]} */
    const unsubs = [];

    // Subscribe to wildcard to capture all events
    unsubs.push(
        bus.on('*', (evt) => {
            const entry = {
                type: evt?.type ?? 'unknown',
                timestamp: evt?.timestamp ?? Date.now(),
                correlationId: evt?.correlationId,
            };

            // Recent buffer (circular)
            recent.push(entry);
            if (recent.length > maxTraces) recent.shift();

            // Index by correlationId
            if (entry.correlationId) {
                let list = byCorrelation.get(entry.correlationId);
                if (!list) {
                    list = [];
                    byCorrelation.set(entry.correlationId, list);
                }
                list.push(entry);
                if (list.length > maxEventsPerCorrelation) {
                    list.splice(0, list.length - maxEventsPerCorrelation);
                }

                // Evict old correlations if map grows too large
                if (byCorrelation.size > maxTraces) {
                    const firstKey = byCorrelation.keys().next().value;
                    if (firstKey) byCorrelation.delete(firstKey);
                }
            }
        }),
    );

    log('INFO', '[correlation-tracer] tracing ativo (wildcard subscriber)');

    return {
        name: 'CorrelationTracer',
        hasAction: true,
        getTraces(correlationId) {
            return byCorrelation.get(correlationId) ?? [];
        },
        getRecentTraces(limit = 20) {
            return recent.slice(-limit);
        },
        unsub() {
            for (const u of unsubs) u();
            unsubs.length = 0;
            byCorrelation.clear();
            recent.length = 0;
        },
    };
}
