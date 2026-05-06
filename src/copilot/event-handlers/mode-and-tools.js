// @ts-check
/**
 * @module copilot/event-handlers/mode-and-tools
 * @see EventBus
 * F62.5: Handler de eventos de mudança de modo e ferramentas.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { normalizeModeChangedEvent, normalizePlanChangedEvent } from '#copilot/sdk';
import { onSessionEvent } from '../sdk/session/events.js';

/**
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireModeAndToolEvents(session, { emit }) {
    return [
        onSessionEvent(session, SESSION_EVENTS.SESSION_MODE_CHANGED, (evt) => {
            const normalized = normalizeModeChangedEvent(evt);
            log('INFO', `[AlwaysAlive] Modo mudou: ${normalized.previousMode ?? '?'} → ${normalized.newMode}`);
            emit('session.mode_changed', {
                previousMode: normalized.previousMode,
                newMode: normalized.newMode,
                ts: normalized.ts,
            });
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_PLAN_CHANGED, (evt) => {
            const normalized = normalizePlanChangedEvent(evt);
            log('INFO', `[AlwaysAlive] Plano da sessão mudou: ${normalized.operation}`);
            emit('session.plan_changed', {
                operation: normalized.operation,
                ts: normalized.ts,
            });
        }),
    ];
}
