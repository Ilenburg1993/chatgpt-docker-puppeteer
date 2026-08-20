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

const RECOVERABLE_HOOK_ALERT_THROTTLE_MS = 30_000;
const MAX_RECOVERABLE_ALERT_KEYS = 512;

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 * @typedef {import('../error-tracker.js').ErrorTracker} ErrorTracker
 */

/**
 * @param {{ type: string; errorContext?: unknown; recoverable?: unknown; sessionId?: unknown; errorMessage?: unknown; message?: unknown }} evt
 * @returns {boolean}
 */
function isRecoverableModelCallHookError(evt) {
    return evt.type === 'hook:error_occurred' && evt.errorContext === 'model_call' && evt.recoverable === true;
}

/**
 * Alguns eventos de erro do bus são envelopes de alerta para uma falha causal já rastreada por outro dono
 * canônico (`sdk:session.error`, `agent:task:error`, tool lifecycle etc.). O alerter pode narrar/logar esses
 * eventos, mas não deve criar uma segunda entrada sintética em `/errors`.
 *
 * @param {{ type: string }} evt
 * @returns {boolean}
 */
function shouldTrackSyntheticBusError(evt) {
    return evt.type !== 'agent:task:error';
}

/**
 * @param {{ type: string; errorContext?: unknown; sessionId?: unknown; errorMessage?: unknown; message?: unknown }} evt
 * @returns {string}
 */
function buildAlertDedupeKey(evt) {
    return [
        evt.type,
        typeof evt.errorContext === 'string' ? evt.errorContext : '',
        typeof evt.sessionId === 'string' ? evt.sessionId : '',
        typeof evt.errorMessage === 'string' ? evt.errorMessage : typeof evt.message === 'string' ? evt.message : '',
    ].join('|');
}

/**
 * @param {{ bus: EventBus; onAlert?: (evt: { type: string; timestamp: number }) => void; errorTracker?: { trackError: (error: unknown, options?: import('../error-tracker.js').TrackErrorOptions) => unknown } | null }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string }}
 */
export function createErrorAlerterAction({ bus, onAlert, errorTracker = null }) {
    /** @type {(() => void)[]} */
    const unsubs = [];
    /** @type {Map<string, number>} */
    const lastRecoverableAlertAtByKey = new Map();

    /**
     * @param {{ type: string; errorContext?: unknown; sessionId?: unknown; errorMessage?: unknown; message?: unknown }} evt
     * @param {number} now
     * @returns {boolean}
     */
    function claimRecoverableAlert(evt, now) {
        for (const [key, lastAlertAt] of lastRecoverableAlertAtByKey) {
            if (now - lastAlertAt >= RECOVERABLE_HOOK_ALERT_THROTTLE_MS) {
                lastRecoverableAlertAtByKey.delete(key);
            }
        }

        const key = buildAlertDedupeKey(evt);
        const last = lastRecoverableAlertAtByKey.get(key);
        if (last != null && now - last < RECOVERABLE_HOOK_ALERT_THROTTLE_MS) return false;

        lastRecoverableAlertAtByKey.set(key, now);
        while (lastRecoverableAlertAtByKey.size > MAX_RECOVERABLE_ALERT_KEYS) {
            const oldestKey = lastRecoverableAlertAtByKey.keys().next().value;
            if (typeof oldestKey !== 'string') break;
            lastRecoverableAlertAtByKey.delete(oldestKey);
        }
        return true;
    }

    const alertFn =
        onAlert ??
        ((/** @type {{ type: string; errorMessage?: string; message?: string; source?: string; errorContext?: unknown; recoverable?: unknown; sessionId?: unknown }} */ evt) => {
            const detail = evt.errorMessage || evt.message || '';
            const source = evt.source ? ` · source=${evt.source}` : '';
            if (isRecoverableModelCallHookError(evt)) {
                log(
                    'WARN',
                    `[error-alerter] Recuperável: ${evt.type} · context=model_call${source}${detail ? ` · ${detail}` : ''}`,
                );
                return;
            }
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
                    if (isRecoverableModelCallHookError(evt) && !claimRecoverableAlert(evt, Date.now())) {
                        return;
                    }
                    alertFn(evt);
                    if (!isRecoverableModelCallHookError(evt) && shouldTrackSyntheticBusError(evt)) {
                        errorTracker?.trackError?.(new Error(`EventBus error event: ${evt.type}`), {
                            source: 'event-bus',
                            metadata: /** @type {Record<string, unknown>} */ (evt),
                        });
                    }
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
