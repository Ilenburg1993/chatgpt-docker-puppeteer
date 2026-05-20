// @ts-check
/**
 * src/copilot/observability/bus-actions/error-alerter.js — FAIXA-L15
 *
 * EventBus subscriber que detecta eventos `*:error` e `*:fatal` e aciona o sistema de alertas (ErrorAlerting).
 *
 * @module copilot/observability/bus-actions/error-alerter
 */

import { toError } from '../../core/error-handlers.js';
import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 * @typedef {import('../error-tracker.js').ErrorTracker} ErrorTracker
 */

/**
 * @param {{ bus: EventBus; onAlert?: (evt: { type: string; timestamp: number }) => void; errorTracker?: ErrorTracker | null }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string }}
 */
export function createErrorAlerterAction({ bus, onAlert, errorTracker = null }) {
    /** @type {(() => void)[]} */
    const unsubs = [];
    const alertFn =
        onAlert ??
        ((/** @type {{ type: string; errorMessage?: string; message?: string; source?: string }} */ evt) => {
            const detail = evt.errorMessage || evt.message || '';
            const source = evt.source ? ` · source=${evt.source}` : '';
            log('ERROR', `[error-alerter] ALERTA: ${evt.type}${source}${detail ? ` · ${detail}` : ''}`);
        });

    // Match error/fatal events via wildcard patterns
    const errorPatterns = [
        'agent:task:error',
        'agent:session:fatal',
        'agent:tool:error',
        'hook:error_occurred',
        'agent:dialog:turn_timeout',
    ];

    for (const pattern of errorPatterns) {
        unsubs.push(
            bus.on(pattern, (evt) => {
                try {
                    alertFn(evt);
                    errorTracker?.trackError?.(new Error(`EventBus error event: ${evt.type}`), {
                        source: 'event-bus',
                        metadata: /** @type {Record<string, unknown>} */ (evt),
                    });
                } catch (e) {
                    log('WARN', `[error-alerter] erro ao processar alerta: ${toError(e).message}`);
                }
            }),
        );
    }

    log('INFO', `[error-alerter] ${unsubs.length} patterns de erro monitorados`);

    return {
        name: 'ErrorAlerter',
        hasAction: true,
        unsub() {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
    };
}
