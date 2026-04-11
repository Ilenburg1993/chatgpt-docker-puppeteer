// @ts-check
/**
 * @module copilot/agent/session/event-handlers/mode-and-tools
 * F62.5: Handler de eventos de mudança de modo e ferramentas.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireModeAndToolEvents(session, { emit }) {
    return [
        session.on(SESSION_EVENTS.SESSION_MODE_CHANGED, (/** @type {any} */ evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.['previousMode']} → ${evt?.data?.['newMode']}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
    ];
}
