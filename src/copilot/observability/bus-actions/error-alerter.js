// @ts-check
/**
 * src/copilot/observability/bus-actions/error-alerter.js — FAIXA-L15
 *
 * EventBus subscriber que detecta eventos `*:error` e `*:fatal` e aciona o sistema de alertas (ErrorAlerting).
 *
 * @module copilot/observability/bus-actions/error-alerter
 */

import { log } from '../logger.js';
import { toError } from '../../core/error-handlers.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 */

/**
 * @param {{ bus: EventBus; onAlert?: (evt: { type: string; timestamp: number }) => void }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string }}
 */
export function createErrorAlerterAction({ bus, onAlert }) {
    /** @type {(() => void)[]} */
    const unsubs = [];
    const alertFn =
        onAlert ??
        ((/** @type {{ type: string }} */ evt) => {
            log('ERROR', `[error-alerter] ALERTA: evento ${evt.type} detectado`);
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
