// @ts-check
/**
 * @module copilot/event-handlers/mode-and-tools
 * @see EventBus
 * F62.5: Handler de eventos de mudança de modo e ferramentas.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireModeAndToolEvents(session, { emit }) {
    return [
        session.on(SESSION_EVENTS.SESSION_MODE_CHANGED, (evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.['previousMode']} → ${evt?.data?.['newMode']}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
    ];
}
